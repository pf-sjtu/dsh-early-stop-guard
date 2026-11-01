/**
 * Stop a DeepSeek Harness turn from closing while the model has only narrated
 * its next action.
 *
 * The agent loop ends a turn as `completed` as soon as one step produces text
 * and no tool call. A model that writes "接下来改 environment.ts" and then stops
 * therefore looks finished, and the turn closes mid-task. This plugin listens on
 * `agent/turn-stopping` — the one hook that runs while the turn is still open —
 * reads that turn's own log, and steers the agent when the trailing step is a
 * narration of work that no tool call performed.
 *
 * A steer keeps the *same* turn open and runs one more step, so no new user
 * message, no new turn, and no budget reset happens behind the user's back.
 *
 * @module dsh-early-stop-guard
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Config, resolveConfig } from './config.js'
import { decideTurn } from './decide.js'
import { readEvents, summarizeTurn } from './events.js'
import { classifyText, heuristicAction, verdictAction } from './heuristics.js'
import { createLogStore } from './logs.js'
import { askChain, createBreaker } from './providers.js'
import { createSecretStore } from './secrets.js'
import { renderState } from './summary.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'early-stop-guard'

/** The host LLM runtime, needed by the `llm` judge providers. */
export const inject = ['llm']

export { Config }

/** Base path of the HTTP surface the Settings page reads. */
const ROUTE_BASE = '/api/early-stop-guard'

/** Build a JSON response for the route surface. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Install the guard.
 *
 * @param ctx - plugin context.
 * @param config - plugin config as loaded from the profile entry.
 */
export function apply(ctx, config) {
  // The value a hook reads. Cordis re-applies this plugin with the new config
  // when the Settings page writes, so the closure only needs to be swappable.
  let current = () => config
  const getConfig = () => resolveConfig(current())

  const logs = createLogStore({
    enabled: config?.logs?.enabled !== false,
    maxRecords: config?.logs?.maxRecords,
    path: config?.logs?.path,
    logger: ctx.logger,
  })
  logs.hydrate().catch(() => {})
  const breaker = createBreaker({ failures: 3, cooldownMs: 600000 })
  // Keys live outside the settings wire; see lib/secrets.js.
  const secrets = createSecretStore({ logger: ctx.logger })

  /** Continuations already spent per turn; a new turn number resets it. */
  const spent = new Map()
  /** Turns waiting to see whether the last steer produced a real tool call. */
  const pendingProbe = new Map()

  const initial = getConfig()
  ctx.logger?.info?.(
    `[${name}] loaded: enabled=${initial.enabled} mode=${initial.dm.mode} `
    + `maxContinuations=${initial.maxContinuations} chain=${initial.providers.map(p => p.id).join('>') || '(empty)'} `
    + `log=${logs.enabled ? logs.path : 'off'}`,
  )

  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
    const policy = getConfig()
    if (!policy.enabled) return
    if (signal?.aborted) return

    const events = readEvents(agent.session)
    const summary = summarizeTurn(events, turn, policy.maxSteps)
    const probe = pendingProbe.get(turn)
    if (probe !== undefined) pendingProbe.delete(turn)

    const decision = await decideTurn({
      policy,
      summary,
      events,
      turn,
      probe,
      used: spent.get(turn) ?? 0,
      ctx,
      agent,
      signal,
      breaker,
      logger: ctx.logger,
      secrets,
      sessionId: agent?.session?.id ?? agent?.sessionId ?? null,
    })

    if (decision.exhausted) spent.set(turn, policy.maxContinuations)
    if (decision.skip) {
      if (policy.debug) logs.add(decision.record)
      return
    }
    logs.add(decision.record)
    if (decision.act !== 'continue') {
      if (policy.debug) ctx.logger?.info?.(`[${name}] turn ${turn}: ${decision.reason}`)
      return
    }
    if (signal?.aborted) return

    spent.set(turn, decision.nextUsed)
    pendingProbe.set(turn, { at: events.length })
    ctx.logger?.info?.(`[${name}] turn ${turn}: continuing (${decision.reason})`)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: policy.steerText }],
      source: { kind: 'plugin', plugin: name },
    }))
  })

  ctx.on('session/event', (_session, event) => {
    if (event?.type !== 'turn/end') return
    const turn = event.data?.turn
    if (turn === undefined) return
    spent.delete(turn)
    pendingProbe.delete(turn)
  })

  // HTTP surface for the Settings page. Registered lazily because a headless
  // profile has no Connection service and the guard must still work there.
  ctx.inject(['connection'], (scoped) => {
    const register = (route) => scoped.effect?.(
      () => scoped.connection.fetch.register(route),
      `early-stop-guard: ${route.path}`,
    )
    register({
      path: `${ROUTE_BASE}/status`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const policy = getConfig()
        const providers = []
        for (const provider of policy.providers) {
          const fromEnv = provider.apiKeyEnv ? Boolean(process.env[provider.apiKeyEnv]?.trim()) : false
          const stored = await secrets.has(provider.id)
          providers.push({
            id: provider.id,
            label: provider.label,
            kind: provider.kind,
            protocol: provider.protocol,
            model: provider.model || provider.llmModel,
            apiKeyEnv: provider.apiKeyEnv,
            hasApiKey: provider.kind === 'llm' ? null : stored || fromEnv,
            apiKeySource: stored ? 'settings' : fromEnv ? 'env' : null,
          })
        }
        return json({
          enabled: policy.enabled,
          mode: policy.dm.mode,
          maxContinuations: policy.maxContinuations,
          providers,
          breaker: breaker.snapshot(),
          log: { enabled: logs.enabled, path: logs.path, size: logs.size },
        })
      },
    })
    register({
      path: `${ROUTE_BASE}/secret`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, error: 'body must be JSON' }, 400)
        }
        const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
        const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : ''
        if (!id) return json({ ok: false, error: 'id is required' }, 400)
        if (!apiKey) return json({ ok: false, error: 'apiKey is required' }, 400)
        try {
          await secrets.set(id, apiKey)
        } catch (error) {
          ctx.logger?.warn?.(`[early-stop-guard] could not save the key for ${id}: ${error?.message}`)
          return json({ ok: false, error: 'could not write the key file' }, 500)
        }
        // The key itself is never echoed back.
        return json({ ok: true, id, hasApiKey: true })
      },
    })
    register({
      path: `${ROUTE_BASE}/secret/clear`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let payload
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, error: 'body must be JSON' }, 400)
        }
        const id = typeof payload?.id === 'string' ? payload.id.trim() : ''
        if (!id) return json({ ok: false, error: 'id is required' }, 400)
        try {
          await secrets.clear(id)
        } catch (error) {
          ctx.logger?.warn?.(`[early-stop-guard] could not clear the key for ${id}: ${error?.message}`)
          return json({ ok: false, error: 'could not write the key file' }, 500)
        }
        return json({ ok: true, id, hasApiKey: false })
      },
    })
    register({
      path: `${ROUTE_BASE}/logs`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const limit = new URL(request.url).searchParams.get('limit')
        return json({
          path: logs.path,
          enabled: logs.enabled,
          records: logs.list(limit ? Number(limit) : 100),
        })
      },
    })
    register({
      path: `${ROUTE_BASE}/logs/clear`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        await logs.clear()
        return json({ ok: true })
      },
    })
    register({
      path: `${ROUTE_BASE}/test`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const policy = getConfig()
        let payload
        try {
          payload = await request.json()
        } catch {
          return json({ ok: false, error: 'body must be JSON' }, 400)
        }
        const text = typeof payload?.text === 'string' ? payload.text : ''
        if (!text.trim()) return json({ ok: false, error: 'text is required' }, 400)
        const summary = {
          steps: [
            { step: 1, tools: Array.isArray(payload?.tools) ? payload.tools : ['read'] },
            { step: 2, tools: [] },
          ],
          text,
          userRequest: typeof payload?.userRequest === 'string' ? payload.userRequest : '(test)',
          totalSteps: 2,
          truncated: false,
        }
        const state = renderState(summary, policy.maxTailChars, policy.dm.stateChars)
        const result = await askChain({
          ctx,
          providers: policy.providers,
          state,
          agent: undefined,
          timeoutMs: policy.dm.timeoutMs,
          breaker,
          signal: request.signal,
          logger: ctx.logger,
          secrets,
        })
        const kind = classifyText(text)
        return json({
          ok: Boolean(result.verdict),
          kind,
          verdict: result.verdict,
          action: result.verdict
            ? verdictAction(result.verdict, policy.dm, kind)
            : heuristicAction(kind, policy.dm.mode),
          provider: result.providerId,
          latencyMs: result.latencyMs,
          attempts: result.attempts,
          state,
        })
      },
    })
  })

  // Kept for hosts that reload the plugin with new settings.
  ctx.on('dispose', () => {
    spent.clear()
    pendingProbe.clear()
  })
}

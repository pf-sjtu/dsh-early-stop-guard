/**
 * The judge chain: one ordered list of providers, tried until one answers.
 *
 * Two kinds share the chain. `decision` providers speak a decision-model wire
 * protocol and answer three calibrated probabilities in one round trip; `llm`
 * providers are ordinary chat models asked for the same three numbers as JSON,
 * which is the fallback when no decision model is configured or reachable.
 *
 * A provider that fails repeatedly is skipped for a cooldown window, so a dead
 * endpoint costs one timeout, not one timeout per turn.
 *
 * @module dsh-early-stop-guard/providers
 */

import { QUESTIONS } from './config.js'

/** System instructions for an `llm` provider asked to estimate the same three facts. */
export const LLM_JUDGE_PROMPT = [
  'You inspect one coding-agent turn that just ended.',
  'A turn ends whenever the agent writes text and calls no tool.',
  'Estimate three probabilities for its trailing message, each between 0 and 1:',
  '- narrates: the message announces or plans an action it has not performed yet,',
  '  so the task is unfinished ("接下来我改 X", "now I will run the tests").',
  '- asks_user: the message asks the human a question or needs a decision.',
  '- waiting: the message is parked on a background job, subagent, build, or download.',
  'A reported finished result, a question, and a wait are all completed turns;',
  'a promise of pending work is not.',
  'Reply with JSON only, no prose:',
  '{"narrates":0.0,"asks_user":0.0,"waiting":0.0}',
].join(' ')

/**
 * Per-provider circuit breaker.
 *
 * @param options - `failures` opens the circuit, `cooldownMs` closes it again.
 * @returns breaker with `open`, `ok`, and `fail`.
 */
export function createBreaker({ failures, cooldownMs }) {
  const state = new Map()
  return {
    /** Whether a provider is currently skipped. */
    open(id) {
      const entry = state.get(id)
      if (!entry || !entry.openUntil) return false
      if (Date.now() >= entry.openUntil) {
        state.delete(id)
        return false
      }
      return true
    },
    /** Record a success and clear the failure streak. */
    ok(id) {
      state.delete(id)
    },
    /** Record a failure and open the circuit once the streak is reached. */
    fail(id) {
      const entry = state.get(id) ?? { count: 0, openUntil: 0 }
      entry.count += 1
      if (failures > 0 && entry.count >= failures) {
        entry.openUntil = Date.now() + cooldownMs
        entry.count = 0
      }
      state.set(id, entry)
      return entry.openUntil > 0
    },
    /** Snapshot for diagnostics. */
    snapshot() {
      return [...state.entries()].map(([id, entry]) => ({ id, ...entry }))
    },
  }
}

/** Join a base URL and a path without doubling a separator. */
function joinUrl(baseUrl, path) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  if (base.endsWith(path)) return base
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** Read a probability out of whatever shape a provider used. */
function probability(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'boolean') return raw ? 1 : 0
  if (typeof raw === 'string') {
    const parsed = Number(raw.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (raw && typeof raw === 'object') {
    for (const key of ['noul', 'probability', 'prob', 'score', 'value', 'p']) {
      const found = probability(raw[key])
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Normalize a provider's answer map into the three probabilities. */
export function normalizeVerdict(answers) {
  const source = answers && typeof answers === 'object' ? answers : {}
  const pick = (...keys) => {
    for (const key of keys) {
      const found = probability(source[key])
      if (found !== undefined) return found
    }
    return undefined
  }
  return {
    narrates: pick('narrates', 'narrate', 'narration'),
    asksUser: pick('asks_user', 'asksUser', 'asks'),
    waiting: pick('waiting', 'wait', 'waits'),
  }
}

/** Whether a verdict carries at least one usable probability. */
export function verdictUsable(verdict) {
  return Boolean(verdict)
    && [verdict.narrates, verdict.asksUser, verdict.waiting].some(value => typeof value === 'number')
}

/** Extract the first JSON object from a model's text answer. */
export function parseJsonAnswer(text) {
  const value = typeof text === 'string' ? text : ''
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(value.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/** Combine a caller signal with a per-attempt timeout. */
function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(500, timeoutMs))
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

/** Resolution order: the configured route, then the live session route. */
function routeOf(agent) {
  try {
    const config = agent?.session?.requestHeader?.()?.config
    if (config?.provider && config?.model) {
      return { provider: config.provider, model: config.model }
    }
  } catch {
    // A core bump that drops requestHeader only costs the session-route
    // fallback; a configured route above still works.
  }
  return undefined
}

/**
 * Call one decision-model provider over the System One protocol.
 *
 * @param provider - resolved provider config.
 * @param request - `{ state, timeoutMs, signal, apiKey }`.
 * @returns three probabilities.
 */
export async function callSystemone(provider, request) {
  const questions = {}
  for (const question of QUESTIONS) {
    questions[question.id] = { type: 'noul', instructions: question.instructions }
  }
  const response = await fetch(joinUrl(provider.baseUrl, '/systemone'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${request.apiKey}`,
      // The gateway in front of this endpoint rejects some TLS fingerprints;
      // the reference client sends this agent and we match it.
      'user-agent': 'curl/8.7.1',
    },
    body: JSON.stringify({ model: provider.model, state: request.state, questions }),
    signal: withTimeout(request.signal, request.timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`systemone HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  const body = await response.json()
  const verdict = normalizeVerdict(body?.answers ?? body?.answer ?? body)
  if (!verdictUsable(verdict)) throw new Error('systemone returned no usable answers')
  return verdict
}

/**
 * Request-body dialects of the OpenAI-compatible chat API, tried in order.
 *
 * The parameter names are not interchangeable across the ecosystem: the GPT-5
 * generation rejects `max_tokens` ("use max_completion_tokens instead") and
 * refuses a non-default temperature, while older or self-hosted gateways
 * (vLLM, Ollama, several proxies) reject `max_completion_tokens`. Sending the
 * modern shape first and falling back only when the server names a parameter
 * keeps every dialect working without per-provider configuration.
 *
 * A token budget is always kept: reasoning models spend tokens before writing
 * the answer, and a tight or absent budget returns an empty string, which
 * looks exactly like a provider outage.
 */
const OPENAI_BODY_SHAPES = [
  { temperature: 0, max_completion_tokens: 600 },
  { temperature: 0, max_tokens: 600 },
  { max_completion_tokens: 600 },
  { max_tokens: 600 },
  {},
]

/**
 * The shape that last worked for one endpoint + model, so a fallback costs an
 * extra round trip once instead of on every judged turn.
 */
const openaiShapeCache = new Map()

function sameShape(left, right) {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
}

/**
 * Whether a failed response is worth retrying with another body shape: only a
 * client error that names one of the parameters we sent, never auth, quota or
 * an unknown model.
 */
function shapeWasRejected(status, text) {
  if (status !== 400 && status !== 422) return false
  return /(max_completion_tokens|max_tokens|temperature)/i.test(text)
}

/**
 * Call one provider speaking an OpenAI-compatible chat API and ask for JSON.
 *
 * @param provider - resolved provider config.
 * @param request - `{ state, timeoutMs, signal, apiKey }`.
 * @returns three probabilities.
 */
export async function callOpenaiCompatible(provider, request) {
  const model = typeof provider.model === 'string' ? provider.model.trim() : ''
  if (!model) {
    throw new Error(
      `provider ${provider.id} has no model configured: fill in Model in the Settings tab`,
    )
  }
  const headers = { 'content-type': 'application/json' }
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`
  const url = joinUrl(provider.baseUrl, '/chat/completions')
  const messages = [
    { role: 'system', content: LLM_JUDGE_PROMPT },
    { role: 'user', content: request.state },
  ]
  const cacheKey = `${provider.baseUrl}|${model}`
  const cached = openaiShapeCache.get(cacheKey)
  const shapes = cached
    ? [cached, ...OPENAI_BODY_SHAPES.filter(shape => !sameShape(shape, cached))]
    : OPENAI_BODY_SHAPES

  let rejection
  for (const shape of shapes) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, ...shape, messages }),
      signal: withTimeout(request.signal, request.timeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      const error = new Error(`openai-compatible HTTP ${response.status}: ${text.slice(0, 200)}`)
      if (!shapeWasRejected(response.status, text)) throw error
      rejection = error
      continue
    }
    openaiShapeCache.set(cacheKey, shape)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`openai-compatible answer was not JSON: ${text.slice(0, 120)}`)
    }
    const answer = body?.choices?.[0]?.message?.content ?? body?.choices?.[0]?.text ?? ''
    const verdict = normalizeVerdict(parseJsonAnswer(answer))
    if (!verdictUsable(verdict)) {
      throw new Error(`openai-compatible answer was not JSON: ${String(answer).slice(0, 120)}`)
    }
    return verdict
  }
  throw rejection ?? new Error('openai-compatible: no request body shape was accepted')
}

/**
 * Call one `llm` provider through the host's LLM runtime.
 *
 * @param ctx - plugin context exposing `ctx.llm`.
 * @param provider - resolved provider config.
 * @param request - `{ state, timeoutMs, signal, agent }`.
 * @returns three probabilities.
 */
export async function callLlm(ctx, provider, request) {
  const route = provider.llmProvider && provider.llmModel
    ? { provider: provider.llmProvider, model: provider.llmModel }
    : routeOf(request.agent)
  if (!route) throw new Error('no route: set llmProvider/llmModel or run inside a session')
  // Loaded on demand: a chain of decision models never needs the host LLM
  // runtime, and this module must stay importable outside a host (tests).
  const { BlockAssembler } = await import('@deepseek-ai/dsh-llm')
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider: route.provider,
    model: route.model,
    system: LLM_JUDGE_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.state }] }],
    maxTokens: 600,
    temperature: 0,
    signal: withTimeout(request.signal, request.timeoutMs),
  })) {
    assembler.push(chunk)
  }
  const finish = assembler.finish
  if (finish?.kind === 'error') {
    const detail = finish.failure?.message ?? JSON.stringify(finish.failure ?? {})
    throw new Error(`llm judge failed: ${detail}`)
  }
  const text = assembler.blocks()
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('')
  const verdict = normalizeVerdict(parseJsonAnswer(text))
  if (!verdictUsable(verdict)) throw new Error(`llm judge answer was not JSON: ${text.slice(0, 120)}`)
  return verdict
}

/**
 * Ask the chain for one verdict, in provider order.
 *
 * A provider that throws is recorded and the next one is tried; a provider whose
 * circuit is open is skipped without a network call. The caller treats a `null`
 * verdict as "no judge available" and falls back to heuristics, so a broken
 * chain can never wedge a turn.
 *
 * @param options - `{ ctx, providers, state, agent, timeoutMs, breaker, signal, logger, secrets }`.
 * @returns `{ verdict, providerId, latencyMs, attempts }`.
 */
export async function askChain(options) {
  const { ctx, providers, state, agent, timeoutMs, breaker, signal, logger, secrets } = options
  const attempts = []
  for (const provider of providers ?? []) {
    if (breaker?.open(provider.id)) {
      attempts.push({ id: provider.id, error: 'circuit-open' })
      continue
    }
    // A key saved in the Settings tab wins over the environment, so a key can be
    // added without restarting the Host.
    const stored = (await secrets?.lookup(provider.id)) ?? ''
    const apiKey = stored || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv]?.trim() : '') || ''
    if (provider.kind === 'decision' && provider.apiKeyEnv && !apiKey) {
      attempts.push({
        id: provider.id,
        error: `missing key for ${provider.id}: save one in the Settings tab or export ${provider.apiKeyEnv}`,
      })
      continue
    }
    const started = Date.now()
    try {
      const request = {
        state,
        apiKey,
        agent,
        signal,
        timeoutMs: Math.max(500, Math.min(provider.timeoutMs || timeoutMs, timeoutMs * 4)),
      }
      let verdict
      if (provider.kind === 'llm') {
        verdict = await callLlm(ctx, provider, request)
      } else if (provider.protocol === 'openai') {
        verdict = await callOpenaiCompatible(provider, request)
      } else {
        verdict = await callSystemone(provider, request)
      }
      const latencyMs = Date.now() - started
      breaker?.ok(provider.id)
      attempts.push({ id: provider.id, latencyMs })
      return { verdict, providerId: provider.id, latencyMs, attempts }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const opened = breaker?.fail(provider.id) ?? false
      attempts.push({ id: provider.id, error: message, circuitOpened: opened })
      logger?.warn?.(`[early-stop-guard] provider ${provider.id} failed: ${message}`)
      if (signal?.aborted) break
    }
  }
  return { verdict: null, providerId: null, latencyMs: 0, attempts }
}

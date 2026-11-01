/**
 * The whole per-turn decision, expressed as one pure-ish async function.
 *
 * Kept out of the hook wiring so it can be tested without a host: everything it
 * touches is passed in, and it returns the decision plus the log record instead
 * of performing side effects. `index.js` only reads events, calls this, and
 * steers or does not.
 *
 * @module dsh-early-stop-guard/decide
 */

import { sawToolCallSince } from './events.js'
import { classifyText, heuristicAction, precheck, verdictAction } from './heuristics.js'
import { askChain } from './providers.js'
import { renderState } from './summary.js'

/** Preview a long text for one log row. */
export function preview(text, limit = 240) {
  const value = typeof text === 'string' ? text.trim() : ''
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * Decide what to do with a turn that just produced text and no tool call.
 *
 * @param options - `{ policy, summary, events, turn, probe, used, ... }`.
 * @param options.policy - resolved configuration.
 * @param options.summary - facts from `summarizeTurn`.
 * @param options.events - session event snapshot used to verify a steer.
 * @param options.turn - the turn being evaluated.
 * @param options.probe - `{ at }` recorded when the previous steer was sent.
 * @param options.used - continuations already spent on this turn.
 * @param options.ctx - plugin context, for the `llm` judge providers.
 * @param options.agent - the agent being steered.
 * @param options.signal - turn-stopping signal.
 * @param options.breaker - per-provider circuit breaker.
 * @param options.logger - host logger.
 * @param options.sessionId - session identity for the log row.
 * @returns `{ act, reason, kind, verdict, skip, exhausted, nextUsed, record }`.
 */
export async function decideTurn(options) {
  const {
    policy, summary, events, turn, probe, used = 0,
    ctx, agent, signal, breaker, logger, secrets, sessionId = null,
  } = options
  const base = { sessionId, turn, provider: null, verdict: null }

  // A steer that produced no tool call at all means the model has nothing more
  // to do or will not be moved by words. Either way, stop spending on this turn.
  if (probe !== undefined && !sawToolCallSince(events, probe.at, turn)) {
    const record = { ...base, act: 'stop', reason: 'steer-produced-no-tool-call', steps: summary.totalSteps }
    return { act: 'stop', reason: record.reason, kind: null, verdict: null, skip: false, exhausted: true, nextUsed: used, record }
  }

  const gate = precheck(summary)
  if (!gate.pass) {
    const record = { ...base, act: 'skip', reason: gate.reason, steps: summary.totalSteps }
    return { act: 'stop', reason: gate.reason, kind: null, verdict: null, skip: true, exhausted: false, nextUsed: used, record }
  }

  if (used >= policy.maxContinuations) {
    const record = { ...base, act: 'stop', reason: 'budget-exhausted', steps: summary.totalSteps }
    return { act: 'stop', reason: record.reason, kind: null, verdict: null, skip: false, exhausted: false, nextUsed: used, record }
  }

  const kind = classifyText(summary.text)
  let action = heuristicAction(kind, policy.dm.mode, gate.empty === true)
  let verdict = null
  let providerId = null
  let latencyMs = 0
  let attempts = []

  if (action.act === 'ask') {
    const state = renderState(summary, policy.maxTailChars, policy.dm.stateChars)
    const result = await askChain({
      ctx,
      providers: policy.providers,
      state,
      agent,
      timeoutMs: policy.dm.timeoutMs,
      breaker,
      signal,
      logger,
      secrets,
    })
    attempts = result.attempts
    verdict = result.verdict
    providerId = result.providerId
    latencyMs = result.latencyMs
    // No judge reachable: keep the heuristic's conservative reading rather than
    // flipping a narration into a continuation on no evidence.
    action = verdict
      ? verdictAction(verdict, policy.dm, kind)
      : { act: 'stop', reason: `${kind}(no-judge)` }
  }

  const act = action.act === 'continue' ? 'continue' : 'stop'
  const record = {
    ...base,
    act,
    reason: action.reason,
    kind,
    steps: summary.totalSteps,
    text: preview(summary.text),
    userRequest: preview(summary.userRequest, 160),
    verdict,
    provider: providerId,
    latencyMs,
    attempts: attempts.length > 0 ? attempts : undefined,
  }
  return {
    act,
    reason: action.reason,
    kind,
    verdict,
    skip: false,
    exhausted: false,
    nextUsed: act === 'continue' ? used + 1 : used,
    record,
  }
}

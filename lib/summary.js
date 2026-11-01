/**
 * Render one turn's facts as the compact text a judge model receives.
 *
 * The judge request is deliberately self-contained: system instructions plus
 * this one string. Replaying the session would save at most a couple of
 * thousand tokens of miss while making every call slower, less predictable, and
 * more expensive as the session grows.
 *
 * @module dsh-early-stop-guard/summary
 */

/**
 * Shorten the trailing text, keeping both ends.
 *
 * A model states its next action near the front ("接下来…") and often restates
 * it at the very end, so the middle is what can be dropped.
 *
 * @param text - trailing assistant text.
 * @param limit - maximum characters to keep.
 * @returns the text, or its two ends with a middle marker.
 */
export function clipTail(text, limit) {
  const value = typeof text === 'string' ? text : ''
  if (value.length <= limit) return value
  const half = Math.floor(limit / 2)
  return `${value.slice(0, half)}\n...\n[truncated middle]\n...\n${value.slice(-Math.ceil(limit / 2))}`
}

/**
 * Render the facts a judge reads as plain text.
 *
 * @param summary - facts from `summarizeTurn`.
 * @param maxTailChars - characters of trailing text to keep.
 * @returns compact multi-line description of the turn.
 */
export function renderSummary(summary, maxTailChars) {
  const steps = summary?.steps ?? []
  const lines = steps.map(step => {
    const tools = step?.tools?.length ? step.tools.join(', ') : 'no tool call'
    return `  step ${step?.step ?? '?'}: ${tools}`
  })
  const shown = summary?.truncated
    ? `  (showing only the last ${steps.length} steps)`
    : ''
  const parts = [
    'Steps actually executed in this turn:',
    ...lines,
  ]
  if (shown) parts.push(shown)
  parts.push(
    '',
    'Trailing assistant message (text only, no tool call):',
    clipTail(summary?.text ?? '', maxTailChars),
    '',
    'The human request this turn is answering:',
    summary?.userRequest || '(unknown)',
  )
  return parts.filter(line => line !== '').join('\n')
}

/**
 * Build the `state` string for a decision-model call.
 *
 * The labels are what the model conditions on, so they are spelled out instead
 * of relying on position inside a formatted summary.
 *
 * @param summary - facts from `summarizeTurn`.
 * @param maxTailChars - characters of trailing text to keep.
 * @param stateChars - hard cap on the whole string.
 * @returns state text, truncated from the middle when over the cap.
 */
export function renderState(summary, maxTailChars, stateChars) {
  const steps = summary?.steps ?? []
  const executed = steps
    .map(step => `${step?.step ?? '?'}:${step?.tools?.length ? step.tools.join('+') : 'none'}`)
    .join(' | ')
  const state = [
    `[steps executed this turn] ${executed || '(none)'}`,
    `[trailing message, text only, no tool call] ${clipTail(summary?.text ?? '', maxTailChars)}`,
    `[human request being answered] ${summary?.userRequest || '(unknown)'}`,
  ].join('\n')
  if (state.length <= stateChars) return state
  return `${state.slice(0, stateChars)}\n[state truncated]`
}

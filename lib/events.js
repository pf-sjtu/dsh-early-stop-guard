/**
 * Read one turn's own session log back into the facts the guard decides on.
 *
 * Nothing here is inferred from prose: a step counts as having called a tool
 * only when an `assistant/message` inside that step really carried a
 * `tool-call` block.
 *
 * @module dsh-early-stop-guard/events
 */

/**
 * Read a session's immutable event log across host core versions.
 *
 * 0.1.1-rc.2 exposes `session.events`; 0.1.5-alpha.2 renamed it to
 * `session.snapshotEvents()`. Probe both so a core bump cannot silence the
 * guard.
 *
 * @param session - the agent's live session.
 * @returns a frozen event array, or an empty array when neither API exists.
 */
export function readEvents(session) {
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  if (session && Array.isArray(session.events)) return session.events
  return []
}

/** Human message bodies that carry no task information. */
const ACKNOWLEDGEMENTS = new Set([
  '继续', '继续吧', '接着', '继续搞', '继续做', '好的', '好', '嗯', '知道了', '可以', '行',
  'ok', 'okay', 'go on', 'continue', 'go', 'next', 'yes',
])

/** Whether one human message is a bare acknowledgement. */
function isAcknowledgement(text) {
  return ACKNOWLEDGEMENTS.has(text.trim().toLowerCase())
}

/** Join the text blocks of a message body. */
function textOf(blocks) {
  return (blocks ?? [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

/**
 * Reconstruct what actually happened in one turn.
 *
 * @param events - full session event log snapshot.
 * @param turn - turn whose steps should be summarized.
 * @param maxSteps - how many trailing steps to include.
 * @param maxRequests - how many substantive human requests to anchor on.
 * @returns per-step facts plus the trailing assistant text and the request.
 */
export function summarizeTurn(events, turn, maxSteps, maxRequests = 3) {
  const steps = []
  let current = null
  let lastText = ''
  let lastStep = null

  for (const event of events) {
    const data = event?.data
    if (data?.turn !== turn) continue
    if (event.type === 'step/start') {
      current = { step: data.step, tools: [], text: '' }
      lastStep = current
      steps.push(current)
      continue
    }
    if (event.type !== 'assistant/message') continue
    const blocks = data.message?.content ?? []
    const text = textOf(blocks)
    const tools = blocks
      .filter(block => block?.type === 'tool-call' && typeof block.name === 'string')
      .map(block => block.name)
    if (current !== null) {
      current.tools.push(...tools)
      if (text) current.text = text
    }
    if (text) lastText = text
  }

  const requests = []
  for (let index = events.length - 1; index >= 0 && requests.length < maxRequests; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const data = event.data
    if (data?.turn > turn) continue
    if (data?.source?.kind !== 'user') continue
    const text = textOf(data.content).trim()
    if (!text || isAcknowledgement(text)) continue
    requests.unshift(text)
  }
  // Every preceding human message was a bare "继续"; a weak anchor beats none.
  if (requests.length === 0) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'user/message') continue
      const data = event.data
      if (data?.turn > turn) continue
      if (data?.source?.kind !== 'user') continue
      const text = textOf(data.content).trim()
      if (text) {
        requests.push(text)
        break
      }
    }
  }

  const window = steps.slice(-maxSteps)
  return {
    steps: window,
    text: lastText,
    userRequest: requests.join('\n'),
    lastStep,
    truncated: steps.length > window.length,
    totalSteps: steps.length,
  }
}

/**
 * Whether a tool call landed after a given event index within the same turn.
 *
 * Used to tell a genuine continuation from a model that answers a steer with
 * another narration: the guard stops spending on a turn once a steer produced
 * no tool call at all.
 *
 * @param events - session event log snapshot.
 * @param fromIndex - event count reported when the steer was sent.
 * @param turn - the turn being observed.
 * @returns whether any step after the steer carried a tool call.
 */
export function sawToolCallSince(events, fromIndex, turn) {
  for (let index = Math.max(0, fromIndex); index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== 'assistant/message') continue
    const data = event.data
    if (data?.turn !== turn) continue
    const blocks = data.message?.content ?? []
    if (blocks.some(block => block?.type === 'tool-call')) return true
  }
  return false
}

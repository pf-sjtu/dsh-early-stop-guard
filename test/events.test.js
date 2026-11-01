import assert from 'node:assert/strict'
import test from 'node:test'

import { readEvents, sawToolCallSince, summarizeTurn } from '../lib/events.js'

const text = (value) => ({ type: 'text', text: value })
const tool = (name) => ({ type: 'tool-call', name })

const stepStart = (turn, step) => ({ type: 'step/start', data: { turn, step } })
const assistant = (turn, blocks) => ({ type: 'assistant/message', data: { turn, message: { content: blocks } } })
const human = (turn, value, source = { kind: 'user' }) => ({
  type: 'user/message',
  data: { turn, content: [text(value)], source },
})

test('readEvents prefers snapshotEvents and falls back to events', () => {
  const snapshot = [{ type: 'turn/start' }]
  assert.equal(readEvents({ snapshotEvents: () => snapshot }), snapshot)
  assert.equal(readEvents({ events: snapshot }), snapshot)
  assert.deepEqual(readEvents({}), [])
  assert.deepEqual(readEvents(undefined), [])
})

test('summarizeTurn collects per-step tools and the trailing text', () => {
  const events = [
    human(1, '修一下 platform.ts'),
    stepStart(1, 1),
    assistant(1, [text('先读文件。'), tool('read')]),
    stepStart(1, 2),
    assistant(1, [text('接下来改 environment.ts。')]),
  ]
  const summary = summarizeTurn(events, 1, 8)
  assert.equal(summary.steps.length, 2)
  assert.deepEqual(summary.steps[0].tools, ['read'])
  assert.deepEqual(summary.steps[1].tools, [])
  assert.equal(summary.text, '接下来改 environment.ts。')
  assert.equal(summary.totalSteps, 2)
  assert.equal(summary.truncated, false)
  assert.equal(summary.userRequest, '修一下 platform.ts')
})

test('summarizeTurn ignores other turns and keeps only the trailing window', () => {
  const events = []
  for (let index = 1; index <= 5; index += 1) {
    events.push(stepStart(1, index), assistant(1, [tool(`tool${index}`)]))
  }
  events.push(stepStart(2, 1), assistant(2, [text('第二个回合。')]))
  const summary = summarizeTurn(events, 2, 8)
  assert.equal(summary.totalSteps, 1)
  assert.equal(summary.text, '第二个回合。')

  const windowed = summarizeTurn(events, 1, 2)
  assert.equal(windowed.totalSteps, 5)
  assert.equal(windowed.truncated, true)
  assert.deepEqual(windowed.steps.map(entry => entry.step), [4, 5])
})

test('summarizeTurn anchors on substantive requests, skipping bare "继续"', () => {
  const events = [
    human(1, '继续'),
    human(2, '把平台的 17 项测试跑通'),
    human(3, '好的'),
    stepStart(3, 1),
    assistant(3, [text('接下来改 deployment.ts。')]),
  ]
  assert.equal(summarizeTurn(events, 3, 8).userRequest, '把平台的 17 项测试跑通')
})

test('summarizeTurn falls back to the last acknowledgement when nothing else exists', () => {
  const events = [
    human(1, '继续'),
    stepStart(1, 1),
    assistant(1, [text('接下来改 deployment.ts。')]),
  ]
  assert.equal(summarizeTurn(events, 1, 8).userRequest, '继续')
})

test('summarizeTurn only reads messages the human wrote', () => {
  const events = [
    { type: 'user/message', data: { turn: 1, content: [text('插件的 steer')], source: { kind: 'plugin', plugin: 'x' } } },
    stepStart(1, 1),
    assistant(1, [text('接下来改 a.ts。')]),
  ]
  assert.equal(summarizeTurn(events, 1, 8).userRequest, '')
})

test('sawToolCallSince detects a tool call after the steer point', () => {
  const events = [
    stepStart(1, 1),
    assistant(1, [tool('read')]),
    stepStart(1, 2),
    assistant(1, [text('接下来改 a.ts。')]),
  ]
  assert.equal(sawToolCallSince(events, 0, 1), true)
  assert.equal(sawToolCallSince(events, events.length, 1), false)
  // A tool call belongs to its own turn only.
  assert.equal(sawToolCallSince(events, 0, 2), false)
})

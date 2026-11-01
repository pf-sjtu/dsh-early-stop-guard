import assert from 'node:assert/strict'
import test from 'node:test'

import { clipTail, renderState, renderSummary } from '../lib/summary.js'

const summary = {
  steps: [
    { step: 1, tools: ['read'], text: '' },
    { step: 2, tools: [], text: '接下来改 environment.ts。' },
  ],
  text: '接下来改 environment.ts。',
  userRequest: '把平台层跑通',
  totalSteps: 2,
  truncated: false,
}

test('clipTail keeps both ends of a long text', () => {
  const text = `开头${'x'.repeat(300)}结尾`
  const clipped = clipTail(text, 100)
  assert.ok(clipped.startsWith('开头'))
  assert.ok(clipped.endsWith('结尾'))
  assert.ok(clipped.includes('[truncated middle]'))
  assert.ok(clipped.length < text.length)
})

test('clipTail leaves a short text untouched', () => {
  assert.equal(clipTail('短文本', 100), '短文本')
  assert.equal(clipTail(undefined, 100), '')
})

test('renderSummary names the steps, the trailing text and the request', () => {
  const rendered = renderSummary(summary, 200)
  assert.match(rendered, /step 1: read/)
  assert.match(rendered, /step 2: no tool call/)
  assert.match(rendered, /Trailing assistant message/)
  assert.match(rendered, /接下来改 environment\.ts。/)
  assert.match(rendered, /把平台层跑通/)
  assert.doesNotMatch(rendered, /showing only/)
})

test('renderSummary notes a truncated window and an unknown request', () => {
  const rendered = renderSummary({ ...summary, truncated: true, userRequest: '' }, 200)
  assert.match(rendered, /showing only the last 2 steps/)
  assert.match(rendered, /\(unknown\)/)
})

test('renderState labels each fact the decision model conditions on', () => {
  const state = renderState(summary, 200, 4000)
  assert.match(state, /\[steps executed this turn\] 1:read \| 2:none/)
  assert.match(state, /\[trailing message, text only, no tool call\] 接下来改 environment\.ts。/)
  assert.match(state, /\[human request being answered\] 把平台层跑通/)
})

test('renderState caps the whole string', () => {
  const state = renderState(summary, 200, 40)
  assert.ok(state.length < 120)
  assert.match(state, /\[state truncated\]/)
})

test('renderState survives an empty summary', () => {
  const state = renderState({ steps: [], text: '', userRequest: '' }, 200, 4000)
  assert.match(state, /\[steps executed this turn\] \(none\)/)
})

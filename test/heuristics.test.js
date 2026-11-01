import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyText,
  heuristicAction,
  precheck,
  verdictAction,
} from '../lib/heuristics.js'

/** Build a step list where only the last step lacks a tool call. */
const narrating = (text) => [
  { step: 1, tools: ['read'], text: '先读文件。' },
  { step: 2, tools: [], text },
]

const step = (tools, text = '') => ({ step: 1, tools, text })

test('precheck rejects the three shapes that cannot be a mid-task stop', () => {
  assert.deepEqual(precheck({ steps: [] }), { pass: false, reason: 'no-steps' })
  assert.deepEqual(
    precheck({ steps: [step(['read']), step(['edit'])] }),
    { pass: false, reason: 'last-step-called-tool' },
  )
  // A one-step answer with no tool at all is a plain reply, not a lost turn.
  assert.deepEqual(precheck({ steps: [step([], '你好')] }), { pass: false, reason: 'no-tool-in-turn' })
})

test('precheck passes a narration and flags a step with no text', () => {
  assert.deepEqual(precheck({ steps: narrating('接下来改 a.ts'), text: '接下来改 a.ts' }), {
    pass: true,
    reason: 'narration',
  })
  assert.deepEqual(precheck({ steps: narrating(''), text: '' }), {
    pass: true,
    reason: 'empty-text',
    empty: true,
  })
})

test('classifyText prefers waiting and asking over narrating', () => {
  assert.equal(classifyText('后台 job-7f2a 已经跑起来了，等它出结果。'), 'wait')
  assert.equal(classifyText('是直接改现有文件，还是先克隆一份？'), 'ask')
  assert.equal(classifyText('接下来改 environment.ts 与 deployment.ts。'), 'forward')
  assert.equal(classifyText('全部完成，测试通过，已提交 3a4f2b1。'), 'done')
  assert.equal(classifyText('好的。'), 'gray')
  assert.equal(classifyText(undefined), 'gray')
})

test('heuristicAction: empty text continues, done and wait stop', () => {
  assert.deepEqual(heuristicAction('gray', 'auto', true), { act: 'continue', reason: 'empty-text' })
  assert.deepEqual(heuristicAction('done', 'auto'), { act: 'stop', reason: 'done' })
  assert.deepEqual(heuristicAction('wait', 'always'), { act: 'stop', reason: 'wait' })
  assert.deepEqual(heuristicAction('ask', 'always'), { act: 'stop', reason: 'ask' })
})

test('heuristicAction: auto asks the chain on narration only', () => {
  assert.deepEqual(heuristicAction('forward', 'auto'), { act: 'ask', reason: 'forward-intent' })
  // Gray is a finished-looking summary; asking a model about every one of them
  // would put a network call on almost every turn.
  assert.deepEqual(heuristicAction('gray', 'auto'), { act: 'stop', reason: 'gray' })
  assert.deepEqual(heuristicAction('gray', 'always'), { act: 'ask', reason: 'gray-band' })
})

test('heuristicAction: off never calls the chain', () => {
  assert.deepEqual(heuristicAction('forward', 'off'), { act: 'continue', reason: 'forward-intent(no-dm)' })
  assert.deepEqual(heuristicAction('gray', 'off'), { act: 'stop', reason: 'gray(no-dm)' })
})

test('verdictAction ends the turn when the model says it is waiting or asking', () => {
  const policy = { threshold: 0.5, askThreshold: 0.4, waitThreshold: 0.5 }
  // Measured on the real calibration set: the waiting case scored 0.645 on
  // `narrates` and the asking case 0.536, so order decides the outcome.
  assert.deepEqual(
    verdictAction({ narrates: 0.645, asksUser: 0.046, waiting: 0.971 }, policy, 'wait'),
    { act: 'stop', reason: 'wait-external' },
  )
  assert.deepEqual(
    verdictAction({ narrates: 0.536, asksUser: 0.961, waiting: 0.047 }, policy, 'forward'),
    { act: 'stop', reason: 'needs-user' },
  )
})

test('verdictAction continues a narration and stops a reported result', () => {
  const policy = { threshold: 0.5, askThreshold: 0.4, waitThreshold: 0.5 }
  assert.deepEqual(
    verdictAction({ narrates: 0.946, asksUser: 0.022, waiting: 0.024 }, policy, 'forward'),
    { act: 'continue', reason: 'narrated' },
  )
  assert.deepEqual(
    verdictAction({ narrates: 0.018, asksUser: 0.023, waiting: 0.018 }, policy, 'done'),
    { act: 'stop', reason: 'not-narrated' },
  )
  assert.deepEqual(
    verdictAction({ narrates: 0.3, asksUser: 0.1, waiting: 0.1 }, policy, 'forward'),
    { act: 'stop', reason: 'forward-denied' },
  )
})

test('verdictAction ignores probabilities a provider did not answer', () => {
  const policy = { threshold: 0.5, askThreshold: 0.4, waitThreshold: 0.5 }
  assert.deepEqual(verdictAction({ narrates: 0.9 }, policy, 'gray'), { act: 'continue', reason: 'narrated' })
  assert.deepEqual(verdictAction({}, policy, 'gray'), { act: 'stop', reason: 'not-narrated' })
})

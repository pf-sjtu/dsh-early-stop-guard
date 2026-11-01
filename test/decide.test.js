import assert from 'node:assert/strict'
import test from 'node:test'

import { decideTurn } from '../lib/decide.js'
import { resolveConfig } from '../lib/config.js'
import { createBreaker } from '../lib/providers.js'

/** Facts for a turn whose last step narrated pending work. */
const narration = {
  steps: [
    { step: 1, tools: ['read'], text: '' },
    { step: 2, tools: [], text: '接下来改 environment.ts。先读全文取准确行文。' },
  ],
  text: '接下来改 environment.ts。先读全文取准确行文。',
  userRequest: '把平台层跑通',
  totalSteps: 2,
  truncated: false,
}

const events = [
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'tool-call', name: 'read' }] } } },
  { type: 'step/start', data: { turn: 1, step: 2 } },
  { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: narration.text }] } } },
]

const policy = resolveConfig({ providers: [{ id: 'test', kind: 'decision', baseUrl: 'https://judge.test/v1', model: 'm', apiKeyEnv: 'ESG_TEST_KEY' }] })

/** A stub server that answers one System One response. */
function stubFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => handler(String(url), init)
  return () => {
    globalThis.fetch = original
  }
}

const answer = (narrates, asks, waiting) => new Response(JSON.stringify({
  answers: {
    narrates: { noul: narrates, type: 'noul' },
    asks_user: { noul: asks, type: 'noul' },
    waiting: { noul: waiting, type: 'noul' },
  },
}), { status: 200, headers: { 'content-type': 'application/json' } })

test('decideTurn continues a narration the decision model confirms', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  let seen
  const restore = stubFetch((url, init) => {
    seen = { url, init }
    return answer(0.946, 0.022, 0.024)
  })
  try {
    const decision = await decideTurn({ policy, summary: narration, events, turn: 1, used: 0, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
    assert.equal(decision.act, 'continue')
    assert.equal(decision.reason, 'narrated')
    assert.equal(decision.nextUsed, 1)
    assert.equal(decision.record.provider, 'test')
    assert.equal(decision.record.verdict.narrates, 0.946)
    // The wire format is the one the reference client uses.
    assert.equal(seen.url, 'https://judge.test/v1/systemone')
    const body = JSON.parse(seen.init.body)
    assert.equal(body.model, 'm')
    assert.equal(body.questions.narrates.type, 'noul')
    assert.deepEqual(Object.keys(body.questions), ['narrates', 'asks_user', 'waiting'])
    assert.equal(seen.init.headers.authorization, 'Bearer secret')
    assert.equal(seen.init.headers['user-agent'], 'curl/8.7.1')
    assert.match(body.state, /\[trailing message, text only, no tool call\]/)
  } finally {
    restore()
  }
})

test('decideTurn stops when the model reports a finished result', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const restore = stubFetch(() => answer(0.018, 0.023, 0.018))
  const finished = { step: 1, tools: ['bash'], text: '' }
  try {
    const decision = await decideTurn({
      policy,
      summary: {
        steps: [finished, { step: 2, tools: [], text: '全部完成，测试通过。' }],
        text: '全部完成，测试通过。',
        userRequest: '把平台层跑通',
        totalSteps: 2,
        truncated: false,
      },
      events,
      turn: 1,
      used: 0,
      ctx: {},
      breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
    })
    assert.equal(decision.act, 'stop')
    assert.equal(decision.reason, 'done')
    assert.equal(decision.nextUsed, 0)
    // A reported result is settled by the cheap gate: no judge round trip.
    assert.equal(decision.record.provider, null)
  } finally {
    restore()
  }
})

test('decideTurn stops a forward promise the model does not confirm', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const restore = stubFetch(() => answer(0.2, 0.1, 0.05))
  try {
    const decision = await decideTurn({ policy, summary: narration, events, turn: 1, used: 0, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
    assert.equal(decision.act, 'stop')
    assert.equal(decision.reason, 'forward-denied')
    assert.equal(decision.record.provider, 'test')
  } finally {
    restore()
  }
})

test('decideTurn stops when the model says the turn is waiting', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const restore = stubFetch(() => answer(0.645, 0.046, 0.971))
  try {
    const decision = await decideTurn({
      policy,
      summary: { ...narration, text: '接下来这步要等 CI 出结果才行，跑完我再看日志。' },
      events,
      turn: 1,
      used: 0,
      ctx: {},
      breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
    })
    assert.equal(decision.act, 'stop')
    assert.equal(decision.reason, 'wait-external')
  } finally {
    restore()
  }
})

test('decideTurn falls back to the next provider when one fails', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const two = resolveConfig({
    providers: [
      { id: 'broken', kind: 'decision', baseUrl: 'https://broken.test/v1', model: 'm', apiKeyEnv: 'ESG_TEST_KEY' },
      { id: 'good', kind: 'decision', baseUrl: 'https://good.test/v1', model: 'm', apiKeyEnv: 'ESG_TEST_KEY' },
    ],
  })
  const restore = stubFetch((url) => {
    if (url.startsWith('https://broken.test')) return new Response('boom', { status: 500 })
    return answer(0.9, 0.02, 0.02)
  })
  try {
    const decision = await decideTurn({ policy: two, summary: narration, events, turn: 1, used: 0, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
    assert.equal(decision.act, 'continue')
    assert.equal(decision.record.provider, 'good')
    assert.equal(decision.record.attempts[0].id, 'broken')
    assert.match(decision.record.attempts[0].error, /HTTP 500/)
  } finally {
    restore()
  }
})

test('decideTurn never continues a narration with no judge reachable', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const restore = stubFetch(() => {
    throw new Error('network down')
  })
  try {
    const decision = await decideTurn({ policy, summary: narration, events, turn: 1, used: 0, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
    assert.equal(decision.act, 'stop')
    assert.equal(decision.reason, 'forward(no-judge)')
  } finally {
    restore()
  }
})

test('decideTurn skips a provider whose key is missing', async () => {
  delete process.env.ESG_TEST_KEY
  let called = false
  const restore = stubFetch(() => {
    called = true
    return answer(0.9, 0.02, 0.02)
  })
  try {
    const decision = await decideTurn({ policy, summary: narration, events, turn: 1, used: 0, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
    assert.equal(called, false)
    assert.equal(decision.act, 'stop')
    assert.match(decision.record.attempts[0].error, /missing key for test: .*ESG_TEST_KEY/)
  } finally {
    restore()
  }
})

test('decideTurn skips shapes that cannot be a mid-task stop, without logging them as decisions', async () => {
  const decision = await decideTurn({
    policy,
    summary: { ...narration, steps: [{ step: 1, tools: ['read'], text: '' }] },
    events,
    turn: 1,
    used: 0,
    ctx: {},
    breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
  })
  assert.equal(decision.skip, true)
  assert.equal(decision.reason, 'last-step-called-tool')
  assert.equal(decision.record.act, 'skip')
})

test('decideTurn continues an empty trailing step without asking a model', async () => {
  let called = false
  const restore = stubFetch(() => {
    called = true
    return answer(0.9, 0.02, 0.02)
  })
  try {
    const decision = await decideTurn({
      policy,
      summary: { ...narration, text: '', steps: [{ step: 1, tools: ['read'] }, { step: 2, tools: [] }] },
      events,
      turn: 1,
      used: 0,
      ctx: {},
      breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
    })
    assert.equal(decision.act, 'continue')
    assert.equal(decision.reason, 'empty-text')
    assert.equal(called, false)
  } finally {
    restore()
  }
})

test('decideTurn spends nothing once the per-turn budget is used up', async () => {
  const decision = await decideTurn({ policy, summary: narration, events, turn: 1, used: 3, ctx: {}, breaker: createBreaker({ failures: 3, cooldownMs: 1000 }) })
  assert.equal(decision.act, 'stop')
  assert.equal(decision.reason, 'budget-exhausted')
})

test('a steer that produced no tool call ends the turn for good', async () => {
  const decision = await decideTurn({
    policy,
    summary: narration,
    events,
    turn: 1,
    used: 1,
    probe: { at: events.length },
    ctx: {},
    breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
  })
  assert.equal(decision.act, 'stop')
  assert.equal(decision.reason, 'steer-produced-no-tool-call')
  assert.equal(decision.exhausted, true)
})

test('a steer that produced a tool call lets the guard keep deciding', async () => {
  process.env.ESG_TEST_KEY = 'secret'
  const later = [
    ...events,
    { type: 'step/start', data: { turn: 1, step: 3 } },
    { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'tool-call', name: 'edit' }] } } },
  ]
  const restore = stubFetch(() => answer(0.9, 0.02, 0.02))
  try {
    const decision = await decideTurn({
      policy,
      summary: { ...narration, steps: [...narration.steps, { step: 3, tools: ['edit'] }] },
      events: later,
      turn: 1,
      used: 1,
      probe: { at: events.length },
      ctx: {},
      breaker: createBreaker({ failures: 3, cooldownMs: 1000 }),
    })
    assert.notEqual(decision.reason, 'steer-produced-no-tool-call')
  } finally {
    restore()
  }
})

// The hook wiring itself: does a narrating turn actually re-open the turn?
import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { DEFAULT_STEER_TEXT } from '../lib/config.js'

/** Minimal cordis context: records handlers, no connection service. */
function createCtx() {
  const handlers = new Map()
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(handler)
    },
    // A headless profile has no Connection service; the guard must still load.
    inject() {},
    effect(fn) {
      fn()
    },
  }
  const emit = async (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) await handler(...args)
  }
  return { ctx, emit, handlers }
}

/** Session log for a turn that ran one real tool then only narrated. */
function narratingEvents(turn = 1) {
  return [
    {
      type: 'user/message',
      data: {
        turn,
        source: { kind: 'user' },
        content: [{ type: 'text', text: '继续处理插件兼容问题，先在隔离 profile 验证。' }],
      },
    },
    { type: 'step/start', data: { turn, step: 1 } },
    { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'tool-call', name: 'read', arguments: '{}' }] } } },
    { type: 'step/start', data: { turn, step: 2 } },
    {
      type: 'assistant/message',
      data: {
        turn,
        step: 2,
        message: { content: [{ type: 'text', text: '接下来改 environment.ts（shim 生成、env 依赖、origin 比较、mode）。先读全文取准确行文。' }] },
      },
    },
  ]
}

function stubJudge(narrates = 0.93) {
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({
      answers: {
        narrates: { noul: narrates, type: 'noul' },
        asks_user: { noul: 0.02, type: 'noul' },
        waiting: { noul: 0.03, type: 'noul' },
      },
      model: 'stub',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = previous } }
}

function config(overrides = {}) {
  return {
    enabled: true,
    logs: { enabled: false },
    dm: { mode: 'auto' },
    providers: [{
      id: 'stub',
      kind: 'decision',
      protocol: 'systemone',
      baseUrl: 'https://stub.test/v1',
      model: 'stub-decision',
      apiKeyEnv: 'STUB_DECISION_KEY',
    }],
    ...overrides,
  }
}

test('a narrating turn is steered back to work, once', async () => {
  process.env.STUB_DECISION_KEY = 'stub-key'
  const judge = stubJudge()
  try {
    const { ctx, emit } = createCtx()
    const events = narratingEvents()
    const steered = []
    const agent = {
      session: { id: 'session-test', snapshotEvents: () => events },
      steer: (message) => steered.push(message),
    }

    apply(ctx, config())
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })

    assert.equal(steered.length, 1)
    assert.equal(steered[0].content[0].text, DEFAULT_STEER_TEXT)
    assert.equal(steered[0].source.plugin, 'early-stop-guard')
    assert.equal(judge.calls.length, 1)

    // The steered step only narrated again: the guard must stop spending budget.
    events.push({ type: 'step/start', data: { turn: 1, step: 3 } })
    events.push({
      type: 'assistant/message',
      data: { turn: 1, step: 3, message: { content: [{ type: 'text', text: '接下来我继续改 deployment.ts 的路径校验。' }] } },
    })
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 1, 'a steer that produced no tool call ends the budget')
    assert.equal(judge.calls.length, 1, 'the probe answers before any further judge call')
  } finally {
    judge.restore()
  }
})

test('a steered step that calls a tool is steered again when it narrates later', async () => {
  process.env.STUB_DECISION_KEY = 'stub-key'
  const judge = stubJudge()
  try {
    const { ctx, emit } = createCtx()
    const events = narratingEvents()
    const steered = []
    const agent = {
      session: { id: 'session-test', snapshotEvents: () => events },
      steer: (message) => steered.push(message),
    }

    apply(ctx, config({ maxContinuations: 2 }))
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 1)

    // The steer worked: this step actually called a tool.
    events.push({ type: 'step/start', data: { turn: 1, step: 3 } })
    events.push({ type: 'assistant/message', data: { turn: 1, step: 3, message: { content: [{ type: 'tool-call', name: 'write', arguments: '{}' }] } } })
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 1, 'no trailing narration yet, nothing to steer')

    // Then it narrates once more and stalls.
    events.push({ type: 'step/start', data: { turn: 1, step: 4 } })
    events.push({
      type: 'assistant/message',
      data: { turn: 1, step: 4, message: { content: [{ type: 'text', text: '接下来跑一遍测试套件。' }] } },
    })
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 2)
  } finally {
    judge.restore()
  }
})

test('a finished turn is not steered and costs no judge call', async () => {
  process.env.STUB_DECISION_KEY = 'stub-key'
  const judge = stubJudge()
  try {
    const { ctx, emit } = createCtx()
    const events = narratingEvents()
    events[3] = {
      type: 'assistant/message',
      data: { turn: 1, step: 2, message: { content: [{ type: 'text', text: '全部完成，59 项测试通过，已提交。' }] } },
    }
    const steered = []
    const agent = {
      session: { id: 'session-test', snapshotEvents: () => events },
      steer: (message) => steered.push(message),
    }

    apply(ctx, config())
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })

    assert.equal(steered.length, 0)
    assert.equal(judge.calls.length, 0)
  } finally {
    judge.restore()
  }
})

test('turn/end resets the per-turn budget', async () => {
  process.env.STUB_DECISION_KEY = 'stub-key'
  const judge = stubJudge()
  try {
    const { ctx, emit } = createCtx()
    const events = narratingEvents()
    const steered = []
    const agent = {
      session: { id: 'session-test', snapshotEvents: () => events },
      steer: (message) => steered.push(message),
    }

    apply(ctx, config({ maxContinuations: 1 }))
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 1, 'budget of one is spent')

    await emit('session/event', null, { type: 'turn/end', data: { turn: 1 } })
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })
    assert.equal(steered.length, 2, 'a new turn starts with a fresh budget')
  } finally {
    judge.restore()
  }
})

test('the kill switch stops everything', async () => {
  process.env.STUB_DECISION_KEY = 'stub-key'
  const judge = stubJudge()
  try {
    const { ctx, emit } = createCtx()
    const events = narratingEvents()
    const steered = []
    const agent = {
      session: { id: 'session-test', snapshotEvents: () => events },
      steer: (message) => steered.push(message),
    }

    apply(ctx, config({ enabled: false }))
    await emit('agent/turn-stopping', { agent, turn: 1, signal: undefined })

    assert.equal(steered.length, 0)
    assert.equal(judge.calls.length, 0)
  } finally {
    judge.restore()
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  callOpenaiCompatible,
  createBreaker,
  normalizeVerdict,
  parseJsonAnswer,
  verdictUsable,
} from '../lib/providers.js'

test('normalizeVerdict reads the System One answer map', () => {
  assert.deepEqual(
    normalizeVerdict({
      narrates: { noul: 0.946, type: 'noul' },
      asks_user: { noul: 0.022, type: 'noul' },
      waiting: { noul: 0.024, type: 'noul' },
    }),
    { narrates: 0.946, asksUser: 0.022, waiting: 0.024 },
  )
})

test('normalizeVerdict tolerates camelCase, bare numbers and strings', () => {
  assert.deepEqual(
    normalizeVerdict({ narrate: 0.9, asksUser: '0.1', wait: 0.05 }),
    { narrates: 0.9, asksUser: 0.1, waiting: 0.05 },
  )
  assert.deepEqual(
    normalizeVerdict({ narrates: { probability: 0.7 }, asks_user: { score: 0.2 }, waiting: { p: 0.1 } }),
    { narrates: 0.7, asksUser: 0.2, waiting: 0.1 },
  )
})

test('normalizeVerdict leaves unanswered questions undefined', () => {
  const verdict = normalizeVerdict({ narrates: 0.4 })
  assert.equal(verdict.narrates, 0.4)
  assert.equal(verdict.asksUser, undefined)
  assert.equal(verdict.waiting, undefined)
  assert.deepEqual(normalizeVerdict(null), { narrates: undefined, asksUser: undefined, waiting: undefined })
})

test('verdictUsable requires at least one real probability', () => {
  assert.equal(verdictUsable({ narrates: 0.4, asksUser: undefined, waiting: undefined }), true)
  assert.equal(verdictUsable({ narrates: undefined, asksUser: undefined, waiting: undefined }), false)
  assert.equal(verdictUsable(null), false)
})

test('parseJsonAnswer extracts JSON from prose or a code fence', () => {
  assert.deepEqual(parseJsonAnswer('{"narrates":0.9}'), { narrates: 0.9 })
  assert.deepEqual(parseJsonAnswer('答案如下：\n```json\n{"narrates":0.9}\n```\n完毕'), { narrates: 0.9 })
  assert.equal(parseJsonAnswer('no json here'), undefined)
  assert.equal(parseJsonAnswer('{ broken'), undefined)
  assert.equal(parseJsonAnswer(undefined), undefined)
})

test('createBreaker opens after the configured streak and closes after cooldown', () => {
  const breaker = createBreaker({ failures: 3, cooldownMs: 50 })
  assert.equal(breaker.open('a'), false)
  breaker.fail('a')
  breaker.fail('a')
  assert.equal(breaker.open('a'), false)
  breaker.fail('a')
  assert.equal(breaker.open('a'), true)
  assert.equal(breaker.open('b'), false)
  breaker.ok('a')
  assert.equal(breaker.open('a'), false)
})

test('createBreaker reports the open window in its snapshot', () => {
  const breaker = createBreaker({ failures: 1, cooldownMs: 10_000 })
  breaker.fail('a')
  const [entry] = breaker.snapshot()
  assert.equal(entry.id, 'a')
  assert.ok(entry.openUntil > Date.now())
})

test('createBreaker with failures=0 never opens', () => {
  const breaker = createBreaker({ failures: 0, cooldownMs: 1000 })
  for (let index = 0; index < 10; index += 1) breaker.fail('a')
  assert.equal(breaker.open('a'), false)
})

const ANSWER = '{"narrates":0.9,"asks_user":0.1,"waiting":0.2}'

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

/** Runs `run` with a stubbed global fetch and always restores the real one. */
async function withFetch(handler, run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    return handler(body)
  }
  try {
    await run(calls)
  } finally {
    globalThis.fetch = original
  }
}

function providerFor(baseUrl, model = 'gpt-5-mini') {
  return { id: 'openai-test', kind: 'decision', protocol: 'openai', baseUrl, model, apiKeyEnv: 'OPENAI_API_KEY' }
}

const rejection = (message) => (body) => reply(400, { error: { message } })

test('callOpenaiCompatible drops max_tokens and temperature for a GPT-5 style model', async () => {
  const reject = (body) => {
    if ('max_tokens' in body) {
      return reply(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } })
    }
    if ('temperature' in body) {
      return reply(400, { error: { message: "Unsupported value: 'temperature' does not support 0 with this model." } })
    }
    return reply(200, { choices: [{ message: { content: ANSWER } }] })
  }
  await withFetch(reject, async (calls) => {
    const verdict = await callOpenaiCompatible(
      providerFor('https://gpt5.example/v1'),
      { state: 'trailing message', timeoutMs: 1000, apiKey: 'sk-test' },
    )
    assert.deepEqual(verdict, { narrates: 0.9, asksUser: 0.1, waiting: 0.2 })
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[2], {
      model: 'gpt-5-mini',
      max_completion_tokens: 600,
      messages: [
        { role: 'system', content: calls[2].messages[0].content },
        { role: 'user', content: 'trailing message' },
      ],
    })
  })
})

test('callOpenaiCompatible falls back to max_tokens for an older gateway', async () => {
  const reject = (body) => {
    if ('max_completion_tokens' in body) {
      return reply(400, { error: { message: 'Unrecognized request argument supplied: max_completion_tokens' } })
    }
    return reply(200, { choices: [{ message: { content: ANSWER } }] })
  }
  await withFetch(reject, async (calls) => {
    const verdict = await callOpenaiCompatible(
      providerFor('https://legacy.example/v1', 'kimi-k2'),
      { state: 'trailing message', timeoutMs: 1000 },
    )
    assert.equal(verdict.narrates, 0.9)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].max_tokens, 600)
  })
})

test('callOpenaiCompatible remembers the shape that worked for one endpoint', async () => {
  let calls = 0
  const reject = (body) => {
    calls += 1
    if ('temperature' in body || 'max_tokens' in body) return reply(400, { error: { message: "Unsupported value: 'temperature'" } })
    return reply(200, { choices: [{ message: { content: ANSWER } }] })
  }
  await withFetch(reject, async () => {
    const provider = providerFor('https://cached.example/v1')
    const request = { state: 'trailing message', timeoutMs: 1000 }
    await callOpenaiCompatible(provider, request)
    const afterFirst = calls
    await callOpenaiCompatible(provider, request)
    assert.equal(afterFirst, 3, 'first call walks the ladder')
    assert.equal(calls, 4, 'second call goes straight to the working shape')
  })
})

test('callOpenaiCompatible refuses an empty model without calling the endpoint', async () => {
  await withFetch(() => reply(200, {}), async (calls) => {
    await assert.rejects(
      callOpenaiCompatible(providerFor('https://empty.example/v1', '   '), { state: 'x', timeoutMs: 1000 }),
      /provider openai-test has no model configured: fill in Model in the Settings tab/,
    )
    assert.equal(calls.length, 0)
  })
})

test('callOpenaiCompatible does not retry a failure that is not about parameters', async () => {
  await withFetch(rejection('Incorrect API key provided'), async (calls) => {
    await assert.rejects(
      callOpenaiCompatible(providerFor('https://auth.example/v1'), { state: 'x', timeoutMs: 1000, apiKey: 'bad' }),
      /openai-compatible HTTP 400: .*Incorrect API key/,
    )
    assert.equal(calls.length, 1)
  })
})

test('callOpenaiCompatible reports prose instead of JSON', async () => {
  await withFetch(
    () => reply(200, { choices: [{ message: { content: 'I think the turn is over.' } }] }),
    async () => {
      await assert.rejects(
        callOpenaiCompatible(providerFor('https://prose.example/v1'), { state: 'x', timeoutMs: 1000 }),
        /openai-compatible answer was not JSON: I think the turn is over\./,
      )
    },
  )
})

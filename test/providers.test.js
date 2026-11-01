import assert from 'node:assert/strict'
import test from 'node:test'

import {
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

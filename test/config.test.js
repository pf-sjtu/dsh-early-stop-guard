import assert from 'node:assert/strict'
import test from 'node:test'

import {
  Config,
  DEFAULT_PROVIDERS,
  DEFAULT_STEER_TEXT,
  QUESTIONS,
  normalizeProvider,
  resolveConfig,
  unwrap,
} from '../lib/config.js'

/** Build a cosmokit volatile reference around a fixed value. */
function volatileRef(value) {
  const write = Symbol.for('cosmokit.volatile.write')
  return { get: () => value, [write]: () => {} }
}

test('every editable field is volatile so the Settings page can show it', () => {
  const volatileNodes = Object.entries(Config.dict)
    .filter(([, node]) => node.meta?.volatile === true)
    .map(([key]) => key)
  assert.deepEqual(volatileNodes.sort(), [
    'breaker', 'debug', 'dm', 'enabled', 'logs', 'maxContinuations',
    'maxSteps', 'maxTailChars', 'providers', 'steerText',
  ])
})

test('the provider chain ships a default so the form is never empty', () => {
  assert.deepEqual(Config.dict.providers.meta.default, DEFAULT_PROVIDERS)
})

test('unwrap dereferences volatile nodes at any depth', () => {
  const config = {
    enabled: volatileRef(true),
    dm: volatileRef({ mode: volatileRef('off'), threshold: volatileRef(0.7) }),
    providers: volatileRef([{ id: volatileRef('p1'), timeoutMs: volatileRef(9000) }]),
  }
  assert.deepEqual(unwrap(config), {
    enabled: true,
    dm: { mode: 'off', threshold: 0.7 },
    providers: [{ id: 'p1', timeoutMs: 9000 }],
  })
})

test('resolveConfig reads values through volatile references', () => {
  const policy = resolveConfig({
    enabled: volatileRef(false),
    maxContinuations: volatileRef(1),
    dm: volatileRef({ mode: volatileRef('always') }),
    providers: volatileRef([{ id: 'p1', kind: 'llm', enabled: volatileRef(false) }]),
  })
  assert.equal(policy.enabled, false)
  assert.equal(policy.maxContinuations, 1)
  assert.equal(policy.dm.mode, 'always')
  // The only configured provider is disabled, so the chain is empty rather than
  // silently falling back to the built-in default.
  assert.deepEqual(policy.providers, [])
})

test('the three questions are the predicates the thresholds apply to', () => {
  assert.deepEqual(QUESTIONS.map(question => question.id), ['narrates', 'asks_user', 'waiting'])
  for (const question of QUESTIONS) assert.ok(question.instructions.length > 40)
})

test('resolveConfig fills every default for an empty config', () => {
  const policy = resolveConfig({})
  assert.equal(policy.enabled, true)
  assert.equal(policy.maxContinuations, 3)
  assert.equal(policy.maxSteps, 8)
  assert.equal(policy.steerText, DEFAULT_STEER_TEXT)
  assert.equal(policy.dm.mode, 'auto')
  assert.equal(policy.dm.threshold, 0.5)
  assert.equal(policy.dm.askThreshold, 0.4)
  assert.equal(policy.dm.waitThreshold, 0.5)
  assert.equal(policy.breaker.failures, 3)
  assert.equal(policy.breaker.cooldownMs, 600000)
  assert.equal(policy.logs.enabled, true)
  assert.deepEqual(policy.providers.map(provider => provider.id), ['bamboonode', 'session-llm'])
})

test('resolveConfig clamps values a hand-edited profile could set', () => {
  const policy = resolveConfig({
    enabled: 'nope',
    maxContinuations: -4,
    maxSteps: 0,
    maxTailChars: 10,
    steerText: '   ',
    dm: { mode: 'sometimes', threshold: 4, askThreshold: -1, waitThreshold: 2, timeoutMs: 10, stateChars: 10 },
    breaker: { failures: -1, cooldownMs: 5 },
    logs: { maxRecords: 1 },
  })
  assert.equal(policy.enabled, true)
  assert.equal(policy.maxContinuations, 0)
  assert.equal(policy.maxSteps, 1)
  assert.equal(policy.maxTailChars, 200)
  assert.equal(policy.steerText, DEFAULT_STEER_TEXT)
  assert.equal(policy.dm.mode, 'auto')
  assert.equal(policy.dm.threshold, 1)
  assert.equal(policy.dm.askThreshold, 0)
  assert.equal(policy.dm.waitThreshold, 1)
  assert.equal(policy.dm.timeoutMs, 500)
  assert.equal(policy.dm.stateChars, 500)
  assert.equal(policy.breaker.failures, 0)
  assert.equal(policy.breaker.cooldownMs, 1000)
  assert.equal(policy.logs.maxRecords, 50)
})

test('resolveConfig reads an explicit kill switch', () => {
  assert.equal(resolveConfig({ enabled: false }).enabled, false)
  assert.equal(resolveConfig({ logs: { enabled: false } }).logs.enabled, false)
  assert.equal(resolveConfig({ debug: 'yes' }).debug, false)
  assert.equal(resolveConfig({ debug: true }).debug, true)
})

test('normalizeProvider keeps a usable decision provider', () => {
  const provider = normalizeProvider({
    id: 'luna',
    kind: 'decision',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'luna-1',
    apiKeyEnv: 'OPENAI_API_KEY',
  }, 0)
  assert.equal(provider.id, 'luna')
  assert.equal(provider.protocol, 'openai')
  // Decision models cold-start slowly; the default budget must not starve them.
  assert.equal(provider.timeoutMs, 20000)
  assert.equal(provider.enabled, true)
})

test('normalizeProvider accepts every decision dialect', () => {
  const decisions = normalizeProvider({
    id: 'openai-3',
    kind: 'decision',
    protocol: 'decisions',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
  }, 0)
  assert.equal(decisions.protocol, 'decisions')
  // An unknown dialect must not silently become something that answers differently.
  assert.equal(normalizeProvider({ id: 'x', protocol: 'chat', baseUrl: 'https://x', model: 'm' }, 0).protocol, 'systemone')
})

test('normalizeProvider drops providers that can never answer', () => {
  // Disabled entries are removed from the live chain, not carried along.
  assert.equal(normalizeProvider({ id: 'off', enabled: false }, 0), null)
  // A decision provider without a URL or model would silently abstain.
  assert.equal(normalizeProvider({ id: 'a', kind: 'decision', baseUrl: '', model: 'm' }, 0), null)
  assert.equal(normalizeProvider({ id: 'b', kind: 'decision', baseUrl: 'https://x', model: '' }, 0), null)
  assert.equal(normalizeProvider(null, 0), null)
  assert.equal(normalizeProvider('nope', 0), null)
})

test('normalizeProvider synthesizes a missing id and floors the timeout', () => {
  const provider = normalizeProvider({ kind: 'llm', timeoutMs: 12 }, 2)
  assert.equal(provider.id, 'llm-3')
  assert.equal(provider.timeoutMs, 500)
})

test('resolveConfig drops unusable entries but keeps a configured chain', () => {
  const policy = resolveConfig({
    providers: [
      { id: 'dead', kind: 'decision', baseUrl: '', model: '' },
      { id: 'live', kind: 'llm' },
    ],
  })
  assert.deepEqual(policy.providers.map(provider => provider.id), ['live'])
})

test('default providers put the decision model before the session LLM', () => {
  assert.equal(DEFAULT_PROVIDERS[0].kind, 'decision')
  assert.equal(DEFAULT_PROVIDERS[0].protocol, 'systemone')
  assert.equal(DEFAULT_PROVIDERS[0].apiKeyEnv, 'BAMBOONODE_API_KEY')
  assert.equal(DEFAULT_PROVIDERS[1].kind, 'llm')
  assert.equal(DEFAULT_PROVIDERS[1].llmProvider, '')
  assert.equal(DEFAULT_PROVIDERS[1].llmModel, '')
})

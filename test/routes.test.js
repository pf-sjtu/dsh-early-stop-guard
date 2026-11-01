// The HTTP surface the Settings page talks to.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'

/**
 * Minimal cordis context that resolves the Connection service.
 *
 * `inject` hands the callback a scoped context, mirroring how cordis forks the
 * fiber once every declared service is available.
 */
function createCtx() {
  const routes = []
  const scoped = {
    logger: { info() {}, warn() {}, debug() {} },
    on() {},
    effect(fn) {
      fn()
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return async () => {}
        },
      },
    },
  }
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    on() {},
    effect(fn) {
      fn()
    },
    inject(services, callback) {
      if (services.includes('connection')) callback(scoped)
    },
  }
  return { ctx, routes }
}

test('every route is an exact /api route with a declared body mode', () => {
  const { ctx, routes } = createCtx()
  apply(ctx, {})

  const byPath = new Map(routes.map(route => [route.path, route]))
  for (const [path, methods] of [
    ['/api/early-stop-guard/status', ['GET']],
    ['/api/early-stop-guard/logs', ['GET']],
    ['/api/early-stop-guard/logs/clear', ['POST']],
    ['/api/early-stop-guard/secret', ['POST']],
    ['/api/early-stop-guard/secret/clear', ['POST']],
    ['/api/early-stop-guard/test', ['POST']],
  ]) {
    const route = byPath.get(path)
    assert.ok(route, `route ${path} is registered`)
    assert.deepEqual(route.methods, methods)
    // Connection reads `requestBody` to pick the carrier; omitting it drops the
    // request into the shared RPC channel, which answers 400/404 instead.
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
  assert.equal(routes.length, byPath.size)
})

test('the status route reports the resolved chain without leaking keys', async () => {
  const { ctx, routes } = createCtx()
  apply(ctx, { providers: [{ id: 'p1', kind: 'llm' }] })

  const status = routes.find(route => route.path.endsWith('/status'))
  const payload = await (await status.fetch(new Request('http://x/api/early-stop-guard/status'))).json()

  assert.equal(payload.enabled, true)
  assert.equal(payload.mode, 'auto')
  assert.deepEqual(payload.providers.map(provider => provider.id), ['p1'])
  assert.equal(payload.providers[0].hasApiKey, null)
  assert.equal(JSON.stringify(payload).includes('apiKey"'), false)
})

test('a key posted to /secret is stored and never echoed back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'esg-routes-'))
  const previous = process.env.EARLY_STOP_GUARD_SECRETS_PATH
  process.env.EARLY_STOP_GUARD_SECRETS_PATH = join(dir, 'secrets.json')
  try {
    const { ctx, routes } = createCtx()
    apply(ctx, {
      providers: [{
        id: 'p1',
        kind: 'decision',
        baseUrl: 'https://example.invalid/v1',
        model: 'test-decision',
        apiKeyEnv: 'ESG_TEST_KEY',
      }],
    })
    const post = (path, body) =>
      routes
        .find(route => route.path === `/api/early-stop-guard/${path}`)
        .fetch(new Request(`http://x/api/early-stop-guard/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }))

    const saved = await (await post('secret', { id: 'p1', apiKey: 'sk-route-test' })).json()
    assert.deepEqual(saved, { ok: true, id: 'p1', hasApiKey: true })

    const status = routes.find(route => route.path.endsWith('/status'))
    const payload = await (await status.fetch(new Request('http://x/api/early-stop-guard/status'))).json()
    assert.equal(payload.providers[0].hasApiKey, true)
    assert.equal(payload.providers[0].apiKeySource, 'settings')
    assert.equal(JSON.stringify(payload).includes('sk-route-test'), false)

    const cleared = await (await post('secret/clear', { id: 'p1' })).json()
    assert.deepEqual(cleared, { ok: true, id: 'p1', hasApiKey: false })
  } finally {
    if (previous === undefined) delete process.env.EARLY_STOP_GUARD_SECRETS_PATH
    else process.env.EARLY_STOP_GUARD_SECRETS_PATH = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('the secret routes reject an empty or malformed body', async () => {
  const { ctx, routes } = createCtx()
  apply(ctx, {})
  const route = routes.find(entry => entry.path.endsWith('/secret'))
  const send = body =>
    route.fetch(new Request('http://x/api/early-stop-guard/secret', { method: 'POST', body }))

  assert.equal((await send('not json')).status, 400)
  assert.equal((await (await send('{}')).json()).error, 'id is required')
  assert.equal((await (await send('{"id":"p1"}')).json()).error, 'apiKey is required')
})

// The HTTP surface the Settings page talks to.
import assert from 'node:assert/strict'
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

  assert.equal(routes.length, 4)
  const byPath = new Map(routes.map(route => [route.path, route]))
  for (const [path, methods] of [
    ['/api/early-stop-guard/status', ['GET']],
    ['/api/early-stop-guard/logs', ['GET']],
    ['/api/early-stop-guard/logs/clear', ['POST']],
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

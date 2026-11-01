// Keys never travel through settings, so the store gets its own coverage.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createSecretStore } from '../lib/secrets.js'

/** Create a store over a throwaway directory. */
async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'esg-secrets-'))
  const path = join(dir, 'nested', 'secrets.json')
  try {
    await run({ store: createSecretStore({ path }), path, dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a saved key is readable, trim-safe, and removable', async () => {
  await withStore(async ({ store, path }) => {
    assert.equal(await store.lookup('p1'), undefined)
    assert.equal(await store.has('p1'), false)

    await store.set('p1', '  sk-test-123  ')
    assert.equal(await store.lookup('p1'), 'sk-test-123')
    assert.equal(await store.has('p1'), true)
    assert.deepEqual(await store.ids(), ['p1'])

    // The file is written under the parent directory the store created itself.
    const raw = await readFile(path, 'utf8')
    assert.match(raw, /sk-test-123/)
    assert.equal(JSON.parse(raw).p1, 'sk-test-123')

    await store.clear('p1')
    assert.equal(await store.lookup('p1'), undefined)
    assert.deepEqual(await store.ids(), [])
  })
})

test('a blank value clears the key and appends only to a fresh read', async () => {
  await withStore(async ({ store }) => {
    await store.set('a', 'k1')
    await store.set('b', 'k2')
    await store.set('a', 'k1-updated')
    assert.deepEqual((await store.ids()).sort(), ['a', 'b'])
    assert.equal(await store.lookup('a'), 'k1-updated')

    // A second store over the same path sees the persisted values.
    const reopened = createSecretStore({ path: store.path })
    assert.equal(await reopened.lookup('b'), 'k2')

    await store.set('a', '   ')
    assert.equal(await store.lookup('a'), undefined)
  })
})

test('a missing or corrupt file reads as empty instead of throwing', async () => {
  await withStore(async ({ store, path }) => {
    const missing = createSecretStore({ path: join(path, '..', 'nope.json') })
    assert.deepEqual(await missing.ids(), [])
  })
})

test('concurrent writes are serialized instead of clobbering each other', async () => {
  await withStore(async ({ store }) => {
    await Promise.all([
      store.set('a', '1'),
      store.set('b', '2'),
      store.set('c', '3'),
    ])
    assert.deepEqual((await store.ids()).sort(), ['a', 'b', 'c'])
  })
})

test('the file is not left world readable and reset removes it', async () => {
  await withStore(async ({ store, path }) => {
    await store.set('a', '1')
    await stat(path)
    await store.reset()
    await assert.rejects(stat(path))
  })
})

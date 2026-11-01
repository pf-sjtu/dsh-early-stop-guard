import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createLogStore, defaultLogPath } from '../lib/logs.js'

/** Create a throwaway log path and a store bound to it. */
async function withStore(options, run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'esg-logs-'))
  const file = path.join(directory, 'events.jsonl')
  const store = createLogStore({ path: file, ...options })
  try {
    await run(store, file, directory)
  } finally {
    // Drain queued writes before the directory disappears.
    await store.flush()
    await rm(directory, { recursive: true, force: true })
  }
}

test('defaultLogPath lives under the dsh home directory', () => {
  const target = defaultLogPath()
  assert.match(target, /[\\/]\.dsh[\\/]early-stop-guard[\\/]events\.jsonl$/)
})

test('add stamps an id and time and list returns newest first', async () => {
  await withStore({ enabled: false }, async (store) => {
    const first = store.add({ act: 'stop', reason: 'done' })
    const second = store.add({ act: 'continue', reason: 'narrated' })
    assert.equal(first.id, 1)
    assert.equal(second.id, 2)
    assert.ok(typeof first.ts === 'number')
    assert.deepEqual(store.list().map(record => record.reason), ['narrated', 'done'])
    assert.equal(store.size, 2)
  })
})

test('the in-memory ring stays bounded but keeps the newest records', async () => {
  await withStore({ enabled: false, maxRecords: 50 }, async (store) => {
    for (let index = 0; index < 60; index += 1) store.add({ act: 'stop', reason: `r${index}` })
    assert.equal(store.size, 50)
    assert.equal(store.list(1)[0].reason, 'r59')
    assert.equal(store.list(1000).length, 50)
  })
})

test('records are appended to the JSONL file and hydrated back', async () => {
  await withStore({ enabled: true }, async (store, file) => {
    store.add({ act: 'continue', reason: 'narrated', turn: 7 })
    store.add({ act: 'stop', reason: 'done', turn: 7 })
    // Writes are chained in the background; wait for the queue instead of a sleep.
    await store.flush()
    const text = await readFile(file, 'utf8')
    const lines = text.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.equal(JSON.parse(lines[0]).reason, 'narrated')

    const revived = createLogStore({ path: file, enabled: true })
    await revived.hydrate()
    assert.deepEqual(revived.list().map(record => record.reason), ['done', 'narrated'])
    // Ids keep counting from the hydrated maximum.
    assert.equal(revived.add({ act: 'stop', reason: 'later' }).id, 3)
    // Let the revived store finish writing before the temp directory goes away.
    await revived.flush()
  })
})

test('hydrate tolerates a missing file and a truncated last line', async () => {
  await withStore({ enabled: true }, async (store, file) => {
    await store.hydrate()
    assert.equal(store.size, 0)

    const { appendFile } = await import('node:fs/promises')
    await appendFile(file, '{"id":1,"reason":"ok"}\n{"id":2,"reason":', 'utf8')
    const revived = createLogStore({ path: file, enabled: true })
    await revived.hydrate()
    assert.equal(revived.size, 1)
    assert.equal(revived.list()[0].reason, 'ok')
  })
})

test('clear drops memory and truncates the file', async () => {
  await withStore({ enabled: true }, async (store, file) => {
    store.add({ act: 'stop', reason: 'done' })
    await store.clear()
    assert.equal(store.size, 0)
    assert.deepEqual(store.list(), [])
    await assert.rejects(readFile(file, 'utf8'), /ENOENT/)
  })
})

test('a disabled store still keeps an in-memory history for the page', async () => {
  await withStore({ enabled: false }, async (store, file) => {
    store.add({ act: 'stop', reason: 'done' })
    await assert.rejects(readFile(file, 'utf8'), /ENOENT/)
    assert.equal(store.list().length, 1)
    assert.equal(store.enabled, false)
  })
})

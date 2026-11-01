/**
 * Decision history: a bounded in-memory ring for the Settings page plus an
 * append-only JSONL file that survives a restart.
 *
 * The guard's whole claim is "it decided this, for this reason". A log that is
 * only a console line cannot back that claim up, so every evaluation — including
 * the ones that ended the turn — is recorded.
 *
 * @module dsh-early-stop-guard/logs
 */

import { appendFile, mkdir, rm, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default JSONL location when the config names none. */
export function defaultLogPath() {
  return path.join(homedir(), '.dsh', 'early-stop-guard', 'events.jsonl')
}

/**
 * Create the decision log.
 *
 * @param options - `{ path, maxRecords, enabled, logger }`.
 * @returns store with `add`, `list`, `clear`, `path`.
 */
export function createLogStore(options) {
  const enabled = options?.enabled !== false
  const maxRecords = Math.max(50, Number(options?.maxRecords) || 300)
  const filePath = options?.path?.trim() || defaultLogPath()
  const logger = options?.logger
  const records = []
  let sequence = 0
  let pending = Promise.resolve()
  let directoryReady = false

  /** Append one line without letting file I/O reject an unhandled promise. */
  function append(record) {
    pending = pending
      .then(async () => {
        if (!directoryReady) {
          await mkdir(path.dirname(filePath), { recursive: true })
          directoryReady = true
        }
        await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
      })
      .catch((error) => {
        logger?.warn?.(`[early-stop-guard] log write failed: ${error instanceof Error ? error.message : error}`)
      })
    return pending
  }

  return {
    /** JSONL path in use. */
    path: filePath,
    /** Whether persistence is on. */
    get enabled() {
      return enabled
    },
    /**
     * Record one evaluation.
     * @param entry - decision facts; `id` and `ts` are added here.
     * @returns the stored record.
     */
    add(entry) {
      const record = { id: ++sequence, ts: Date.now(), ...entry }
      records.push(record)
      while (records.length > maxRecords) records.shift()
      if (enabled) append(record)
      return record
    },
    /**
     * Read the newest records first.
     * @param limit - maximum rows to return.
     * @returns records, newest first.
     */
    list(limit = 100) {
      const size = Math.max(1, Math.min(Number(limit) || 100, maxRecords))
      return records.slice(-size).reverse()
    },
    /** Number of records currently held in memory. */
    get size() {
      return records.length
    },
    /**
     * Resolve once every queued write has landed on disk.
     *
     * `add` is fire-and-forget on purpose, so anything that needs the file to be
     * complete — tests, a shutdown path — waits here instead of sleeping.
     */
    flush() {
      return pending
    },
    /** Drop in-memory records and truncate the JSONL file. */
    async clear() {
      records.length = 0
      if (!enabled) return
      pending = pending
        .then(() => rm(filePath, { force: true }))
        .catch((error) => {
          logger?.warn?.(`[early-stop-guard] log clear failed: ${error instanceof Error ? error.message : error}`)
        })
      await pending
    },
    /**
     * Load the tail of the JSONL file into memory so a restart keeps history.
     * @param limit - maximum rows to load.
     */
    async hydrate(limit = maxRecords) {
      if (!enabled) return
      try {
        const text = await readFile(filePath, 'utf8')
        const lines = text.split('\n').filter(line => line.trim().length > 0)
        for (const line of lines.slice(-Math.max(1, limit))) {
          try {
            records.push(JSON.parse(line))
          } catch {
            // A truncated final line from an interrupted write is not worth
            // dropping the whole history over.
          }
        }
        sequence = records.reduce((max, record) => Math.max(max, Number(record?.id) || 0), 0)
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger?.warn?.(`[early-stop-guard] log read failed: ${error instanceof Error ? error.message : error}`)
        }
      }
    },
  }
}

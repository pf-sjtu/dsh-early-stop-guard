/**
 * Provider API keys kept outside the Settings wire.
 *
 * DSH redacts `role: secret` fields from every settings payload, and replacing a
 * whole array drops them, so a key stored in the plugin config cannot survive an
 * edit. Keys therefore live in a separate JSON file that only this module and the
 * provider chain read; nothing ever echoes a key back to the browser.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Where keys are stored when the caller does not name a path. */
export function defaultSecretPath() {
  // An env override keeps tests and portable installs off the real home directory.
  const override = process.env.EARLY_STOP_GUARD_SECRETS_PATH?.trim()
  return override || join(homedir(), '.dsh', 'early-stop-guard', 'secrets.json')
}

/**
 * Build the key store.
 *
 * Reads are lazy and cached. Writes are serialized through one promise chain and
 * land with a rename so a crash cannot leave a half-written file; failures only
 * warn, because a missing key degrades to the next provider in the chain.
 *
 * @param options - `{ path, logger }`.
 * @returns `{ path, lookup, has, set, clear, ids }`, every method async.
 */
export function createSecretStore({ path = defaultSecretPath(), logger } = {}) {
  let cache = null
  let pending = Promise.resolve()

  const load = async () => {
    if (cache) return cache
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      cache = {}
    }
    return cache
  }

  const persist = async (next) => {
    cache = next
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
    // Best effort: Windows and some filesystems ignore the mode.
    await chmod(path, 0o600).catch(() => {})
  }

  const mutate = (change) => {
    const run = pending.then(async () => {
      const current = await load()
      const next = change({ ...current })
      await persist(next)
      return next
    })
    // Keep the chain alive after a failed write.
    pending = run.then(() => {}, () => {})
    return run
  }

  const lookup = async (id) => {
    const key = (await load())[id]
    return typeof key === 'string' ? key : undefined
  }

  const clear = (id) =>
    mutate(current => {
      const next = { ...current }
      delete next[id]
      return next
    })

  return {
    path,
    lookup,
    has: async id => (await lookup(id)) !== undefined,
    set(id, apiKey) {
      const value = String(apiKey ?? '').trim()
      return value ? mutate(current => ({ ...current, [id]: value })) : clear(id)
    },
    clear,
    ids: async () => Object.keys(await load()),
    /** Remove the file entirely; used by tests and by a full reset. */
    async reset() {
      cache = {}
      await rm(path, { force: true }).catch(error => logger?.warn?.(`[early-stop-guard] could not remove ${path}: ${error?.message}`))
    },
  }
}

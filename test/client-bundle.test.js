// Smoke test for the browser half: it must register the Settings tab and expose
// the config form to it, without needing a real DOM renderer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Minimal React stand-in: enough for module scope, no rendering. */
function createReactStub() {
  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children })
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    Fragment: 'Fragment',
  }
}

/** Load the bundle the way the web shell does and return its exported module. */
function loadClientModule() {
  let loaded = null
  const styleElements = []
  const context = {
    window: {
      __ModuleLoader__: {
        load: (entry) => {
          loaded = entry
        },
      },
    },
    document: {
      head: { appendChild: () => {} },
      querySelector: () => null,
      createElement: () => ({ setAttribute() {}, appendChild() {}, textContent: '', dataset: {}, remove() {} }),
      createTextNode: (text) => ({ text }),
    },
    console,
    fetch: async () => {
      throw new Error('fetch stub: no network in this test')
    },
  }
  context.window.document = context.document
  context.window.console = console
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  assert.ok(loaded, 'the bundle must call window.__ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-early-stop-guard')

  const react = createReactStub()
  const module = loaded.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
  void styleElements
  return module
}

/** Cordis-like context for the browser half. */
function createCtx() {
  const registered = []
  const injections = []
  const dictionaries = []
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register(namespace, dict) {
        dictionaries.push({ namespace, dict })
        return () => {}
      },
      bind: () => (key) => key,
    },
    configForms: {
      get: (id) => ({ id, getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set() {} }),
    },
    slots: {
      inject(slot, cb) {
        injections.push({ slot, cb })
        cb()
      },
      register(options, component) {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, registered, injections, dictionaries }
}

test('the client bundle loads and registers a Settings tab', () => {
  const module = loadClientModule()
  // The bundle is evaluated in another realm, so compare a local copy.
  assert.deepEqual([...module.inject], ['slots', 'locale', 'configForms'])
  assert.equal(typeof module.apply, 'function')

  const { ctx, registered, injections, dictionaries } = createCtx()
  module.apply(ctx)

  assert.deepEqual(injections.map(entry => entry.slot), ['settings.plugins.tab'])
  assert.equal(registered.length, 1)
  const { options, component } = registered[0]
  assert.equal(options.name, 'settings.plugins.tab')
  assert.equal(options.id, 'early-stop-guard')
  assert.equal(options.locale, 'earlyStopGuard')
  assert.equal(typeof component, 'function')
  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, 'earlyStopGuard')
  assert.ok(dictionaries[0].dict.zh.tab, 'zh dictionary has the tab label')
  assert.ok(dictionaries[0].dict.en.tab, 'en dictionary has the tab label')
})

test('the tab receives the config form and a translator', () => {
  const module = loadClientModule()
  const { ctx, registered } = createCtx()
  module.apply(ctx)
  const face = registered[0].options.inject()
  assert.ok(face.form, 'the tab is handed the config form')
  assert.equal(typeof face.t, 'function')
})

test('a missing config form does not break the tab', () => {
  const module = loadClientModule()
  const { ctx, registered } = createCtx()
  ctx.configForms.get = () => {
    throw new Error('form unavailable')
  }
  assert.doesNotThrow(() => module.apply(ctx))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.inject().form, undefined)
})

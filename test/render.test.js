// Render smoke test for the Settings tab: the tab must survive a real React
// render (hooks, undefined config values, missing form) and show its sections.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require_ = createRequire(import.meta.url)
const React = require_('react')
const { renderToStaticMarkup } = require_('react-dom/server')
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Load the browser half and hand it the real React. */
function loadModule() {
  let loaded = null
  const context = {
    window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
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
  assert.ok(loaded, 'the bundle must register itself with the module loader')
  return loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
}

/** Fake ConfigForm carrying whatever value the case needs. */
function fakeForm(value, options = {}) {
  const listeners = new Set()
  return {
    getSnapshot: () => ({
      status: options.status ?? 'ready',
      value,
      writable: options.writable ?? true,
    }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (field, next) => {
      if (options.onSet) options.onSet(field, next)
    },
    unset: () => {},
    mutate: () => {},
  }
}

/** Pull the registered tab component out of the module. */
function tabComponent(module, form) {
  const registered = []
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(fn) {
      fn()
      return () => {}
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    configForms: { get: () => form },
    slots: {
      inject: (slot, cb) => cb(),
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)
  assert.equal(registered.length, 1)
  return registered[0].component
}

const t = (key) => key

test('the tab renders with a full config value', () => {
  const module = loadModule()
  const form = fakeForm({
    enabled: true,
    maxContinuations: 3,
    steerText: '继续：你还没做完。',
    dm: { mode: 'auto', threshold: 0.5, askThreshold: 0.4, waitThreshold: 0.5 },
    providers: [
      { id: 'bamboonode', label: 'Bamboonode', kind: 'decision', protocol: 'systemone', baseUrl: 'https://example.test/v1', model: 'm', enabled: true, timeoutMs: 20000 },
      { id: 'session-llm', label: 'Session model', kind: 'llm', enabled: true, timeoutMs: 20000 },
    ],
  })
  const Tab = tabComponent(module, form)
  const html = renderToStaticMarkup(React.createElement(Tab, { form, t }))
  assert.match(html, /esg-root/)
  assert.match(html, /title/)
  assert.match(html, /继续：你还没做完。/, 'the steer text is shown for editing')
  assert.match(html, /bamboonode/, 'the provider chain lists its first row')
  assert.match(html, /session-llm/, 'the provider chain lists the fallback row')
  // Only a decision provider needs a key, and it is entered as a password field
  // that posts straight to the host instead of going through the settings form.
  assert.equal(html.match(/type="password"/g)?.length, 1)
  assert.match(html, /saveKey/)
  assert.match(html, /clearKey/)
  assert.match(html, /keyHint/)
})

test('the tab survives an empty value without throwing', () => {
  const module = loadModule()
  const Tab = tabComponent(module, fakeForm(undefined))
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(Tab, { form: fakeForm({}), t })))
})

test('the tab explains itself when the config form is unavailable', () => {
  const module = loadModule()
  const Tab = tabComponent(module, null)
  const html = renderToStaticMarkup(React.createElement(Tab, { form: null, t }))
  assert.match(html, /noForm/)
})

test('a read-only form is reported instead of silently ignoring edits', () => {
  const module = loadModule()
  const Tab = tabComponent(module, fakeForm({}, { writable: false }))
  const html = renderToStaticMarkup(React.createElement(Tab, { form: fakeForm({}, { writable: false }), t }))
  assert.match(html, /readOnly/)
})

// Style invariants for the Settings tab.
//
// The page is styled by one injected stylesheet, so a class name that the JSX
// uses but the CSS never defines fails silently: that is exactly how the first
// decision list ended up letting a long trailing text size its own row. These
// tests keep every class defined and the one-line truncation in place.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require_ = createRequire(import.meta.url)
const React = require_('react')
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Run the browser half with a stub document and hand back the injected CSS. */
function collectStyles() {
  let loaded = null
  let css = ''
  const style = { dataset: {}, textContent: '', remove() {} }
  const context = {
    window: { __ModuleLoader__: { load: (entry) => { loaded = entry } } },
    document: {
      head: {
        appendChild: (node) => {
          css = node.textContent
        },
      },
      querySelector: () => null,
      createElement: () => style,
    },
    console,
    fetch: async () => {
      throw new Error('fetch stub: no network in this test')
    },
  }
  context.window.document = context.document
  vm.runInNewContext(source, context, { filename: 'lib/client.js' })
  assert.ok(loaded, 'the bundle must register itself with the module loader')
  const module = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  const ctx = {
    logger: { warn() {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    configForms: { get: () => null },
    slots: { inject: () => {}, register: () => () => {} },
  }
  module.apply(ctx)
  assert.ok(css.includes('.esg-root'), 'apply must inject the stylesheet')
  return css
}

/** Every class name the JSX can put on an element. */
function usedClasses() {
  const found = new Set()
  for (const match of source.matchAll(/className:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    const literal = match[1].slice(1, -1).replace(/\$\{[^}]*\}/g, ' ')
    for (const token of literal.split(/\s+/)) {
      if (token) found.add(token)
    }
  }
  return found
}

/** Every class name the stylesheet defines. */
function definedClasses(css) {
  return new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((match) => match[1]))
}

test('every class the tab renders is defined in the injected stylesheet', () => {
  const css = collectStyles()
  const defined = definedClasses(css)
  // `is-off` is applied from a ternary inside a template literal, so the scan
  // above cannot see it; it still has to exist in the sheet.
  const allowed = new Set(['is-off'])
  const missing = [...usedClasses()].filter((name) => !defined.has(name) && !allowed.has(name))
  assert.deepEqual(missing, [], `classes used by the JSX but never defined: ${missing.join(', ')}`)
  for (const name of allowed) {
    assert.ok(defined.has(name), `expected a definition for .${name}`)
  }
})

test('class names are only built from defined pieces', () => {
  const css = collectStyles()
  const defined = definedClasses(css)
  // Template literals concatenate a base class with modifiers; each base class
  // must exist, which is what catches a renamed element.
  const bases = [...source.matchAll(/`(esg-[a-z-]+)\$\{/g)].map((match) => match[1])
  assert.ok(bases.length >= 2, 'the tab is expected to compose dynamic class names')
  for (const base of bases) {
    assert.ok(defined.has(base), `dynamic class base .${base} is not defined`)
  }
})

test('the decision list truncates its trailing text instead of growing', () => {
  const css = collectStyles()
  const rule = css.match(/\.esg-log-text\s*\{([^}]*)\}/)
  assert.ok(rule, '.esg-log-text must be styled')
  assert.match(rule[1], /white-space:\s*nowrap/, 'the preview must stay on one line')
  assert.match(rule[1], /text-overflow:\s*ellipsis/, 'an over-long preview must be elided')
  assert.match(rule[1], /overflow:\s*hidden/, 'the preview must clip instead of expanding its row')
  // The full text belongs to the expandable detail, which scrolls on its own.
  const detail = css.match(/\.esg-log-detail pre\s*\{([^}]*)\}/)
  assert.ok(detail, 'the expanded detail must style its <pre>')
  assert.match(detail[1], /max-height:/, 'the expanded text must not push the page open')
})

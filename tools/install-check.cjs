const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(file, mocks = {}) {
  const source = readFileSync(resolve(__dirname, '../src/renderer/src', file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  })
  const exports = {}
  new Function('require', 'exports', 'localStorage', 'window', 'setTimeout', outputText)(
    (id) => mocks[id] ?? require(id), exports,
    { getItem: () => null }, { api }, () => {}
  )
  return exports
}

let calls = []
let outcome = async (ids) => ({ changed: ids, failed: [] })
const api = { activate: async (ids) => { calls.push(ids); return outcome(ids) } }
const filter = load('lib/filter.ts')
const { useApp } = load('store.ts', {
  './lib/filter': filter,
  './lib/fontface': { defaultAxisValues: () => ({}) }
})
const face = (id, familyId, weight = 400, active = false) => ({
  id, familyId, provider: familyId.split(':')[0], family: 'Inter',
  subfamily: weight === 400 ? 'Regular' : 'Bold', fullName: `Inter ${weight}`,
  postScriptName: `Inter-${weight}`, weight, style: 'normal', category: 'sans-serif',
  axes: [], tags: [], collections: [], active
})
const fonts = [
  face('regular', 'google:inter'), face('bold', 'google:inter', 700),
  face('installed', 'google:inter', 900, true), face('other-source', 'bunny:inter')
]
useApp.setState({ fonts, filters: { ...filter.emptyFilters, query: 'Regular' } })
const state = () => useApp.getState()

async function check() {
  state().toggleSelect('regular', true)
  state().toggleSelect('bold', true)
  assert.deepEqual(state().selection, ['regular', 'bold'])
  state().toggleSelect('regular', true)
  assert.deepEqual(state().selection, ['bold'])
  state().clearSelection()
  assert.deepEqual(state().selection, [])

  state().selectAll()
  assert.deepEqual(state().selection, ['regular'], 'Select all respects search and grouped sources')
  state().setFilters({ query: 'missing', providers: ['google'] })
  state().selectAll()
  assert.deepEqual(state().selection, [], 'Empty results clear selection')
  state().setFilters({ query: '', providers: ['bunny'] })
  state().selectAll()
  assert.deepEqual(state().selection, ['other-source'], 'Select all respects the provider filter')

  await state().installFamily('google:inter')
  assert.deepEqual(calls.pop(), ['regular', 'bold'], 'Family install ignores filters, skips installed and other sources')
  await state().activate(['bold', 'regular', 'regular', 'installed', 'stale'])
  assert.deepEqual(calls.pop(), ['regular', 'bold'], 'Batch install only sends unique existing uninstalled IDs')
  await state().activate(['installed'])
  assert.equal(calls.length, 0, 'An installed selection is a no-op')

  let finish
  outcome = () => new Promise((resolve) => { finish = resolve })
  const pending = state().activate(['regular'])
  await state().activate(['bold'])
  assert.equal(calls.length, 1, 'A second install cannot overlap the first')
  finish({ changed: ['regular'], failed: [] })
  await pending
  assert.equal(state().busy, null)

  outcome = async () => ({ changed: ['regular'], failed: [{ id: 'bold', error: 'Offline' }] })
  await state().activate(['regular', 'bold'])
  assert.match(state().toasts.at(-1).text, /1 installed, 1 failed: Offline/)
  outcome = async () => { throw new Error('Connection lost') }
  await state().activate(['regular'])
  assert.equal(state().toasts.at(-1).text, 'Connection lost')
  assert.equal(state().busy, null, 'Failures release the busy state for retry')

  // Render the card with real JSX to check checkbox semantics and event isolation.
  const { FontCard } = load('components/FontCard.tsx', {
    react: { memo: (fn) => fn, useEffect: () => {}, useState: () => [undefined, () => {}] },
    '../store': { useApp: (select) => select(state()) },
    '../lib/fontface': { variationSettings: () => undefined },
    './Icon': { default: () => null }
  })
  const card = FontCard({ font: fonts[0], inSelection: true })
  const checkbox = card.props.children[0].props.children[0]
  assert.equal(checkbox.type, 'input')
  assert.equal(checkbox.props.type, 'checkbox')
  assert.equal(checkbox.props.checked, true)
  assert.match(checkbox.props['aria-label'], /Inter 400/)
  let stopped = false
  checkbox.props.onClick({ stopPropagation: () => { stopped = true } })
  assert.equal(stopped, true, 'Checkbox clicks do not also select the card')
  state().clearSelection()
  checkbox.props.onChange()
  assert.deepEqual(state().selection, ['bold', 'regular'], 'Checkbox extends the currently focused face into a selection')

  const external = { ...face('external', 'local:inter', 400, true), managedInstall: false, installationKey: 'same-binary' }
  const alias = { ...face('alias', 'google:inter', 400, true), managedInstall: false, installationKey: 'same-binary' }
  const managed = { ...face('managed', 'local:other', 700, true), managedInstall: true, installationKey: 'other-binary' }
  useApp.setState({ fonts: [external, alias, managed], busy: null })
  calls = []
  api.deactivate = async (ids) => { calls.push(ids); return { changed: ids, skipped: [], failed: [] } }
  await state().toggleActive(external)
  assert.equal(calls.length, 0, 'An external installation cannot be toggled off')
  await state().deactivate(['external', 'alias', 'managed'])
  assert.deepEqual(calls.pop(), ['managed'], 'Batch removal only sends managed owner records')
  assert.equal(filter.countInstalled([external, alias, managed]), 2, 'Installed totals count aliases once')
  const staticFace = face('static', 'google:inter')
  const variableFace = { ...staticFace, id: 'variable', axes: [{ tag: 'wght', min: 100, max: 900 }] }
  assert.equal(filter.dedupeFaces([staticFace, variableFace]).length, 2, 'Static and variable forms remain distinct')
  assert.equal(filter.dedupeFaces([{ ...staticFace, packageOnly: true }, { ...staticFace, id: 'other-package', packageOnly: true }]).length, 2, 'Unverified packages are never deduplicated by guessed face metadata')
  useApp.setState({ fonts: [staticFace], busy: null })
  outcome = async () => ({ changed: [], skipped: ['static'], failed: [] })
  await state().activate(['static'])
  assert.match(state().toasts.at(-1).text, /0 fonts, 1 already installed/, 'Skipped duplicates are not reported as new installations')
  calls = []
  api.refreshProvider = async (id, options) => { calls.push({ id, options }); return [] }
  await state().refreshProvider('dafont', { query: 'script', page: 2 })
  assert.deepEqual(calls.pop(), { id: 'dafont', options: { query: 'script', page: 2 } }, 'Native source search forwards query and pagination')
  const remoteMatch = { ...staticFace, family: 'Sand', fullName: 'Sand', postScriptName: 'Sand', sourceQuery: 'sans' }
  assert.equal(filter.applyFilters([remoteMatch], { ...filter.emptyFilters, query: 'sans' }, []).fonts.length, 1, 'Source search results survive local filtering even when the site expands a query')
  console.log('Family install and multi-select checks passed')
}
check().catch((error) => { console.error(error); process.exitCode = 1 })

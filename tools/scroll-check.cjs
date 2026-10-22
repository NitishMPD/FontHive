const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

// Exercise the card's render/effect boundary without launching Electron.
let family
let effects = []
let loads = 0
const state = { settings: { previewSize: 32, previewText: 'Sample' }, axisValues: {}, selection: [] }
const mocks = {
  react: {
    memo: (component) => component,
    useState: () => [family, (value) => { family = value }],
    useEffect: (effect) => { effects.push(effect) }
  },
  '../store': { useApp: (select) => select(state) },
  '../lib/fontface': {
    ensureFontLoaded: () => { loads++; return 'hive-test' },
    variationSettings: () => undefined
  },
  './Icon': { default: () => null }
}
const source = readFileSync(resolve(__dirname, '../src/renderer/src/components/FontCard.tsx'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
})
const moduleExports = {}
new Function('require', 'exports', outputText)(
  (id) => mocks[id] ?? require(id), moduleExports
)
const props = {
  font: { id: 'test', family: 'Test', weight: 400, style: 'normal', category: 'serif', axes: [], tags: [] },
  width: 300, height: 232, x: 16, y: 16,
  selected: false, inSelection: false, loadPreview: false
}
function render(loadPreview) {
  effects = []
  return moduleExports.FontCard({ ...props, loadPreview })
}
function previewFamily(card) {
  return card.props.children[1].props.style.fontFamily
}

const scrollingCard = render(false)
assert.equal(loads, 0, 'Rendering must not load fonts')
effects.forEach((effect) => effect())
assert.equal(loads, 0, 'New previews must wait while scrolling')
assert.equal(previewFamily(scrollingCard), undefined, 'New cards inherit the UI font')

render(true)
assert.equal(loads, 0, 'Loading belongs after render')
effects.forEach((effect) => effect())
assert.equal(loads, 1, 'Settled cards load their preview')
assert.equal(previewFamily(render(false)), 'hive-test', 'Scrolling retains loaded previews')
effects.forEach((effect) => effect())
assert.equal(loads, 1, 'Scrolling does not restart loading')
console.log('Font scroll checks passed')

// Exercise paged catalogue scrolling without starting the application.
const listeners = new Map()
const scrollElement = {
  scrollHeight: 3000, scrollTop: 0, clientHeight: 800,
  addEventListener: (name, fn) => listeners.set(name, fn),
  removeEventListener: (name) => listeners.delete(name)
}
const requestedPage = { current: '' }
let refIndex = 0
const pageRequests = []
const gridState = {
  fonts: [{}], collections: [], filters: { providers: ['1001fonts'], query: '' },
  settings: { gridColumns: 2, previewSize: 32 }, selection: [], view: { kind: 'library' },
  providers: [{ id: '1001fonts', paged: true, hasMore: true, page: 1 }],
  refreshProvider: (...args) => pageRequests.push(args)
}
const gridMocks = {
  react: {
    useEffect: (fn) => effects.push(fn), useMemo: (fn) => fn(),
    useRef: () => refIndex++ === 0 ? { current: scrollElement } : requestedPage,
    useState: () => [1000, () => {}]
  },
  '@tanstack/react-virtual': { useVirtualizer: () => ({ measure() {}, getTotalSize: () => 3000, getVirtualItems: () => [] }) },
  '../store': { useApp: (select) => select(gridState) },
  '../lib/filter': { applyFilters: () => ({ fonts: gridState.fonts }) },
  './FontCard': {}, './Icon': { default: () => null }
}
const gridExports = {}
new Function('require', 'exports', ts.transpileModule(
  readFileSync(resolve(__dirname, '../src/renderer/src/components/FontGrid.tsx'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
).outputText)((id) => gridMocks[id] ?? require(id), gridExports)
function paginationEffect() {
  effects = []; refIndex = 0
  gridExports.default()
  return effects.at(-1)()
}
let cleanup = paginationEffect()
assert.equal(pageRequests.length, 0, 'Do not fetch pages far from the grid end')
scrollElement.scrollTop = 2000
listeners.get('scroll')()
listeners.get('scroll')()
assert.deepEqual(pageRequests, [['1001fonts', { query: '', page: 2 }]], 'Fetch next page once near the end')
cleanup()
gridState.providers[0].page = 2
cleanup = paginationEffect()
assert.equal(pageRequests[1][1].page, 3, 'Continue from the latest loaded page')
cleanup()
gridState.filters.query = 'new search'
assert.equal(paginationEffect(), undefined, 'Do not append pages for a stale source query')
gridState.filters.query = ''
gridState.providers[0].hasMore = false
assert.equal(paginationEffect(), undefined, 'Stop at the last page')
gridState.providers[0].hasMore = true
gridState.providers[0].error = 'Network unavailable'
assert.equal(paginationEffect(), undefined, 'Do not loop on a failed source')
console.log('Source pagination checks passed')

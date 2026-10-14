const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

// Exercise the card's render/effect boundary without launching Electron.
let family
let effects = []
let loads = 0
const state = { settings: { previewSize: 32, previewText: 'Sample' }, axisValues: {} }
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

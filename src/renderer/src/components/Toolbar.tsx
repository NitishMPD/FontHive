import { useApp } from '../store'
import { CATEGORIES } from '../lib/filter'
import Icon from './Icon'

const CATEGORY_LABEL: Record<string, string> = {
  'sans-serif': 'Sans',
  serif: 'Serif',
  display: 'Display',
  monospace: 'Mono',
  handwriting: 'Script',
  other: 'Other'
}

export default function Toolbar(): React.JSX.Element {
  const filters = useApp((s) => s.filters)
  const setFilters = useApp((s) => s.setFilters)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const selection = useApp((s) => s.selection)
  const clearSelection = useApp((s) => s.clearSelection)
  const activate = useApp((s) => s.activate)
  const deactivate = useApp((s) => s.deactivate)
  const download = useApp((s) => s.download)
  const busy = useApp((s) => s.busy)

  const toggleCategory = (category: string): void => {
    const next = filters.categories.includes(category)
      ? filters.categories.filter((c) => c !== category)
      : [...filters.categories, category]
    setFilters({ categories: next })
  }

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <div className="search">
          <input
            value={filters.query}
            placeholder="Search families, styles and tags…"
            onChange={(event) => setFilters({ query: event.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="preview-size">Size</label>
          <input
            id="preview-size"
            type="range"
            min={12}
            max={76}
            value={settings.previewSize}
            onChange={(event) => void saveSettings({ previewSize: Number(event.target.value) })}
          />
          <span className="mono" style={{ width: 26, textAlign: 'right' }}>
            {settings.previewSize}
          </span>
        </div>

        <div className="field">
          <label htmlFor="cols">Cols</label>
          <select
            id="cols"
            value={settings.gridColumns}
            onChange={(event) => void saveSettings({ gridColumns: Number(event.target.value) })}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="chip-row">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              className={`chip ${filters.categories.includes(category) ? 'on' : ''}`}
              onClick={() => toggleCategory(category)}
            >
              {CATEGORY_LABEL[category]}
            </button>
          ))}

          <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} />

          <button
            className={`chip toggle-active ${filters.onlyActive ? 'on' : ''}`}
            onClick={() => setFilters({ onlyActive: !filters.onlyActive })}
          >
            Active only
          </button>
          <button
            className={`chip ${filters.onlyInstalled ? 'on' : ''}`}
            onClick={() => setFilters({ onlyInstalled: !filters.onlyInstalled })}
          >
            Downloaded
          </button>
          <button
            className={`chip ${filters.variableOnly ? 'on' : ''}`}
            onClick={() => setFilters({ variableOnly: !filters.variableOnly })}
          >
            Variable
          </button>

          {(filters.categories.length ||
            filters.providers.length ||
            filters.onlyActive ||
            filters.onlyInstalled ||
            filters.variableOnly ||
            filters.query ||
            filters.collectionId) && (
            <button
              className="chip"
              onClick={() =>
                setFilters({
                  categories: [],
                  providers: [],
                  onlyActive: false,
                  onlyInstalled: false,
                  variableOnly: false,
                  query: '',
                  collectionId: null
                })
              }
            >
              Clear
            </button>
          )}
        </div>

        <div className="toolbar-spacer" />

        <div className="field" style={{ minWidth: 220 }}>
          <input
            className="text-input"
            value={settings.previewText}
            placeholder="Preview text"
            onChange={(event) => void saveSettings({ previewText: event.target.value })}
          />
        </div>
      </div>

      {selection.length > 0 && (
        <div className="toolbar-row">
          <strong style={{ fontSize: 12.5 }}>{selection.length} selected</strong>
          <div className="toolbar-spacer" />
          <button className="btn sm" disabled={Boolean(busy)} onClick={() => void activate(selection)}>
            <Icon name="check" size={13} /> Activate
          </button>
          <button className="btn sm" disabled={Boolean(busy)} onClick={() => void deactivate(selection)}>
            Deactivate
          </button>
          <button className="btn sm" disabled={Boolean(busy)} onClick={() => void download(selection)}>
            <Icon name="download" size={13} /> Download
          </button>
          <button className="btn sm ghost" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}
    </header>
  )
}

import { useApp } from '../store'
import { CATEGORIES, emptyFilters, type SortKey } from '../lib/filter'
import Dropdown from './Dropdown'
import Icon from './Icon'

const CATEGORY_LABEL: Record<string, string> = {
  'sans-serif': 'Sans Serif',
  serif: 'Serif',
  display: 'Display',
  monospace: 'Monospace',
  handwriting: 'Script',
  other: 'Other'
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'newest', label: 'Newest' },
  { key: 'weight', label: 'Weight' }
]

const PROPERTIES = [
  { key: 'onlyActive', label: 'Active' },
  { key: 'onlyInstalled', label: 'Downloaded' },
  { key: 'variableOnly', label: 'Variable' }
] as const

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

  const propertyCount = PROPERTIES.filter((p) => filters[p.key]).length
  const listView = settings.gridColumns === 1
  const dirty =
    filters.query ||
    filters.categories.length ||
    filters.providers.length ||
    filters.collectionId ||
    filters.onlyFavorites ||
    propertyCount

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <div className="search">
          <Icon name="search" size={15} className="search-icon" />
          <input
            value={filters.query}
            placeholder="Search fonts, designers, or styles…"
            onChange={(event) => setFilters({ query: event.target.value })}
            spellCheck={false}
          />
        </div>

        <Dropdown icon="layers" label="Categories" count={filters.categories.length}>
          {CATEGORIES.map((category) => (
            <label className="dd-item" key={category}>
              <input
                type="checkbox"
                checked={filters.categories.includes(category)}
                onChange={() => toggleCategory(category)}
              />
              {CATEGORY_LABEL[category]}
            </label>
          ))}
        </Dropdown>

        <Dropdown icon="filter" label="Properties" count={propertyCount}>
          {PROPERTIES.map((p) => (
            <label className="dd-item" key={p.key}>
              <input
                type="checkbox"
                checked={filters[p.key]}
                onChange={() => setFilters({ [p.key]: !filters[p.key] })}
              />
              {p.label}
            </label>
          ))}

          <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />

          {/* Kept out of PROPERTIES so it does not inflate the count badge: it is
              a view preference that defaults to on, not a narrowing filter. */}
          <label className="dd-item" title="Collapse the same font offered by several sources">
            <input
              type="checkbox"
              checked={filters.groupDuplicates}
              onChange={() => setFilters({ groupDuplicates: !filters.groupDuplicates })}
            />
            Group duplicate sources
          </label>
        </Dropdown>

        <input
          className="preview-input"
          value={settings.previewText}
          placeholder="Your text here"
          onChange={(event) => void saveSettings({ previewText: event.target.value })}
        />

        <div className="size-field">
          <span className="mono">{settings.previewSize}px</span>
          <input
            type="range"
            min={12}
            max={120}
            value={settings.previewSize}
            aria-label="Preview size"
            onChange={(event) => void saveSettings({ previewSize: Number(event.target.value) })}
          />
        </div>

        <div className="seg">
          <button
            className={!listView ? 'on' : ''}
            title="Grid"
            onClick={() => void saveSettings({ gridColumns: listView ? 2 : settings.gridColumns })}
          >
            <Icon name="grid" size={16} />
          </button>
          <button
            className={listView ? 'on' : ''}
            title="List"
            onClick={() => void saveSettings({ gridColumns: 1 })}
          >
            <Icon name="list" size={16} />
          </button>
        </div>

        <Dropdown icon="sort" label={SORTS.find((s) => s.key === filters.sort)?.label ?? 'Sort'} closeOnPick>
          {SORTS.map((s) => (
            <button
              key={s.key}
              className={`dd-item ${filters.sort === s.key ? 'on' : ''}`}
              onClick={() => setFilters({ sort: s.key })}
            >
              {s.label}
            </button>
          ))}
        </Dropdown>
      </div>

      {(dirty || selection.length > 0) && (
        <div className="toolbar-row sub">
          {dirty ? (
            <button
              className="btn sm ghost"
              onClick={() => setFilters({ ...emptyFilters, sort: filters.sort })}
            >
              <Icon name="close" size={12} /> Clear filters
            </button>
          ) : null}
          <div className="toolbar-spacer" />
          {selection.length > 0 && (
            <>
              <strong style={{ fontSize: 12.5 }}>{selection.length} selected</strong>
              <button className="btn sm" title="Activate" disabled={Boolean(busy)} onClick={() => void activate(selection)}>
                <Icon name="check" size={14} />
              </button>
              <button className="btn sm" title="Deactivate" disabled={Boolean(busy)} onClick={() => void deactivate(selection)}>
                <Icon name="power" size={14} />
              </button>
              <button className="btn sm" title="Download" disabled={Boolean(busy)} onClick={() => void download(selection)}>
                <Icon name="download" size={14} />
              </button>
              <button className="btn sm ghost" title="Clear selection" onClick={clearSelection}>
                <Icon name="close" size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </header>
  )
}

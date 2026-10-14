import { useMemo } from 'react'
import { useApp } from '../store'
import { applyFilters } from '../lib/filter'

export default function StatusBar(): React.JSX.Element {
  const progress = useApp((s) => s.progress)
  const busy = useApp((s) => s.busy)
  const fonts = useApp((s) => s.fonts)
  const collections = useApp((s) => s.collections)
  const filters = useApp((s) => s.filters)
  const selection = useApp((s) => s.selection)

  const { fonts: visible, fuzzy } = useMemo(
    () => applyFilters(fonts, filters, collections),
    [fonts, filters, collections]
  )

  // The sidebar shows library totals, so the grid's own count has to be visible
  // here; otherwise a filtered view looks like it contradicts the sidebar.
  const filtering = Boolean(
    filters.query ||
      filters.providers.length ||
      filters.categories.length ||
      filters.onlyActive ||
      filters.onlyInstalled ||
      filters.variableOnly ||
      filters.onlyFavorites ||
      filters.collectionId
  )

  const message = busy ?? progress?.message ?? 'Ready'

  return (
    <footer className="statusbar">
      <span>{message}</span>

      {progress && progress.total > 0 ? (
        <div className="progress">
          <div style={{ width: `${Math.round((progress.completed / progress.total) * 100)}%` }} />
        </div>
      ) : (
        busy && (
          <div className="progress indeterminate">
            <div />
          </div>
        )
      )}

      <div style={{ flex: 1 }} />

      {selection.length > 1 && <span>{selection.length} selected</span>}

      {filtering ? (
        <span>
          Showing <strong style={{ color: 'var(--text)' }}>{visible.length.toLocaleString()}</strong>{' '}
          of {fonts.length.toLocaleString()} faces
          {fuzzy && (
            <>
              {' · '}
              <span
                style={{ color: 'var(--warn)' }}
                title="No exact match — showing the closest spelling"
              >
                fuzzy match
              </span>
            </>
          )}
        </span>
      ) : (
        <span>{fonts.length.toLocaleString()} faces indexed</span>
      )}
    </footer>
  )
}

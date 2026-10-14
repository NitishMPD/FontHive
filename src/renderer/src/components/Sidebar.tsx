import { useMemo } from 'react'
import { useApp } from '../store'
import Icon from './Icon'
import Logo from './Logo'
import type { ProviderId } from '@shared/types'

const PROVIDER_ORDER: ProviderId[] = ['local', 'google', 'fontsource', 'bunny']

export default function Sidebar(): React.JSX.Element {
  const fonts = useApp((s) => s.fonts)
  const providers = useApp((s) => s.providers)
  const collections = useApp((s) => s.collections)
  const view = useApp((s) => s.view)
  const filters = useApp((s) => s.filters)
  const setView = useApp((s) => s.setView)
  const setFilters = useApp((s) => s.setFilters)
  const rescan = useApp((s) => s.rescan)
  const busy = useApp((s) => s.busy)

  const activeCount = useMemo(() => fonts.filter((f) => f.active).length, [fonts])
  const favoriteCount = useMemo(() => fonts.filter((f) => f.favorite).length, [fonts])
  const onLibrary = view.kind === 'library'

  const browseLibrary = (patch: Parameters<typeof setFilters>[0]): void => {
    setFilters({ collectionId: null, providers: [], onlyActive: false, onlyFavorites: false, ...patch })
    setView({ kind: 'library' })
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <h1>Font Hive</h1>
      </div>

      <nav className="nav">
        <button
          className={`nav-item ${onLibrary && !filters.providers.length && !filters.onlyActive && !filters.onlyFavorites && !filters.collectionId ? 'active' : ''}`}
          onClick={() => browseLibrary({})}
        >
          <Icon name="library" />
          <span className="label">Browse Fonts</span>
          <span className="count">{fonts.length.toLocaleString()}</span>
        </button>

        <button
          className={`nav-item ${onLibrary && filters.onlyFavorites ? 'active' : ''}`}
          onClick={() => browseLibrary({ onlyFavorites: true })}
        >
          <Icon name="heart" />
          <span className="label">Favorites</span>
          <span className="count">{favoriteCount}</span>
        </button>

        <button
          className={`nav-item ${onLibrary && filters.onlyActive ? 'active' : ''}`}
          onClick={() => browseLibrary({ onlyActive: true })}
        >
          <Icon name="check" />
          <span className="label">Active</span>
          <span className="count">{activeCount}</span>
        </button>

        <div className="nav-section">Sources</div>
        {PROVIDER_ORDER.map((id) => {
          const info = providers.find((p) => p.id === id)
          if (!info) return null
          const isActive = onLibrary && filters.providers.includes(id)
          return (
            <button
              key={id}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => browseLibrary({ providers: [id] })}
            >
              <span className={`dot ${id}`} />
              <span className="label">{info.name}</span>
              <span className="count">{info.count.toLocaleString()}</span>
            </button>
          )
        })}

        <div className="nav-section">
          <span>Collections</span>
          <button
            className="icon-btn"
            title="New collection"
            onClick={() => setView({ kind: 'collection', id: 'new' })}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>

        {collections.length === 0 && (
          <div style={{ padding: '2px 8px', fontSize: 11.5, color: 'var(--text-faint)' }}>
            No collections yet
          </div>
        )}

        {collections.map((collection) => {
          const browsing = onLibrary && filters.collectionId === collection.id
          const editing = view.kind === 'collection' && view.id === collection.id
          return (
            <div className="nav-row" key={collection.id}>
              <button
                className={`nav-item ${browsing ? 'active' : ''}`}
                onClick={() => browseLibrary({ collectionId: collection.id })}
              >
                <Icon name={collection.rule ? 'sparkle' : 'layers'} size={14} />
                <span className="label">{collection.name}</span>
                {collection.rule && <span className="count">smart</span>}
              </button>
              <button
                className={`icon-btn ${editing ? 'on' : ''}`}
                title="Edit collection"
                onClick={() => setView({ kind: 'collection', id: collection.id })}
              >
                <Icon name="settings" size={12} />
              </button>
            </div>
          )
        })}

        <div className="nav-section">Manage</div>
        <button
          className={`nav-item ${view.kind === 'folders' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'folders' })}
        >
          <Icon name="folder" />
          <span className="label">Folders</span>
        </button>
        <button
          className={`nav-item ${view.kind === 'providers' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'providers' })}
        >
          <Icon name="globe" />
          <span className="label">Catalogue sources</span>
        </button>
        <button
          className={`nav-item ${view.kind === 'settings' ? 'active' : ''}`}
          onClick={() => setView({ kind: 'settings' })}
        >
          <Icon name="settings" />
          <span className="label">Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button className="btn" onClick={() => void rescan()} disabled={Boolean(busy)}>
          <Icon name="refresh" size={14} className={busy ? 'spin' : undefined} />
          Rescan folders
        </button>
      </div>
    </aside>
  )
}

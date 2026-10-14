import type { ProviderId } from '@shared/types'
import { useApp } from '../store'
import Icon from './Icon'

function timeAgo(ts?: number): string {
  if (!ts) return 'never fetched'
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86400)} d ago`
}

export default function ProvidersView(): React.JSX.Element {
  const providers = useApp((s) => s.providers)
  const refreshProvider = useApp((s) => s.refreshProvider)
  const busy = useApp((s) => s.busy)
  const setFilters = useApp((s) => s.setFilters)
  const setView = useApp((s) => s.setView)
  const fonts = useApp((s) => s.fonts)

  const downloaded = (id: ProviderId): number =>
    fonts.filter((f) => f.provider === id && f.filePath).length

  return (
    <div className="panel">
      <h2>Catalogue sources</h2>
      <p className="sub">
        Providers supply font catalogues you can preview instantly and download as installable files.
        Local folders are managed separately.
      </p>

      {providers.map((provider) => {
        const canFetch = provider.remote
        const isRefreshing = provider.status === 'refreshing'
        return (
          <div className="card" key={provider.id}>
            <div className="card-head">
              <span className={`dot ${provider.id}`} />
              <h3>{provider.name}</h3>
              {provider.status === 'error' && <span className="badge">error</span>}
              {provider.status === 'ready' && provider.remote && (
                <span className="badge active">ready</span>
              )}
            </div>

            <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="badge">{provider.count.toLocaleString()} faces indexed</span>
              {provider.remote && (
                <span className="badge">{downloaded(provider.id).toLocaleString()} downloaded</span>
              )}
              <div style={{ flex: 1 }} />
              {provider.count > 0 && (
                <button
                  className="btn sm"
                  onClick={() => {
                    setFilters({ collectionId: null, providers: [provider.id] })
                    setView({ kind: 'library' })
                  }}
                >
                  <Icon name="eye" size={13} /> Browse
                </button>
              )}
              {canFetch && (
                <button
                  className="btn sm primary"
                  disabled={Boolean(busy) || isRefreshing}
                  onClick={() => void refreshProvider(provider.id)}
                >
                  <Icon name="download" size={13} className={isRefreshing ? 'spin' : undefined} />
                  {provider.count > 0 ? 'Refresh' : 'Fetch catalogue'}
                </button>
              )}
            </div>

            {provider.error && (
              <p style={{ color: 'var(--danger)', fontSize: 12, margin: '0 0 8px' }}>
                {provider.error}
              </p>
            )}

            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {provider.attribution}
              {provider.homepage && (
                <>
                  {' · '}
                  <a
                    href={provider.homepage}
                    onClick={(event) => {
                      event.preventDefault()
                      void window.api.openExternal(provider.homepage!)
                    }}
                    style={{ color: 'var(--accent)' }}
                  >
                    visit
                  </a>
                </>
              )}
            </p>
          </div>
        )
      })}
    </div>
  )
}

import { useEffect } from 'react'
import { useApp } from './store'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import FontGrid from './components/FontGrid'
import DetailPanel from './components/DetailPanel'
import CollectionsView from './components/CollectionsView'
import ProvidersView from './components/ProvidersView'
import FoldersView from './components/FoldersView'
import SettingsView from './components/SettingsView'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const selectedId = useApp((s) => s.selectedId)
  const init = useApp((s) => s.init)
  const fonts = useApp((s) => s.fonts)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') useApp.getState().select(null)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        document.querySelector<HTMLInputElement>('.search input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="empty" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <div>
          <h3>Loading library…</h3>
        </div>
      </div>
    )
  }

  const selected = selectedId ? fonts.find((f) => f.id === selectedId) ?? null : null
  // Browsing a collection is a filter on the grid; editing one is its own view.
  const showGrid = view.kind === 'library'

  return (
    <div className="app">
      <Sidebar />

      <div className="main">
        <Toolbar />

        <div className="workspace">
          <div className="content">
            {showGrid && <FontGrid />}
            {view.kind === 'collection' && <CollectionsView collectionId={view.id} />}
            {view.kind === 'providers' && <ProvidersView />}
            {view.kind === 'folders' && <FoldersView />}
            {view.kind === 'settings' && <SettingsView />}
          </div>

          {selected && showGrid && <DetailPanel font={selected} />}
        </div>

        <StatusBar />
      </div>

      <Toasts />
    </div>
  )
}

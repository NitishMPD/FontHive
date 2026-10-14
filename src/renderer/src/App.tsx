import { useEffect } from 'react'
import { useApp } from './store'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import FontGrid from './components/FontGrid'
import DetailPanel from './components/DetailPanel'
import CollectionsView from './components/CollectionsView'
import PairsView from './components/PairsView'
import ProvidersView from './components/ProvidersView'
import FoldersView from './components/FoldersView'
import SettingsView from './components/SettingsView'
import StatusBar from './components/StatusBar'
import Toasts from './components/Toasts'
import TitleBar from './components/TitleBar'
import Skeleton from './components/Skeleton'
import { usePresence } from './lib/usePresence'

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const view = useApp((s) => s.view)
  const selectedId = useApp((s) => s.selectedId)
  const init = useApp((s) => s.init)
  const collapsed = useApp((s) => s.sidebarCollapsed)
  const fonts = useApp((s) => s.fonts)

  useEffect(() => {
    const unsubscribe = window.api.onAppUpdate((appUpdate) => {
      useApp.setState((state) => (state.appUpdate?.revision ?? -1) < appUpdate.revision ? { appUpdate } : {})
    })
    void init()
    return unsubscribe
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

  const selectedFont = selectedId ? fonts.find((f) => f.id === selectedId) ?? null : null
  const { item: selected, leaving } = usePresence(selectedFont)

  if (!ready) return <Skeleton />

  // Browsing a collection is a filter on the grid; editing one is its own view.
  const showGrid = view.kind === 'library'

  return (
    <div className="shell">
    <TitleBar />
    <div className={`app ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar />

      <div className="main">
        <Toolbar />

        <div className="workspace">
          <div className="content">
            <div className="view" key={view.kind === 'collection' ? `collection:${view.id}` : view.kind}>
              {showGrid && <FontGrid />}
              {view.kind === 'collection' && <CollectionsView collectionId={view.id} />}
              {view.kind === 'pairs' && <PairsView />}
              {view.kind === 'providers' && <ProvidersView />}
              {view.kind === 'folders' && <FoldersView />}
              {view.kind === 'settings' && <SettingsView />}
            </div>
          </div>

          {selected && showGrid && <DetailPanel font={selected} leaving={leaving} />}
        </div>

        <StatusBar />
      </div>

      <Toasts />
    </div>
    </div>
  )
}

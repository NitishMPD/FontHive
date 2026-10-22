import { useEffect, useState } from 'react'
import { desktopWindow } from '../lib/desktop'
import { applyTheme, getTheme } from '../lib/theme'
import Icon from './Icon'
import { useApp } from '../store'
import Logo from './Logo'

export default function TitleBar(): React.JSX.Element {
  const [theme, setTheme] = useState(getTheme)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let disposed = false
    const sync = (): void => { void desktopWindow.isMaximized().then((value) => { if (!disposed) setMaximized(value) }) }
    sync()
    const stop = desktopWindow.onResized(sync)
    return () => { disposed = true; void stop.then((unlisten) => unlisten()) }
  }, [])
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const updateStatus = useApp((s) => s.appUpdate?.status)
  const setView = useApp((s) => s.setView)

  const toggle = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="titlebar" data-tauri-drag-region>
      <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar">
        <Icon name="sidebar" size={16} />
      </button>
      <span data-tauri-drag-region><Logo size={20} /></span>
      <span className="titlebar-name" data-tauri-drag-region>Font Hive</span>
      <div style={{ flex: 1, alignSelf: 'stretch' }} data-tauri-drag-region />
      {updateStatus && ['available', 'downloading', 'downloaded'].includes(updateStatus) && (
        <button className="btn sm" onClick={() => setView({ kind: 'settings' })}>
          {updateStatus === 'downloaded' ? 'Update ready' : updateStatus === 'downloading' ? 'Downloading update' : 'Update available'}
        </button>
      )}
      <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
      <div className="window-controls">
        <button aria-label="Minimize window" title="Minimize" onClick={() => void desktopWindow.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" /></svg>
        </button>
        <button aria-label={maximized ? 'Restore window' : 'Maximize window'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => void desktopWindow.toggleMaximize()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {maximized ? <path d="M3 3V1h8v8H9M1 3h8v8H1z" /> : <path d="M1 1h10v10H1z" />}
          </svg>
        </button>
        <button className="window-close" aria-label="Close window" title="Close" onClick={() => void desktopWindow.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m1 1 10 10M11 1 1 11" /></svg>
        </button>
      </div>
    </div>
  )
}

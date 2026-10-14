import { useState } from 'react'
import { applyTheme, getTheme } from '../lib/theme'
import Icon from './Icon'
import { useApp } from '../store'
import Logo from './Logo'

export default function TitleBar(): React.JSX.Element {
  const [theme, setTheme] = useState(getTheme)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const updateStatus = useApp((s) => s.appUpdate?.status)
  const setView = useApp((s) => s.setView)

  const toggle = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="titlebar">
      <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar">
        <Icon name="sidebar" size={16} />
      </button>
      <Logo size={20} />
      <span className="titlebar-name">Font Hive</span>
      <div style={{ flex: 1 }} />
      {updateStatus && ['available', 'downloading', 'downloaded'].includes(updateStatus) && (
        <button className="btn sm" onClick={() => setView({ kind: 'settings' })}>
          {updateStatus === 'downloaded' ? 'Update ready' : updateStatus === 'downloading' ? 'Downloading update' : 'Update available'}
        </button>
      )}
      <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
    </div>
  )
}

import { useState } from 'react'
import { applyTheme, getTheme } from '../lib/theme'
import Icon from './Icon'
import Logo from './Logo'

export default function TitleBar(): React.JSX.Element {
  const [theme, setTheme] = useState(getTheme)

  const toggle = (): void => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }

  return (
    <div className="titlebar">
      <Logo size={20} />
      <span className="titlebar-name">Font Hive</span>
      <div style={{ flex: 1 }} />
      <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
      </button>
    </div>
  )
}

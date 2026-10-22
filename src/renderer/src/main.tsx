import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, getTheme } from './lib/theme'
import './styles.css'
import { initializeDesktop, onBackendError } from './lib/desktop'
import { useApp } from './store'

async function start(): Promise<void> {
  await initializeDesktop()
  onBackendError((error) => useApp.getState().toast(error, 'error'))
  applyTheme(getTheme())
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start().catch((error: unknown) => {
  const root = document.getElementById('root')!
  root.textContent = `Font Hive could not start: ${String(error)}. Close the app and try again.`
  root.setAttribute('role', 'alert')
})

export type Theme = 'dark' | 'light'

// Caption-button colours must match --bg-panel / --text-dim of each theme in styles.css.
const OVERLAY: Record<Theme, [string, string]> = {
  dark: ['#111111', '#a3a3a3'],
  light: ['#ffffff', '#55555b']
}

export function getTheme(): Theme {
  return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
  void window.api.setTitleBarTheme(...OVERLAY[theme])
}

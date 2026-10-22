import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppUpdateState, FontManagerApi, FontRecord, Progress } from '@shared/types'

const listeners = new Map<string, Set<(payload: never) => void>>()
const latest = new Map<string, unknown>()
const nativeListeners: UnlistenFn[] = []

// Register native listeners before bootstrap. React subscribers stay synchronous,
// including their cleanup functions under StrictMode.
export async function initializeDesktop(): Promise<void> {
  for (const event of ['progress', 'library-changed', 'app-update', 'backend-error']) {
    nativeListeners.push(await listen(event, ({ payload }) => {
      if (event !== 'progress' || payload !== null) latest.set(event, payload)
      else latest.delete(event)
      listeners.get(event)?.forEach((callback) => callback(payload as never))
    }))
  }
  window.addEventListener('beforeunload', () => nativeListeners.forEach((stop) => stop()), { once: true })
  window.api = api
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let callbacks = listeners.get(event)
  if (!callbacks) { callbacks = new Set(); listeners.set(event, callbacks) }
  callbacks.add(callback as (payload: never) => void)
  if (latest.has(event)) callback(latest.get(event) as T)
  return () => { callbacks.delete(callback as (payload: never) => void) }
}

function call<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>('dispatch', { action, args }).catch((error: unknown) => { throw new Error(String(error)) })
}

function update(action: string): Promise<void> {
  return invoke<void>('update_action', { action }).catch((error: unknown) => { throw new Error(String(error)) })
}

export function fontPreviewUrl(id: string): string {
  return `${convertFileSrc('font', 'hive-font')}?id=${encodeURIComponent(id)}`
}

export const desktopWindow = getCurrentWindow()

const api: FontManagerApi = {
  bootstrap: () => call('bootstrap'),
  rescan: () => call('rescan'),
  refreshProvider: (id, options) => call('refresh-provider', { id, ...options }),
  downloadFont: (id) => call('download-font', { id }),
  downloadMany: (ids) => call('download-many', { ids }),
  activate: (ids) => call('activate', { ids }),
  deactivate: (ids) => call('deactivate', { ids }),
  saveCollection: (collection) => call('save-collection', { collection }),
  deleteCollection: (id) => call('delete-collection', { id }),
  savePair: (pair) => call('save-pair', { pair }),
  deletePair: (id) => call('delete-pair', { id }),
  updateFont: (id, patch) => call('update-font', { id, patch }),
  updateMany: (ids, patch) => call('update-many', { ids, patch }),
  addFolder: () => call('add-folder'),
  removeFolder: (path) => call('remove-folder', { path }),
  toggleFolder: (path, enabled) => call('toggle-folder', { path, enabled }),
  saveSettings: (patch) => call('save-settings', { patch }),
  openExternal: (url) => call('open-external', { url }),
  revealFont: (id) => call('reveal-font', { id }),
  uninstallFontFile: (id) => call('uninstall-font-file', { id }),
  setTitleBarTheme: async (_color, symbolColor) => {
    await desktopWindow.setTheme(symbolColor === '#55555b' ? 'light' : 'dark')
  },
  checkForUpdates: () => update('check'),
  downloadUpdate: () => update('download'),
  installUpdate: () => update('install'),
  onAppUpdate: (callback) => subscribe<AppUpdateState>('app-update', callback),
  onProgress: (callback) => subscribe<Progress>('progress', callback),
  onLibraryChanged: (callback) => subscribe<FontRecord[]>('library-changed', callback)
}

export function onBackendError(callback: (error: string) => void): () => void {
  return subscribe('backend-error', callback)
}

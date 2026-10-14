import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  Collection,
  FontManagerApi,
  FontRecord,
  Progress,
  ProviderId,
  UpdateFontPatch
} from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: FontManagerApi = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),

  rescan: () => ipcRenderer.invoke('rescan'),
  refreshProvider: (id: ProviderId) => ipcRenderer.invoke('refresh-provider', id),
  downloadFont: (id: string) => ipcRenderer.invoke('download-font', id),
  downloadMany: (ids: string[]) => ipcRenderer.invoke('download-many', ids),

  activate: (ids: string[]) => ipcRenderer.invoke('activate', ids),
  deactivate: (ids: string[]) => ipcRenderer.invoke('deactivate', ids),

  saveCollection: (collection: Collection) => ipcRenderer.invoke('save-collection', collection),
  deleteCollection: (id: string) => ipcRenderer.invoke('delete-collection', id),
  updateFont: (id: string, patch: UpdateFontPatch) => ipcRenderer.invoke('update-font', id, patch),
  updateMany: (ids: string[], patch: UpdateFontPatch) => ipcRenderer.invoke('update-many', ids, patch),

  addFolder: () => ipcRenderer.invoke('add-folder'),
  removeFolder: (path: string) => ipcRenderer.invoke('remove-folder', path),
  toggleFolder: (path: string, enabled: boolean) =>
    ipcRenderer.invoke('toggle-folder', path, enabled),

  saveSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke('save-settings', patch),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  revealFont: (id: string) => ipcRenderer.invoke('reveal-font', id),
  uninstallFontFile: (id: string) => ipcRenderer.invoke('uninstall-font-file', id),

  onProgress: (cb: (progress: Progress) => void) => subscribe('progress', cb),
  onLibraryChanged: (cb: (fonts: FontRecord[]) => void) => subscribe('library-changed', cb)
}

contextBridge.exposeInMainWorld('api', api)

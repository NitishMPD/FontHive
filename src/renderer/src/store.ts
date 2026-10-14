import { create } from 'zustand'
import type {
  AppSettings,
  Collection,
  FontRecord,
  Progress,
  ProviderId,
  ProviderInfo,
  UpdateFontPatch,
  WatchedFolder
} from '@shared/types'
import { emptyFilters, type Filters } from './lib/filter'
import { defaultAxisValues } from './lib/fontface'

export type View =
  | { kind: 'library' }
  | { kind: 'collection'; id: string }
  | { kind: 'providers' }
  | { kind: 'folders' }
  | { kind: 'settings' }

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'success' | 'error'
  leaving?: boolean
}

interface AppState {
  ready: boolean
  fonts: FontRecord[]
  collections: Collection[]
  folders: WatchedFolder[]
  providers: ProviderInfo[]
  settings: AppSettings
  platform: string

  filters: Filters
  view: View
  selectedId: string | null
  progress: Progress | null
  busy: string | null
  toasts: Toast[]
  axisValues: Record<string, Record<string, number>>
  selection: string[]

  init: () => Promise<void>
  setFilters: (patch: Partial<Filters>) => void
  setView: (view: View) => void
  select: (id: string | null) => void
  toggleSelect: (id: string, additive: boolean) => void
  clearSelection: () => void

  setAxis: (fontId: string, tag: string, value: number) => void
  resetAxes: (fontId: string) => void

  activate: (ids: string[]) => Promise<void>
  deactivate: (ids: string[]) => Promise<void>
  toggleActive: (font: FontRecord) => Promise<void>

  rescan: () => Promise<void>
  refreshProvider: (id: ProviderId) => Promise<void>
  download: (ids: string[]) => Promise<void>

  saveCollection: (collection: Collection) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  updateFont: (id: string, patch: UpdateFontPatch) => Promise<void>
  updateMany: (ids: string[], patch: UpdateFontPatch) => Promise<void>

  addFolder: () => Promise<void>
  removeFolder: (path: string) => Promise<void>
  toggleFolder: (path: string, enabled: boolean) => Promise<void>
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>

  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

/**
 * Provider counts are derived from the library rather than trusted from the
 * main process, so a rescan that adds or removes faces cannot leave the sidebar
 * showing a stale number.
 */
function withCounts(providers: ProviderInfo[], fonts: FontRecord[]): ProviderInfo[] {
  if (!providers.length) return providers
  const counts = new Map<string, number>()
  for (const font of fonts) counts.set(font.provider, (counts.get(font.provider) ?? 0) + 1)
  return providers.map((provider) => ({ ...provider, count: counts.get(provider.id) ?? 0 }))
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  fonts: [],
  collections: [],
  folders: [],
  providers: [],
  settings: {
    previewText: '',
    previewSize: 34,
    gridColumns: 3,
    cacheDir: '',
    autoDownloadOnPreview: false,
    fontStoreDir: ''
  },
  platform: 'win32',

  filters: { ...emptyFilters },
  view: { kind: 'library' },
  selectedId: null,
  progress: null,
  busy: null,
  toasts: [],
  axisValues: {},
  selection: [],

  async init() {
    const boot = await window.api.bootstrap()
    set({
      ready: true,
      fonts: boot.fonts,
      collections: boot.collections,
      folders: boot.folders,
      providers: withCounts(boot.providers, boot.fonts),
      settings: boot.settings,
      platform: boot.platform
    })

    window.api.onProgress((progress) => set({ progress }))
    // Re-derive provider counts so the sidebar can never disagree with the grid.
    window.api.onLibraryChanged((fonts) =>
      set((state) => ({ fonts, providers: withCounts(state.providers, fonts) }))
    )
  },

  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  setView: (view) => set({ view }),
  select: (id) => set({ selectedId: id }),

  toggleSelect: (id, additive) => {
    const current = get().selection
    if (!additive) {
      set({ selection: current.length === 1 && current[0] === id ? [] : [id], selectedId: id })
      return
    }
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    set({ selection: next, selectedId: next[next.length - 1] ?? null })
  },

  clearSelection: () => set({ selection: [] }),

  setAxis: (fontId, tag, value) => {
    const font = get().fonts.find((f) => f.id === fontId)
    const base = get().axisValues[fontId] ?? (font ? defaultAxisValues(font) : {})
    set({ axisValues: { ...get().axisValues, [fontId]: { ...base, [tag]: value } } })
  },

  resetAxes: (fontId) => {
    const font = get().fonts.find((f) => f.id === fontId)
    if (!font) return
    set({ axisValues: { ...get().axisValues, [fontId]: defaultAxisValues(font) } })
  },

  async activate(ids) {
    if (!ids.length) return
    set({ busy: `Activating ${ids.length} font${ids.length > 1 ? 's' : ''}…` })
    try {
      const result = await window.api.activate(ids)
      if (result.failed.length) {
        get().toast(
          `${result.changed.length} activated, ${result.failed.length} failed: ${result.failed[0].error}`,
          'error'
        )
      }
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async deactivate(ids) {
    if (!ids.length) return
    set({ busy: `Deactivating ${ids.length}…` })
    try {
      await window.api.deactivate(ids)
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async toggleActive(font) {
    if (font.active) await get().deactivate([font.id])
    else await get().activate([font.id])
  },

  async rescan() {
    set({ busy: 'Scanning font folders…' })
    try {
      await window.api.rescan()
      set({ folders: (await window.api.bootstrap()).folders })
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async refreshProvider(id) {
    set({ busy: `Fetching catalogue…` })
    try {
      const providers = await window.api.refreshProvider(id)
      set({ providers })
      const info = providers.find((p) => p.id === id)
      if (info?.error) get().toast(info.error, 'error')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async download(ids) {
    if (!ids.length) return
    set({ busy: `Downloading ${ids.length}…` })
    try {
      const result = await window.api.downloadMany(ids)
      if (result.failed) get().toast(`Downloaded ${result.ok}, ${result.failed} failed`, 'error')
    } catch (err) {
      get().toast((err as Error).message, 'error')
    } finally {
      set({ busy: null, progress: null })
    }
  },

  async saveCollection(collection) {
    const collections = await window.api.saveCollection(collection)
    set({ collections })
  },

  async deleteCollection(id) {
    const collections = await window.api.deleteCollection(id)
    set({ collections })
    if (get().view.kind === 'collection' && (get().view as { id: string }).id === id) {
      set({ view: { kind: 'library' } })
    }
  },

  async updateFont(id, patch) {
    const font = await window.api.updateFont(id, patch)
    set({ fonts: get().fonts.map((f) => (f.id === id ? font : f)) })
  },

  async updateMany(ids, patch) {
    const touched = await window.api.updateMany(ids, patch)
    const byId = new Map(touched.map((f) => [f.id, f]))
    set({ fonts: get().fonts.map((f) => byId.get(f.id) ?? f) })
  },

  async addFolder() {
    const folders = await window.api.addFolder()
    set({ folders })
  },

  async removeFolder(path) {
    const folders = await window.api.removeFolder(path)
    set({ folders })
  },

  async toggleFolder(path, enabled) {
    const folders = await window.api.toggleFolder(path, enabled)
    set({ folders })
  },

  async saveSettings(patch) {
    const settings = await window.api.saveSettings(patch)
    set({ settings })
  },

  toast(text, tone = 'info') {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 7000 : 4000)
  },

  dismissToast(id) {
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 180)
  }
}))

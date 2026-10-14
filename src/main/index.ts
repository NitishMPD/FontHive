import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, ipcMain, protocol, shell } from 'electron'
import type {
  ActivationResult,
  AppSettings,
  Bootstrap,
  Collection,
  FontRecord,
  Progress,
  ProviderId,
  ProviderInfo,
  ScanResult,
  UpdateFontPatch,
  WatchedFolder
} from '@shared/types'
import { Activator } from './fonts/activation'
import { parseFontFile } from './fonts/metadata'
import { makeFamilyId, makeId, scanFolder, systemFontDirs } from './fonts/scanner'
import { Store } from './store'
import { catalogToRecords, isRemoteProvider, providerNames, remoteProviders } from './providers'
import { FONT_UA } from './providers/types'

const MIME: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttc: 'font/collection'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hive-font',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let win: BrowserWindow | null = null
let store: Store
let activator: Activator

const providerStatus: Record<ProviderId, ProviderInfo['status']> = {
  google: 'idle',
  bunny: 'idle',
  fontsource: 'idle',
  local: 'ready'
}
const providerErrors: Partial<Record<ProviderId, string>> = {}

/* ------------------------------------------------------------------ */
/* Renderer messaging                                                  */
/* ------------------------------------------------------------------ */

function emitProgress(progress: Progress): void {
  win?.webContents.send('progress', progress)
}

function emitLibrary(): void {
  win?.webContents.send('library-changed', store.fonts)
}

/** Keep the persisted `active` flag in sync with the OS font store. */
function reconcileActive(): void {
  const active = activator.activeIds()
  let changed = false
  for (const font of store.fonts) {
    const isActive = active.has(font.id)
    if (font.active !== isActive) {
      font.active = isActive
      changed = true
    }
  }
  if (changed) void store.flush()
}

function providerInfos(): ProviderInfo[] {
  const counts = new Map<ProviderId, number>()
  for (const font of store.fonts) counts.set(font.provider, (counts.get(font.provider) ?? 0) + 1)

  return (Object.keys(providerNames) as ProviderId[]).map((id) => {
    const count = counts.get(id) ?? 0
    // In-memory status resets on launch, but an indexed catalogue persists. Report
    // a populated provider as ready rather than implying it still needs fetching.
    const status: ProviderInfo['status'] =
      providerStatus[id] === 'idle' && isRemoteProvider(id) && count > 0
        ? 'ready'
        : providerStatus[id]

    return {
      id,
      name: providerNames[id],
      count,
      remote: isRemoteProvider(id),
      status,
      error: providerErrors[id],
      attribution: isRemoteProvider(id)
        ? remoteProviders[id].attribution
        : 'Your own folders and system fonts',
      homepage: isRemoteProvider(id) ? remoteProviders[id].homepage : undefined
    }
  })
}

/* ------------------------------------------------------------------ */
/* Local scanning                                                      */
/* ------------------------------------------------------------------ */

async function resolveLocalRoots(includeSystem: boolean): Promise<string[]> {
  const roots = store.folders.filter((f) => f.enabled).map((f) => f.path)
  if (includeSystem) roots.push(...(await systemFontDirs()))
  return [...new Set(roots.map((r) => path.normalize(r)))].filter(Boolean)
}

async function scanLocal(options: { includeSystem?: boolean } = {}): Promise<ScanResult> {
  const { includeSystem = true } = options
  const started = Date.now()
  const roots = await resolveLocalRoots(includeSystem)
  const errors: string[] = []
  const collected: FontRecord[] = []
  const seenIds = new Set<string>()

  for (const root of roots) {
    emitProgress({ phase: 'scan', completed: 0, total: 0, message: `Scanning ${root}` })
    const { fonts, errors: scanErrors } = await scanFolder(root, {
      provider: 'local',
      onProgress: emitProgress
    })
    errors.push(...scanErrors)
    for (const font of fonts) {
      if (seenIds.has(font.id)) continue
      seenIds.add(font.id)
      collected.push(font)
    }
  }

  // Prune only faces that live under a root we actually inspected this pass, so
  // a folders-only scan never drops the system fonts indexed by an earlier one.
  const retained = store.fonts.filter((font) => {
    if (font.provider !== 'local') return true
    if (!font.filePath) return true
    const underScannedRoot = roots.some((root) =>
      font.filePath!.toLowerCase().startsWith(root.toLowerCase())
    )
    if (!underScannedRoot) return true
    return seenIds.has(font.id)
  })
  const removed = store.fonts.length - retained.length

  store.setFonts(retained)
  const { added, updated } = store.upsertFonts(collected)

  const folderCounts = new Map<string, number>()
  for (const font of collected) {
    if (!font.filePath) continue
    for (const root of roots) {
      if (font.filePath.toLowerCase().startsWith(root.toLowerCase())) {
        folderCounts.set(root, (folderCounts.get(root) ?? 0) + 1)
        break
      }
    }
  }
  store.setFolders(
    store.folders.map((folder) => ({
      ...folder,
      fontCount: folderCounts.get(path.normalize(folder.path)) ?? folder.fontCount,
      lastScan: Date.now()
    }))
  )

  providerStatus.local = 'ready'
  emitLibrary()

  return {
    scanned: collected.length,
    added,
    updated,
    removed: Math.max(0, removed),
    errors: errors.slice(0, 50),
    durationMs: Date.now() - started
  }
}

/* ------------------------------------------------------------------ */
/* Remote catalogues                                                   */
/* ------------------------------------------------------------------ */

async function refreshProvider(id: ProviderId): Promise<ProviderInfo[]> {
  if (!isRemoteProvider(id)) return providerInfos()
  providerStatus[id] = 'refreshing'
  delete providerErrors[id]

  try {
    emitProgress({ phase: 'catalog', completed: 0, total: 1, message: `Fetching ${providerNames[id]} catalogue` })
    const faces = await remoteProviders[id].fetchCatalog()
    const records = catalogToRecords(id, faces)

    // Replace only this provider's catalogue; local and downloaded files survive.
    const others = store.fonts.filter((f) => f.provider !== id)
    const downloaded = new Map(
      store.fonts.filter((f) => f.provider === id && f.filePath).map((f) => [f.id, f])
    )
    const merged = records.map((record) => downloaded.get(record.id) ?? record)

    store.setFonts([...others, ...merged])
    store.setProviderMeta(id, { lastRefresh: Date.now() })
    providerStatus[id] = 'ready'
    emitLibrary()
  } catch (err) {
    providerStatus[id] = 'error'
    providerErrors[id] = (err as Error).message
  }

  return providerInfos()
}

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */

function cacheName(font: FontRecord, ext: string): string {
  const base = font.postScriptName.replace(/[^A-Za-z0-9._-]/g, '_')
  return `${font.provider}_${base}.${ext}`
}

async function downloadFont(id: string): Promise<FontRecord> {
  const font = store.fonts.find((f) => f.id === id)
  if (!font) throw new Error('Font not found in library')
  if (!isRemoteProvider(font.provider)) return font
  if (font.filePath) return font

  const provider = remoteProviders[font.provider]
  const target = await provider.resolveDownload(font)

  const res = await fetch(target.url, { headers: { 'user-agent': FONT_UA } })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength < 512) throw new Error('Downloaded file looks truncated or invalid')

  await fs.mkdir(store.settings.cacheDir, { recursive: true })
  const dest = path.join(store.settings.cacheDir, cacheName(font, target.format))
  await fs.writeFile(dest, buffer)

  // Re-parse so axes, weight and names come from the real binary.
  const faces = await parseFontFile(dest)
  const match =
    faces.find((f) => f.postScriptName.toLowerCase() === font.postScriptName.toLowerCase()) ??
    faces.find((f) => f.weight === font.weight && f.style === font.style) ??
    faces[0]

  const updated: FontRecord = {
    ...font,
    format: target.format,
    filePath: dest,
    cached: true,
    downloadUrl: target.url,
    // Trust the downloaded file over the catalogue: providers serve static
    // instances for a specific weight, which genuinely have no axes. Keeping the
    // catalogue's axes here would render axis controls that do nothing.
    axes: match ? match.axes : font.axes,
    weight: match?.weight ?? font.weight,
    style: match?.style ?? font.style,
    family: match?.family || font.family,
    subfamily: match?.subfamily || font.subfamily,
    fullName: match?.fullName || font.fullName,
    postScriptName: match?.postScriptName || font.postScriptName,
    category: match?.category || font.category,
    familyId: makeFamilyId(font.provider, match?.family || font.family)
  }

  const next = store.fonts.map((f) => (f.id === id ? updated : f))
  store.setFonts(next)
  emitLibrary()
  return updated
}

async function downloadMany(ids: string[]): Promise<{ ok: number; failed: number }> {
  let ok = 0
  let failed = 0
  let done = 0
  const limit = 4
  let cursor = 0

  const workers = Array.from({ length: Math.min(limit, ids.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= ids.length) return
      try {
        await downloadFont(ids[index])
        ok++
      } catch {
        failed++
      }
      done++
      emitProgress({
        phase: 'download',
        completed: done,
        total: ids.length,
        message: `Downloaded ${done} / ${ids.length}`
      })
    }
  })
  await Promise.all(workers)
  return { ok, failed }
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

async function setActivation(ids: string[], active: boolean): Promise<ActivationResult> {
  const changed: string[] = []
  const failed: { id: string; error: string }[] = []
  let done = 0

  for (const id of ids) {
    const font = store.fonts.find((f) => f.id === id)
    if (!font) {
      failed.push({ id, error: 'Font not found' })
      continue
    }
    try {
      if (active) {
        if (!font.filePath) await downloadFont(id)
        const refreshed = store.fonts.find((f) => f.id === id)!
        await activator.activate(refreshed)
        refreshed.active = true
      } else {
        await activator.deactivate(font)
        font.active = false
      }
      changed.push(id)
    } catch (err) {
      failed.push({ id, error: (err as Error).message })
    }
    done++
    emitProgress({
      phase: active ? 'activate' : 'deactivate',
      completed: done,
      total: ids.length,
      message: `${active ? 'Activating' : 'Deactivating'} ${done} / ${ids.length}`
    })
  }

  await store.flush()
  emitLibrary()
  return { changed, failed }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle('bootstrap', async (): Promise<Bootstrap> => {
    reconcileActive()
    return {
      fonts: store.fonts,
      collections: store.collections,
      folders: store.folders,
      providers: providerInfos(),
      settings: store.settings,
      platform: process.platform
    }
  })

  ipcMain.handle('rescan', () => scanLocal())
  ipcMain.handle('refresh-provider', (_e, id: ProviderId) => refreshProvider(id))
  ipcMain.handle('download-font', (_e, id: string) => downloadFont(id))
  ipcMain.handle('download-many', (_e, ids: string[]) => downloadMany(ids))
  ipcMain.handle('activate', (_e, ids: string[]) => setActivation(ids, true))
  ipcMain.handle('deactivate', (_e, ids: string[]) => setActivation(ids, false))

  ipcMain.handle('save-collection', (_e, collection: Collection) => {
    const list = [...store.collections]
    const index = list.findIndex((c) => c.id === collection.id)
    if (index >= 0) list[index] = collection
    else list.push(collection)
    store.setCollections(list)
    return list
  })

  ipcMain.handle('delete-collection', (_e, id: string) => {
    const list = store.collections.filter((c) => c.id !== id)
    store.setCollections(list)
    return list
  })

  ipcMain.handle('update-font', (_e, id: string, patch: UpdateFontPatch) => {
    const font = store.fonts.find((f) => f.id === id)
    if (!font) throw new Error('Font not found')
    Object.assign(font, patch)
    store.setFonts(store.fonts)
    return font
  })

  ipcMain.handle('update-many', (_e, ids: string[], patch: UpdateFontPatch) => {
    const touched: FontRecord[] = []
    for (const id of ids) {
      const font = store.fonts.find((f) => f.id === id)
      if (!font) continue
      Object.assign(font, patch)
      touched.push(font)
    }
    store.setFonts(store.fonts)
    return touched
  })

  ipcMain.handle('add-folder', async () => {
    const result = await dialogShowOpenDialog()
    if (result) {
      const exists = store.folders.some((f) => path.normalize(f.path) === path.normalize(result))
      if (!exists) {
        const folder: WatchedFolder = { path: result, provider: 'local', enabled: true, fontCount: 0 }
        store.setFolders([...store.folders, folder])
        await scanLocal()
      }
    }
    return store.folders
  })

  ipcMain.handle('remove-folder', (_e, target: string) => {
    const normalized = path.normalize(target).toLowerCase()
    store.setFolders(store.folders.filter((f) => path.normalize(f.path) !== path.normalize(target)))

    // A removed folder is no longer in the scan roots, so pruning would skip its
    // faces. Drop them explicitly; anything also provided by a system directory
    // is restored by the rescan below.
    const pruned = store.fonts.filter(
      (font) =>
        !(
          font.provider === 'local' &&
          font.filePath &&
          font.filePath.toLowerCase().startsWith(normalized)
        )
    )
    if (pruned.length !== store.fonts.length) {
      store.setFonts(pruned)
      void scanLocal()
    }
    return store.folders
  })

  ipcMain.handle('toggle-folder', (_e, target: string, enabled: boolean) => {
    store.setFolders(
      store.folders.map((f) =>
        path.normalize(f.path) === path.normalize(target) ? { ...f, enabled } : f
      )
    )
    return store.folders
  })

  ipcMain.handle('save-settings', (_e, patch: Partial<AppSettings>) => store.setSettings(patch))
  ipcMain.handle('open-external', (_e, url: string) => shell.openExternal(url))

  ipcMain.handle('set-title-bar-theme', (_e, color: string, symbolColor: string) => {
    win?.setTitleBarOverlay({ color, symbolColor, height: TITLE_BAR_HEIGHT })
  })

  ipcMain.handle('reveal-font', (_e, id: string) => {
    const font = store.fonts.find((f) => f.id === id)
    if (font?.filePath) shell.showItemInFolder(font.filePath)
  })

  ipcMain.handle('uninstall-font-file', async (_e, id: string) => {
    const font = store.fonts.find((f) => f.id === id)
    if (!font) throw new Error('Font not found')
    if (font.active) await activator.deactivate(font)
    if (font.filePath) {
      try {
        await fs.unlink(font.filePath)
      } catch {
        /* already gone */
      }
    }
    font.filePath = undefined
    font.cached = false
    font.active = false
    store.setFonts(store.fonts)
    emitLibrary()
    return font
  })
}

async function dialogShowOpenDialog(): Promise<string | null> {
  const { dialog } = await import('electron')
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder containing fonts',
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

const TITLE_BAR_HEIGHT = 40

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0b0c',
    title: 'Font Hive',
    icon: path.join(app.getAppPath(), 'resources/icon.png'),
    // Custom title bar: the renderer draws the drag area, Windows draws the caption buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#101011', symbolColor: '#a8a296', height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  store = await Store.open()
  activator = await Activator.open()
  reconcileActive()

  protocol.handle('hive-font', async (request) => {
    try {
      const url = new URL(request.url)
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const font = store.fonts.find((f) => f.id === id)
      if (!font?.filePath) return new Response('Not found', { status: 404 })
      const data = await fs.readFile(font.filePath)
      const ext = path.extname(font.filePath).slice(1).toLowerCase()
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type': MIME[ext] ?? 'application/octet-stream',
          'cache-control': 'public, max-age=31536000, immutable'
        }
      })
    } catch {
      return new Response('Error', { status: 500 })
    }
  })

  registerIpc()
  createWindow()

  // First run: index the system fonts so the library is never empty. Afterwards,
  // keep watched folders in sync in the background without paying for a full
  // system rescan on every launch.
  if (store.fonts.length === 0) {
    void scanLocal()
  } else if (store.folders.some((f) => f.enabled)) {
    void scanLocal({ includeSystem: false })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void store?.close()
})

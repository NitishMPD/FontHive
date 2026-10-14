import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type {
  AppSettings,
  Collection,
  FontRecord,
  ProviderId,
  WatchedFolder
} from '@shared/types'

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      // Never let a corrupt state file brick the app: park it and continue empty.
      try {
        await fs.rename(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        /* best effort */
      }
    }
    return fallback
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
  await fs.rename(tmp, file)
}

export interface PersistedState {
  /** Bumped when derived font fields change meaning, forcing a re-index. */
  schemaVersion: number
  fonts: FontRecord[]
  collections: Collection[]
  folders: WatchedFolder[]
  settings: AppSettings
  providerMeta: Partial<Record<ProviderId, { lastRefresh?: number }>>
}

/**
 * v2: category classification switched to PANOSE. Local files are re-indexed
 * from disk; remote catalogue records keep their provider-supplied category.
 */
const SCHEMA_VERSION = 2

export function defaultSettings(): AppSettings {
  return {
    previewText: 'Sphinx of black quartz, judge my vow',
    previewSize: 34,
    gridColumns: 3,
    cacheDir: path.join(app.getPath('userData'), 'font-cache'),
    autoDownloadOnPreview: false,
    fontStoreDir: path.join(app.getPath('userData'), 'font-store')
  }
}

/**
 * Single source of truth for library state. Writes are debounced so a bulk
 * operation (thousands of activated faces) touches the disk once.
 */
export class Store {
  private readonly file: string
  private state: PersistedState
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()

  private constructor(file: string, state: PersistedState) {
    this.file = file
    this.state = state
  }

  static async open(): Promise<Store> {
    const file = path.join(app.getPath('userData'), 'library.json')
    const loaded = await readJson<Partial<PersistedState>>(file, {})
    const defaults = defaultSettings()

    // A schema bump invalidates derived fields. Local faces are cheap to
    // re-index from disk, so drop only those and let the next scan restore them.
    const stale = (loaded.schemaVersion ?? 0) !== SCHEMA_VERSION
    const fonts = stale
      ? (loaded.fonts ?? []).filter((font) => font.provider !== 'local')
      : (loaded.fonts ?? [])

    const state: PersistedState = {
      schemaVersion: SCHEMA_VERSION,
      fonts,
      collections: loaded.collections ?? [],
      folders: loaded.folders ?? [],
      settings: { ...defaults, ...(loaded.settings ?? {}) },
      providerMeta: loaded.providerMeta ?? {}
    }
    // Paths can move between versions/platforms; keep cache dirs anchored to this install.
    state.settings.cacheDir = defaults.cacheDir
    state.settings.fontStoreDir = defaults.fontStoreDir
    return new Store(file, state)
  }

  get fonts(): FontRecord[] {
    return this.state.fonts
  }

  get collections(): Collection[] {
    return this.state.collections
  }

  get folders(): WatchedFolder[] {
    return this.state.folders
  }

  get settings(): AppSettings {
    return this.state.settings
  }

  get providerMeta(): PersistedState['providerMeta'] {
    return this.state.providerMeta
  }

  setFonts(fonts: FontRecord[]): void {
    this.state.fonts = fonts
    this.schedule()
  }

  setCollections(collections: Collection[]): void {
    this.state.collections = collections
    this.schedule()
  }

  setFolders(folders: WatchedFolder[]): void {
    this.state.folders = folders
    this.schedule()
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    this.state.settings = { ...this.state.settings, ...patch }
    this.schedule()
    return this.state.settings
  }

  setProviderMeta(id: ProviderId, meta: { lastRefresh?: number }): void {
    this.state.providerMeta[id] = { ...this.state.providerMeta[id], ...meta }
    this.schedule()
  }

  /** Upsert by id, preserving user-owned fields on the existing record. */
  upsertFonts(incoming: FontRecord[]): { added: number; updated: number } {
    const byId = new Map(this.state.fonts.map((f) => [f.id, f]))
    let added = 0
    let updated = 0
    for (const font of incoming) {
      const existing = byId.get(font.id)
      if (existing) {
        byId.set(font.id, {
          ...font,
          collections: existing.collections,
          tags: existing.tags,
          rating: existing.rating,
          note: existing.note,
          addedAt: existing.addedAt
        })
        updated++
      } else {
        byId.set(font.id, font)
        added++
      }
    }
    this.state.fonts = [...byId.values()]
    this.schedule()
    return { added, updated }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 250)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const snapshot = JSON.stringify(this.state)
    this.writing = this.writing.then(() => writeJsonAtomic(this.file, JSON.parse(snapshot)))
    await this.writing
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

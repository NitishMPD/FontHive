/**
 * Shared contract between the Electron main process, the preload bridge and the
 * React renderer. Keep this file dependency-free so both sides can import it.
 */

export type ProviderId = 'google' | 'bunny' | 'fontsource' | 'local'

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2'

export type FontStyle = 'normal' | 'italic'

export type FontCategory =
  | 'sans-serif'
  | 'serif'
  | 'display'
  | 'monospace'
  | 'handwriting'
  | 'other'

/** A single variable-font axis, e.g. `wght` 100..900. */
export interface VariationAxis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

/** One selectable font face in the library. */
export interface FontRecord {
  /** Stable identity: `<provider>:<postScriptName|hash>`. */
  id: string
  provider: ProviderId

  family: string
  subfamily: string
  fullName: string
  postScriptName: string

  format: FontFormat
  weight: number
  style: FontStyle
  category: FontCategory
  axes: VariationAxis[]

  /** Absolute path once the file exists on disk (local or cached download). */
  filePath?: string
  /** Remote location when the face is catalogue-only. */
  downloadUrl?: string
  /** Provider-supplied preview URL (woff2) so catalogue fonts render instantly. */
  previewUrl?: string
  /** Direct woff2 preview used when the provider has no CSS endpoint. */
  previewFileUrl?: string

  /** Downloaded into the local cache. */
  cached: boolean
  /** Installed into the operating system font store. */
  active: boolean

  familyId: string
  version?: string
  license?: string
  designer?: string
  copyright?: string

  collections: string[]
  tags: string[]
  rating?: number
  note?: string
  addedAt: number
}

export type ConditionField =
  | 'family'
  | 'category'
  | 'provider'
  | 'weight'
  | 'style'
  | 'active'
  | 'tag'
  | 'rating'
  | 'axes'

export type ConditionOp =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'gt'
  | 'lt'
  | 'isTrue'
  | 'isFalse'
  | 'hasAxis'

export interface SmartCondition {
  field: ConditionField
  op: ConditionOp
  value: string | number | boolean
}

export interface SmartRule {
  match: 'all' | 'any'
  conditions: SmartCondition[]
}

export interface Collection {
  id: string
  name: string
  /** Manual membership, used when `rule` is absent. */
  fontIds: string[]
  /** When present the collection is dynamic and `fontIds` is ignored. */
  rule?: SmartRule
  createdAt: number
}

export interface WatchedFolder {
  path: string
  provider: ProviderId
  enabled: boolean
  fontCount: number
  lastScan?: number
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** Catalogue fonts currently indexed for this provider. */
  count: number
  /** Provider can fetch catalogues from the network. */
  remote: boolean
  /** Human-readable state for the UI. */
  status: 'idle' | 'refreshing' | 'ready' | 'error'
  error?: string
  attribution?: string
  homepage?: string
}

export interface Progress {
  phase: string
  completed: number
  total: number
  message: string
}

export interface ScanResult {
  scanned: number
  added: number
  updated: number
  removed: number
  errors: string[]
  durationMs: number
}

export interface ActivationResult {
  changed: string[]
  failed: { id: string; error: string }[]
}

export interface AppSettings {
  previewText: string
  previewSize: number
  gridColumns: number
  cacheDir: string
  /** Download a face the first time it is previewed. */
  autoDownloadOnPreview: boolean
  fontStoreDir: string
}

export interface Bootstrap {
  fonts: FontRecord[]
  collections: Collection[]
  folders: WatchedFolder[]
  providers: ProviderInfo[]
  settings: AppSettings
  platform: string
}

export interface UpdateFontPatch {
  collections?: string[]
  tags?: string[]
  rating?: number
  note?: string
}

/** The API surface exposed on `window.api` by the preload bridge. */
export interface FontManagerApi {
  bootstrap(): Promise<Bootstrap>

  rescan(): Promise<ScanResult>
  refreshProvider(id: ProviderId): Promise<ProviderInfo[]>
  downloadFont(id: string): Promise<FontRecord>
  downloadMany(ids: string[]): Promise<{ ok: number; failed: number }>

  activate(ids: string[]): Promise<ActivationResult>
  deactivate(ids: string[]): Promise<ActivationResult>

  saveCollection(collection: Collection): Promise<Collection[]>
  deleteCollection(id: string): Promise<Collection[]>
  updateFont(id: string, patch: UpdateFontPatch): Promise<FontRecord>
  updateMany(ids: string[], patch: UpdateFontPatch): Promise<FontRecord[]>

  addFolder(): Promise<WatchedFolder[]>
  removeFolder(path: string): Promise<WatchedFolder[]>
  toggleFolder(path: string, enabled: boolean): Promise<WatchedFolder[]>

  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  openExternal(url: string): Promise<void>
  revealFont(id: string): Promise<void>
  uninstallFontFile(id: string): Promise<FontRecord>

  onProgress(cb: (progress: Progress) => void): () => void
  onLibraryChanged(cb: (fonts: FontRecord[]) => void): () => void
}

declare global {
  interface Window {
    api: FontManagerApi
  }
}

/**
 * Shared contract between the Tauri command adapter and the React renderer.
 * Keep this file dependency-free.
 */

export type ProviderId = 'google' | 'bunny' | 'fontsource' | 'local' | 'dafont' | '1001fonts'

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

/**
 * Measured vertical proportions, normalised to the em square. Only available
 * once a face has been parsed from a real file, so catalogue-only entries leave
 * this undefined — pairing falls back to category and weight when it is absent.
 */
export interface FontMetrics {
  /** x-height as a fraction of the em square, e.g. 0.52. */
  xHeight?: number
  /** cap-height as a fraction of the em square, e.g. 0.72. */
  capHeight?: number
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
  /** Index inside a TTC/OTC collection, zero for standalone fonts. */
  faceIndex?: number
  /** Remote location when the face is catalogue-only. */
  downloadUrl?: string
  /** Provider-supplied preview URL (woff2) so catalogue fonts render instantly. */
  previewUrl?: string
  /** Direct woff2 preview used when the provider has no CSS endpoint. */
  previewFileUrl?: string
  /**
   * Tried after `previewFileUrl`. Lets a provider prefer a variable file (so the
   * axis controls do something) while keeping a static instance as a safety net.
   */
  previewFallbackUrl?: string

  /** Downloaded into the local cache. */
  cached: boolean
  /** Installed into the operating system font store. */
  active: boolean
  /** Only the record owning an app-created OS installation may remove it. */
  managedInstall?: boolean
  installationStatus?: 'known' | 'unknown'
  installationKey?: string
  widthClass?: number
  packageOnly?: boolean
  packageId?: string
  packageUrl?: string
  sourceUrl?: string
  sourceQuery?: string
  previewImageUrl?: string
  licenseText?: string

  familyId: string
  version?: string
  license?: string
  designer?: string
  copyright?: string
  /** Present only for faces parsed from a file. */
  metrics?: FontMetrics

  collections: string[]
  tags: string[]
  rating?: number
  favorite?: boolean
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

/** A saved heading + body combination. */
export interface FontPair {
  id: string
  name: string
  /** Face used for headings and display text. */
  headingId: string
  /** Face used for body copy. */
  bodyId: string
  note?: string
  createdAt: number
}

export interface ProviderInfo {
  paged?: boolean
  page?: number
  query?: string
  hasMore?: boolean
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
  skipped: string[]
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

export interface AppUpdateState {
  revision: number
  status: 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
  currentVersion: string
  availableVersion: string | null
  percent: number | null
  error: string | null
}

export interface Bootstrap {
  fonts: FontRecord[]
  collections: Collection[]
  pairs: FontPair[]
  folders: WatchedFolder[]
  providers: ProviderInfo[]
  settings: AppSettings
  platform: string
  appUpdate: AppUpdateState
}

export interface UpdateFontPatch {
  collections?: string[]
  tags?: string[]
  rating?: number
  favorite?: boolean
  note?: string
}

/** The API surface exposed on `window.api` by the Tauri adapter. */
export interface FontManagerApi {
  bootstrap(): Promise<Bootstrap>

  rescan(): Promise<ScanResult>
  refreshProvider(id: ProviderId, options?: { query?: string; page?: number }): Promise<ProviderInfo[]>
  downloadFont(id: string): Promise<FontRecord>
  downloadMany(ids: string[]): Promise<{ ok: number; failed: number }>

  activate(ids: string[]): Promise<ActivationResult>
  deactivate(ids: string[]): Promise<ActivationResult>

  saveCollection(collection: Collection): Promise<Collection[]>
  deleteCollection(id: string): Promise<Collection[]>
  savePair(pair: FontPair): Promise<FontPair[]>
  deletePair(id: string): Promise<FontPair[]>
  updateFont(id: string, patch: UpdateFontPatch): Promise<FontRecord>
  updateMany(ids: string[], patch: UpdateFontPatch): Promise<FontRecord[]>

  addFolder(): Promise<WatchedFolder[]>
  removeFolder(path: string): Promise<WatchedFolder[]>
  toggleFolder(path: string, enabled: boolean): Promise<WatchedFolder[]>

  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  openExternal(url: string): Promise<void>
  revealFont(id: string): Promise<void>
  setTitleBarTheme(color: string, symbolColor: string): Promise<void>
  uninstallFontFile(id: string): Promise<FontRecord>

  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  onAppUpdate(cb: (state: AppUpdateState) => void): () => void

  onProgress(cb: (progress: Progress) => void): () => void
  onLibraryChanged(cb: (fonts: FontRecord[]) => void): () => void
}

declare global {
  interface Window {
    api: FontManagerApi
  }
}

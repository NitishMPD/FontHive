import type {
  FontCategory,
  FontFormat,
  FontRecord,
  FontStyle,
  ProviderId,
  VariationAxis
} from '@shared/types'

/** A catalogue face as advertised by a remote provider, before it is installed. */
export interface CatalogFace {
  family: string
  subfamily: string
  fullName: string
  postScriptName: string
  weight: number
  style: FontStyle
  category: FontCategory
  axes: VariationAxis[]
  /** CSS URL the renderer can link for an instant preview without downloading. */
  previewUrl?: string
  /** Direct woff2 used when a CSS URL is not appropriate. */
  previewFileUrl?: string
  version?: string
  license?: string
  designer?: string
}

export interface DownloadTarget {
  url: string
  format: FontFormat
}

export interface Provider {
  id: ProviderId
  name: string
  remote: boolean
  attribution?: string
  homepage?: string
  /** Fetch and normalise the provider catalogue. */
  fetchCatalog(): Promise<CatalogFace[]>
  /**
   * Resolve an installable (TTF/OTF) file for a face. Remote providers serve
   * woff2 for previews, but Windows can only install TrueType/OpenType, so this
   * is deliberately separate from the preview URL.
   */
  resolveDownload(font: FontRecord): Promise<DownloadTarget>
}

export function normalizeCategory(raw: string | undefined): FontCategory {
  const s = (raw || '').toLowerCase()
  if (s.includes('sans')) return 'sans-serif'
  if (s.includes('serif') && !s.includes('sans')) return 'serif'
  if (s.includes('mono')) return 'monospace'
  if (s.includes('hand') || s.includes('script') || s.includes('cursive')) return 'handwriting'
  if (s.includes('display') || s.includes('decorative')) return 'display'
  return 'other'
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export const FONT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Legacy UA makes Google Fonts emit installable TrueType instead of woff2. */
export const LEGACY_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'

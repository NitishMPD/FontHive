import type { FontRecord, FontStyle, VariationAxis } from '@shared/types'
import {
  FONT_UA,
  LEGACY_UA,
  headOk,
  normalizeCategory,
  slugify,
  type CatalogFace,
  type DownloadTarget,
  type Provider
} from './types'

const METADATA_URL = 'https://fonts.google.com/metadata/fonts'

interface GoogleFamily {
  family: string
  category?: string
  subsets?: string[]
  fonts?: Record<string, unknown>
  axes?: { tag: string; min: number; max: number; defaultValue?: number }[]
  designers?: string[]
  lastModified?: string
  isOpenSource?: boolean
  popularity?: number
}

export function googleCssUrl(family: string, weight: number, style: FontStyle): string {
  const axis = style === 'italic' ? `ital,wght@1,${weight}` : `wght@${weight}`
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${axis}&display=swap`
}

/** Google's legacy endpoint emits TrueType URLs from the shared gstatic host. */
async function googleTrueTypeUrl(family: string, weight: number, italic: boolean): Promise<string | null> {
  const spec = italic ? `italic` : ''
  const url = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:${weight}${spec}`
  const res = await fetch(url, { headers: { 'user-agent': LEGACY_UA } })
  if (!res.ok) return null
  const css = await res.text()
  const match = css.match(/url\((https:\/\/[^)]+)\)/)
  return match ? match[1] : null
}

function parseAxes(raw: GoogleFamily['axes']): VariationAxis[] {
  if (!Array.isArray(raw)) return []
  return raw.map((a) => ({
    tag: a.tag,
    name: a.tag,
    min: a.min,
    default: typeof a.defaultValue === 'number' ? a.defaultValue : a.min,
    max: a.max
  }))
}

export const googleProvider: Provider = {
  id: 'google',
  name: 'Google Fonts',
  remote: true,
  attribution: 'Fonts served by Google Fonts (fonts.google.com)',
  homepage: 'https://fonts.google.com',

  async fetchCatalog(): Promise<CatalogFace[]> {
    const res = await fetch(METADATA_URL, { headers: { 'user-agent': FONT_UA } })
    if (!res.ok) throw new Error(`Google Fonts metadata request failed: HTTP ${res.status}`)

    // The endpoint prefixes the JSON body with an anti-JSONP guard.
    const body = (await res.text()).replace(/^\)\]\}'\s*/, '')
    const parsed = JSON.parse(body) as { familyMetadataList?: GoogleFamily[] }
    const families = parsed.familyMetadataList ?? []

    const faces: CatalogFace[] = []
    for (const family of families) {
      const axes = parseAxes(family.axes)
      const category = normalizeCategory(family.category)
      const variants = Object.keys(family.fonts ?? {})
      const keys = variants.length > 0 ? variants : ['400']

      for (const key of keys) {
        const match = key.match(/^(\d+)(i?)$/)
        if (!match) continue
        const weight = Number(match[1])
        const style: FontStyle = match[2] === 'i' ? 'italic' : 'normal'
        const subfamily =
          style === 'italic'
            ? weight === 400
              ? 'Italic'
              : `Italic ${weight}`
            : weight === 400
              ? 'Regular'
              : String(weight)

        faces.push({
          family: family.family,
          subfamily,
          fullName: `${family.family} ${subfamily}`,
          postScriptName: `${family.family.replace(/\s+/g, '')}-${weight}${style === 'italic' ? 'italic' : ''}`,
          weight,
          style,
          category,
          axes,
          previewUrl: googleCssUrl(family.family, weight, style),
          version: family.lastModified,
          license: family.isOpenSource ? 'Open source' : undefined,
          designer: family.designers?.join(', ')
        })
      }
    }
    return faces
  },

  async resolveDownload(font: FontRecord): Promise<DownloadTarget> {
    // Fontsource republishes Google families as flat, predictable TTF files.
    const id = slugify(font.family)
    const style = font.style === 'italic' ? 'italic' : 'normal'
    const candidates = [
      `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${font.weight}-${style}.ttf`,
      `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-${font.weight}-${style}.woff2`
    ]
    for (const url of candidates) {
      if (await headOk(url)) {
        return { url, format: url.endsWith('.ttf') ? 'ttf' : 'woff2' }
      }
    }

    // Fall back to Google's own TrueType endpoint.
    const ttf = await googleTrueTypeUrl(font.family, font.weight, font.style === 'italic')
    if (ttf) return { url: ttf, format: 'ttf' }

    throw new Error(
      `No installable file found for ${font.family} ${font.subfamily}. Windows can only install TrueType/OpenType fonts.`
    )
  }
}

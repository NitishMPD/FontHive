import type { FontRecord, FontStyle } from '@shared/types'
import {
  FONT_UA,
  normalizeCategory,
  type CatalogFace,
  type DownloadTarget,
  type Provider
} from './types'

const API_URL = 'https://api.fontsource.org/v1/fonts'
const CDN = 'https://cdn.jsdelivr.net/fontsource/fonts'
const VARIABLE_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource-variable'

interface FontsourceFont {
  id: string
  family: string
  subsets?: string[]
  weights?: number[]
  styles?: string[]
  defSubset?: string
  variable?: boolean
  category?: string
  license?: string
  type?: string
}

/**
 * Fontsource publishes both woff2 (preview) and ttf (installable) at stable
 * paths, which makes it the most reliable download source in the app.
 */
export function fontsourceUrl(
  id: string,
  subset: string,
  weight: number,
  style: FontStyle,
  ext: 'ttf' | 'woff2'
): string {
  return `${CDN}/${id}@latest/${subset}-${weight}-${style}.${ext}`
}

/**
 * Variable faces live in a separate npm scope and are named by the axes they
 * carry. The static per-weight files ignore `font-variation-settings`, so only
 * this one makes the axis controls do anything.
 */
export function fontsourceVariableUrl(id: string, subset: string, style: FontStyle): string {
  return `${VARIABLE_CDN}/${id}@latest/files/${id}-${subset}-wght-${style}.woff2`
}

export const fontsourceProvider: Provider = {
  id: 'fontsource',
  name: 'Fontsource',
  remote: true,
  attribution: 'Open-source fonts packaged by Fontsource and served via jsDelivr',
  homepage: 'https://fontsource.org',

  async fetchCatalog(): Promise<CatalogFace[]> {
    const res = await fetch(API_URL, { headers: { 'user-agent': FONT_UA } })
    if (!res.ok) throw new Error(`Fontsource API request failed: HTTP ${res.status}`)

    const list = JSON.parse(await res.text()) as FontsourceFont[]
    const faces: CatalogFace[] = []

    for (const entry of list) {
      const subset = entry.defSubset || entry.subsets?.[0] || 'latin'
      const weights = entry.weights?.length ? entry.weights : [400]
      const styles = entry.styles?.length ? entry.styles : ['normal']
      const category = normalizeCategory(entry.category)

      for (const weight of weights) {
        for (const style of styles) {
          const isItalic = style === 'italic'
          const subfamily =
            weight === 400 && !isItalic ? 'Regular' : `${isItalic ? 'Italic ' : ''}${weight}`.trim()

          faces.push({
            family: entry.family,
            subfamily,
            fullName: `${entry.family} ${subfamily}`,
            postScriptName: `${entry.family.replace(/\s+/g, '')}-${weight}${isItalic ? 'italic' : ''}`,
            weight,
            style: isItalic ? 'italic' : 'normal',
            // Range taken from the package's real weights rather than assumed.
            axes: entry.variable
              ? [
                  {
                    tag: 'wght',
                    name: 'Weight',
                    min: Math.min(...weights),
                    default: Math.min(Math.max(400, Math.min(...weights)), Math.max(...weights)),
                    max: Math.max(...weights)
                  }
                ]
              : [],
            category,
            previewFileUrl: entry.variable
              ? fontsourceVariableUrl(entry.id, subset, isItalic ? 'italic' : 'normal')
              : fontsourceUrl(entry.id, subset, weight, isItalic ? 'italic' : 'normal', 'woff2'),
            // Static instance as a safety net: if the variable file is missing the
            // browser falls through to this instead of showing nothing.
            previewFallbackUrl: entry.variable
              ? fontsourceUrl(entry.id, subset, weight, isItalic ? 'italic' : 'normal', 'woff2')
              : undefined,
            version: entry.type,
            license: entry.license,
            designer: entry.type ? `Source: ${entry.type}` : undefined
          })
        }
      }
    }
    return faces
  },

  async resolveDownload(font: FontRecord): Promise<DownloadTarget> {
    // Downloads must be a static instance, so mirror the static woff2 path — not
    // the variable one — into .ttf.
    const staticWoff2 = font.previewFallbackUrl || font.previewUrl || font.previewFileUrl || ''
    const ttf = staticWoff2.replace(/\.woff2$/, '.ttf')
    if (ttf && ttf !== staticWoff2) return { url: ttf, format: 'ttf' }

    const familySlug = font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    return {
      url: `${CDN}/${familySlug}@latest/latin-${font.weight}-${font.style}.ttf`,
      format: 'ttf'
    }
  }
}

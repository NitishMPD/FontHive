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
            // Variable packages expose their full axis on the wght variable file.
            axes: entry.variable
              ? [{ tag: 'wght', name: 'Weight', min: 100, default: 400, max: 900 }]
              : [],
            category,
            previewFileUrl: fontsourceUrl(entry.id, subset, weight, isItalic ? 'italic' : 'normal', 'woff2'),
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
    // The catalogue stores the exact woff2 path, so mirror it to .ttf.
    const woff2 = font.previewUrl || font.previewFileUrl || ''
    const ttf = woff2.replace(/\.woff2$/, '.ttf')
    if (ttf && ttf !== woff2) return { url: ttf, format: 'ttf' }

    const familySlug = font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    return {
      url: `${CDN}/${familySlug}@latest/latin-${font.weight}-${font.style}.ttf`,
      format: 'ttf'
    }
  }
}

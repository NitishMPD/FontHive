import type { FontRecord, FontStyle } from '@shared/types'
import {
  FONT_UA,
  normalizeCategory,
  type CatalogFace,
  type DownloadTarget,
  type Provider
} from './types'
import { googleProvider } from './google'

const LIST_URL = 'https://fonts.bunny.net/list'

interface BunnyFamily {
  variants?: Record<string, number>
  isVariable?: boolean
  styles?: string[]
  weights?: number[]
  familyName?: string
  defSubset?: string
  category?: string
}

export function bunnyCssUrl(slug: string, weight: number, style: FontStyle): string {
  const spec = style === 'italic' ? `${weight}i` : String(weight)
  return `https://fonts.bunny.net/css?family=${encodeURIComponent(slug)}:${spec}`
}

export const bunnyProvider: Provider = {
  id: 'bunny',
  name: 'Bunny Fonts',
  remote: true,
  attribution: 'Bunny Fonts is a privacy-focused mirror of the Google Fonts library',
  homepage: 'https://fonts.bunny.net',

  async fetchCatalog(): Promise<CatalogFace[]> {
    const res = await fetch(LIST_URL, { headers: { 'user-agent': FONT_UA } })
    if (!res.ok) throw new Error(`Bunny Fonts list request failed: HTTP ${res.status}`)

    const list = JSON.parse(await res.text()) as Record<string, BunnyFamily>
    const faces: CatalogFace[] = []

    for (const [slug, entry] of Object.entries(list)) {
      const family = entry.familyName || slug
      const weights = entry.weights?.length ? entry.weights : [400]
      const styles = entry.styles?.length ? entry.styles : ['normal']
      const category = normalizeCategory(entry.category)

      for (const weight of weights) {
        for (const style of styles) {
          const isItalic = style === 'italic'
          const subfamily =
            weight === 400 && !isItalic ? 'Regular' : `${isItalic ? 'Italic ' : ''}${weight}`.trim()

          faces.push({
            family,
            subfamily,
            fullName: `${family} ${subfamily}`,
            postScriptName: `${family.replace(/\s+/g, '')}-${weight}${isItalic ? 'italic' : ''}`,
            weight,
            style: isItalic ? 'italic' : 'normal',
            category,
            axes: [],
            previewUrl: bunnyCssUrl(slug, weight, isItalic ? 'italic' : 'normal'),
            license: 'Open source'
          })
        }
      }
    }
    return faces
  },

  /**
   * Bunny mirrors the Google Fonts catalogue but only serves web formats
   * (woff/woff2). Windows cannot install those as system fonts, so downloads
   * are resolved from the same family on Google's installable endpoint.
   */
  async resolveDownload(font: FontRecord): Promise<DownloadTarget> {
    try {
      return await googleProvider.resolveDownload(font)
    } catch {
      throw new Error(
        `Bunny Fonts only serves web formats for ${font.family}. No installable TrueType file was found on the mirror source.`
      )
    }
  }
}

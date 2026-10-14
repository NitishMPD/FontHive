import { promises as fs } from 'node:fs'
import path from 'node:path'
import fontkit from 'fontkit'
import type { FontCategory, FontFormat, FontStyle, VariationAxis } from '@shared/types'

export interface ParsedFace {
  family: string
  subfamily: string
  fullName: string
  postScriptName: string
  weight: number
  style: FontStyle
  axes: VariationAxis[]
  version?: string
  license?: string
  designer?: string
  copyright?: string
  category: FontCategory
}

export const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])

export function formatOf(file: string): FontFormat {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.otf' || ext === '.otc') return 'otf'
  if (ext === '.woff') return 'woff'
  if (ext === '.woff2') return 'woff2'
  return 'ttf'
}

/* ------------------------------------------------------------------ *
 * Classification
 *
 * PANOSE is a 10-byte array:
 *   [0] familyKind  [1] serifStyle  [2] weight     [3] proportion
 *   [4] contrast    [5] strokeVariation ...
 * It is far more reliable than guessing from the family name, so it is
 * consulted first and the name is only a fallback.
 * ------------------------------------------------------------------ */

const PANOSE_LATIN_TEXT = 2
const PANOSE_LATIN_HANDWRITTEN = 3
const PANOSE_LATIN_DECORATIVE = 4
const PANOSE_LATIN_SYMBOL = 5

function deriveCategory(
  family: string,
  subfamily: string,
  panose: unknown,
  isFixedPitch: boolean
): FontCategory {
  const name = `${family} ${subfamily}`.toLowerCase()

  // A fixed-pitch post table is definitive.
  if (isFixedPitch) return 'monospace'
  // Well-known monospace families sometimes ship isFixedPitch = 0.
  if (/\b(mono|code|console|consol|courier|menlo|inconsolata|fira ?code|source ?code)\b/.test(name)) {
    return 'monospace'
  }

  if (Array.isArray(panose) && panose.length >= 4) {
    const familyKind = panose[0]
    const serifStyle = panose[1]
    const proportion = panose[3]

    if (familyKind === PANOSE_LATIN_HANDWRITTEN) return 'handwriting'
    if (familyKind === PANOSE_LATIN_DECORATIVE) return 'display'
    if (familyKind === PANOSE_LATIN_SYMBOL) return 'other'

    if (familyKind === PANOSE_LATIN_TEXT) {
      if (proportion === 9) return 'monospace'
      // 2-10 are the serif variants, 11-13 the sans variants, 14-15 flared/rounded.
      if (serifStyle >= 2 && serifStyle <= 10) return 'serif'
      if (serifStyle >= 11 && serifStyle <= 13) return 'sans-serif'
      if (serifStyle === 14 || serifStyle === 15) return 'sans-serif'
    }
  }

  // Name-based fallback for fonts with an absent or "No Fit" PANOSE record.
  if (/\b(script|hand|brush|calligraph|signature|cursive|ink ?free)\b/.test(name)) return 'handwriting'
  if (/\b(display|deco|poster|banner|black|fat|inline|shadow)\b/.test(name)) return 'display'
  if (
    /\b(serif|times|georgia|garamond|baskerv|didot|bodoni|playfair|merriweather|caslon|century|palatino|book antiqua|cambria|constantia|sylfaen)\b/.test(
      name
    )
  ) {
    return 'serif'
  }
  if (
    /\b(sans|grotesk|grotesque|helvetica|arial|roboto|inter|open sans|lato|segoe|calibri|tahoma|verdana|franklin|candara|corbel)\b/.test(
      name
    )
  ) {
    return 'sans-serif'
  }

  return 'other'
}

function parseAxes(raw: unknown): VariationAxis[] {
  if (!raw || typeof raw !== 'object') return []
  const out: VariationAxis[] = []
  for (const [tag, value] of Object.entries(raw as Record<string, unknown>)) {
    const axis = value as { name?: string; min?: number; default?: number; max?: number }
    if (typeof axis?.min !== 'number' || typeof axis?.max !== 'number') continue
    out.push({
      tag,
      name: axis.name || tag,
      min: axis.min,
      default: typeof axis.default === 'number' ? axis.default : axis.min,
      max: axis.max
    })
  }
  return out
}

interface FontkitFont {
  familyName?: string
  subfamilyName?: string
  fullName?: string
  postscriptName?: string
  version?: string
  copyright?: string
  designer?: string
  license?: string
  variationAxes?: Record<string, unknown>
  italicAngle?: number
  post?: { isFixedPitch?: number }
  fonts?: FontkitFont[]
  'OS/2'?: { usWeightClass?: number; panose?: unknown }
}

function weightFromSubfamily(subfamily: string): number {
  const s = subfamily.toLowerCase()
  if (/\b(thin|hairline)\b/.test(s)) return 100
  if (/\b(extra ?light|ultra ?light)\b/.test(s)) return 200
  if (/\blight\b/.test(s)) return 300
  if (/\bmedium\b/.test(s)) return 500
  if (/\b(semi ?bold|demi ?bold)\b/.test(s)) return 600
  if (/\b(extra ?bold|ultra ?bold)\b/.test(s)) return 800
  if (/\b(black|heavy)\b/.test(s)) return 900
  if (/\bbold\b/.test(s)) return 700
  return 400
}

function faceFrom(font: FontkitFont, fallbackName: string): ParsedFace {
  const family = font.familyName?.trim() || fallbackName
  const subfamily = font.subfamilyName?.trim() || 'Regular'
  const fullName = font.fullName?.trim() || `${family} ${subfamily}`.trim()
  const postScriptName = font.postscriptName?.trim() || fullName.replace(/\s+/g, '-')

  const weight = font['OS/2']?.usWeightClass ?? weightFromSubfamily(subfamily)
  const style: FontStyle =
    /italic|oblique/i.test(subfamily) || (font.italicAngle ?? 0) !== 0 ? 'italic' : 'normal'
  const isFixedPitch = (font.post?.isFixedPitch ?? 0) !== 0

  return {
    family,
    subfamily,
    fullName,
    postScriptName,
    weight,
    style,
    axes: parseAxes(font.variationAxes),
    version: font.version,
    license: font.license,
    designer: font.designer,
    copyright: font.copyright,
    category: deriveCategory(family, subfamily, font['OS/2']?.panose, isFixedPitch)
  }
}

/**
 * Parse one font file into its faces. TrueType collections (.ttc/.otc) yield
 * several faces; a parse failure returns an empty array rather than throwing so
 * one bad file cannot abort a scan.
 */
export async function parseFontFile(file: string): Promise<ParsedFace[]> {
  let buffer: Buffer
  try {
    buffer = await fs.readFile(file)
  } catch {
    return []
  }

  try {
    const opened = fontkit.create(buffer) as unknown as FontkitFont
    if (Array.isArray(opened?.fonts)) {
      return opened.fonts.map((f) => faceFrom(f, path.parse(file).name))
    }
    return [faceFrom(opened, path.parse(file).name)]
  } catch {
    return []
  }
}

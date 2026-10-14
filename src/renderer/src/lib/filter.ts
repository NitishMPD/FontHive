import type { Collection, FontRecord, SmartCondition, SmartRule } from '@shared/types'

export type SortKey = 'name' | 'newest' | 'weight'

export interface Filters {
  query: string
  providers: string[]
  categories: string[]
  onlyActive: boolean
  onlyInstalled: boolean
  variableOnly: boolean
  onlyFavorites: boolean
  sort: SortKey
  collectionId: string | null
  /** Collapse the same face offered by several catalogue sources into one card. */
  groupDuplicates: boolean
}

export const emptyFilters: Filters = {
  query: '',
  providers: [],
  categories: [],
  onlyActive: false,
  onlyInstalled: false,
  variableOnly: false,
  onlyFavorites: false,
  sort: 'name',
  collectionId: null,
  groupDuplicates: true
}

function matchCondition(font: FontRecord, condition: SmartCondition): boolean {
  const { field, op, value } = condition

  switch (field) {
    case 'family': {
      const haystack = `${font.family} ${font.subfamily}`.toLowerCase()
      const needle = String(value).toLowerCase()
      if (op === 'contains') return haystack.includes(needle)
      if (op === 'equals') return haystack === needle
      if (op === 'notEquals') return haystack !== needle
      return false
    }
    case 'category':
      return op === 'notEquals' ? font.category !== value : font.category === value
    case 'provider':
      return op === 'notEquals' ? font.provider !== value : font.provider === value
    case 'weight': {
      const target = Number(value)
      if (op === 'gt') return font.weight > target
      if (op === 'lt') return font.weight < target
      if (op === 'notEquals') return font.weight !== target
      return font.weight === target
    }
    case 'style':
      return op === 'notEquals' ? font.style !== value : font.style === value
    case 'active':
      return op === 'isFalse' ? !font.active : font.active
    case 'tag': {
      const needle = String(value).toLowerCase()
      if (op === 'notEquals') return !font.tags.some((t) => t.toLowerCase() === needle)
      return font.tags.some((t) => t.toLowerCase() === needle)
    }
    case 'rating': {
      const target = Number(value)
      const rating = font.rating ?? 0
      if (op === 'gt') return rating > target
      if (op === 'lt') return rating < target
      return rating === target
    }
    case 'axes':
      return op === 'hasAxis'
        ? font.axes.some((a) => a.tag.toLowerCase() === String(value).toLowerCase())
        : font.axes.length > 0
    default:
      return false
  }
}

export function matchesRule(font: FontRecord, rule: SmartRule): boolean {
  if (!rule.conditions.length) return true
  return rule.match === 'all'
    ? rule.conditions.every((c) => matchCondition(font, c))
    : rule.conditions.some((c) => matchCondition(font, c))
}

export function collectionMembers(fonts: FontRecord[], collection: Collection): FontRecord[] {
  if (collection.rule?.conditions.length) {
    return fonts.filter((f) => matchesRule(f, collection.rule!))
  }
  const ids = new Set(collection.fontIds)
  return fonts.filter((f) => ids.has(f.id))
}

/** Search matches the family, subfamily and face name, case-insensitively. */
function matchesQuery(font: FontRecord, query: string): boolean {
  if (!query) return true
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `${font.family} ${font.subfamily} ${font.fullName} ${font.postScriptName} ${font.tags.join(' ')}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/* ------------------------------------------------------------------ *
 * Typo-tolerant fallback
 *
 * Only runs when strict matching returns nothing, so exact search stays
 * crisp and the extra cost is paid only on a likely misspelling. The
 * distance is Damerau-Levenshtein (optimal string alignment), which
 * counts an adjacent transposition as one edit — that is what makes
 * "Giest" find "Geist".
 * ------------------------------------------------------------------ */

function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1

  let prev2: number[] = []
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j)

  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = new Array(b.length + 1)
    cur[0] = i
    let rowMin = cur[0]

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)

      // Adjacent transposition, e.g. "gi|e" vs "ge|i".
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1)
      }

      cur[j] = value
      if (value < rowMin) rowMin = value
    }

    // Every remaining row can only grow, so bail out early.
    if (rowMin > max) return max + 1

    prev2 = prev
    prev = cur
  }

  return prev[b.length]
}

/** Shorter terms are too ambiguous to correct safely. */
function maxDistanceFor(term: string): number {
  if (term.length <= 3) return 0
  if (term.length <= 6) return 1
  return 2
}

function words(font: FontRecord): string[] {
  return `${font.family} ${font.subfamily} ${font.postScriptName}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function fuzzyMatchesTerms(font: FontRecord, terms: string[]): boolean {
  const parts = words(font)
  return terms.every((term) => {
    const max = maxDistanceFor(term)
    return parts.some((part) => {
      if (part.includes(term)) return true
      if (max === 0) return false
      if (Math.abs(part.length - term.length) > max) return false
      return editDistance(term, part, max) <= max
    })
  })
}

export interface FilterResult {
  fonts: FontRecord[]
  /** Strict matching found nothing, so these came from typo-tolerant matching. */
  fuzzy: boolean
}

let memoFonts: FontRecord[] | null = null
let memoFilters: Filters | null = null
let memoCollections: Collection[] | null = null
let memoResult: FilterResult | null = null

/**
 * Both the grid and the status bar request the filtered set on every render.
 * The inputs are reference-stable between changes, so memoising here makes the
 * second request free rather than repeating a 25k-face pass.
 */
export function applyFilters(
  fonts: FontRecord[],
  filters: Filters,
  collections: Collection[]
): FilterResult {
  if (
    memoResult &&
    fonts === memoFonts &&
    filters === memoFilters &&
    collections === memoCollections
  ) {
    return memoResult
  }

  const result = computeFilters(fonts, filters, collections)
  memoFonts = fonts
  memoFilters = filters
  memoCollections = collections
  memoResult = result
  return result
}

const PROVIDER_RANK: Record<string, number> = { local: 4, google: 3, fontsource: 2, bunny: 1 }

/**
 * The same face is often listed by several providers — 86% of this library's
 * faces are. Keep the most useful copy of each so browsing shows fonts rather
 * than sources. Records are untouched, so a source filter still lists exactly
 * what that source offers.
 */
export function dedupeFaces(fonts: FontRecord[]): FontRecord[] {
  const score = (f: FontRecord): number =>
    (f.active ? 100 : 0) + (f.favorite ? 60 : 0) + (f.filePath ? 50 : 0) + (PROVIDER_RANK[f.provider] ?? 0)
  const best = new Map<string, FontRecord>()
  for (const font of fonts) {
    const key = `${font.family.trim().toLowerCase()}|${font.weight}|${font.style}`
    const current = best.get(key)
    if (!current || score(font) > score(current)) best.set(key, font)
  }
  return [...best.values()]
}

function computeFilters(
  fonts: FontRecord[],
  filters: Filters,
  collections: Collection[]
): FilterResult {
  let pool = fonts

  if (filters.collectionId) {
    const collection = collections.find((c) => c.id === filters.collectionId)
    if (collection) pool = collectionMembers(pool, collection)
  }

  const passesFacets = (font: FontRecord): boolean => {
    if (filters.providers.length && !filters.providers.includes(font.provider)) return false
    if (filters.categories.length && !filters.categories.includes(font.category)) return false
    if (filters.onlyActive && !font.active) return false
    if (filters.onlyInstalled && !font.filePath) return false
    if (filters.variableOnly && !font.axes.length) return false
    if (filters.onlyFavorites && !font.favorite) return false
    return true
  }

  const filtered = pool.filter(passesFacets)
  const candidates = filters.groupDuplicates ? dedupeFaces(filtered) : filtered

  const byName = (a: FontRecord, b: FontRecord): number =>
    a.family.localeCompare(b.family) || a.weight - b.weight
  const order: Record<SortKey, (a: FontRecord, b: FontRecord) => number> = {
    name: byName,
    newest: (a, b) => b.addedAt - a.addedAt || byName(a, b),
    weight: (a, b) => a.weight - b.weight || byName(a, b)
  }

  const strict = candidates.filter((font) => matchesQuery(font, filters.query))
  if (strict.length > 0 || !filters.query.trim()) {
    return { fonts: strict.sort(order[filters.sort]), fuzzy: false }
  }

  // Nothing matched exactly, so retry tolerating typos. Each family is scored
  // once and cached: thousands of faces share one family name, so this cuts the
  // work from ~25k comparisons to a few thousand.
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean)
  const familyHit = new Map<string, boolean>()
  const fuzzy = candidates.filter((font) => {
    let hit = familyHit.get(font.family)
    if (hit === undefined) {
      hit = fuzzyMatchesTerms(font, terms)
      familyHit.set(font.family, hit)
    }
    return hit
  })

  return { fonts: fuzzy.sort(order[filters.sort]), fuzzy: true }
}

export const CATEGORIES = [
  'sans-serif',
  'serif',
  'display',
  'monospace',
  'handwriting',
  'other'
] as const

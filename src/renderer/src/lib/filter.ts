import type { Collection, FontRecord, SmartCondition, SmartRule } from '@shared/types'

export interface Filters {
  query: string
  providers: string[]
  categories: string[]
  onlyActive: boolean
  onlyInstalled: boolean
  variableOnly: boolean
  collectionId: string | null
}

export const emptyFilters: Filters = {
  query: '',
  providers: [],
  categories: [],
  onlyActive: false,
  onlyInstalled: false,
  variableOnly: false,
  collectionId: null
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

export function applyFilters(
  fonts: FontRecord[],
  filters: Filters,
  collections: Collection[]
): FontRecord[] {
  let pool = fonts

  if (filters.collectionId) {
    const collection = collections.find((c) => c.id === filters.collectionId)
    if (collection) pool = collectionMembers(pool, collection)
  }

  return pool.filter((font) => {
    if (!matchesQuery(font, filters.query)) return false
    if (filters.providers.length && !filters.providers.includes(font.provider)) return false
    if (filters.categories.length && !filters.categories.includes(font.category)) return false
    if (filters.onlyActive && !font.active) return false
    if (filters.onlyInstalled && !font.filePath) return false
    if (filters.variableOnly && !font.axes.length) return false
    return true
  })
}

export const CATEGORIES = [
  'sans-serif',
  'serif',
  'display',
  'monospace',
  'handwriting',
  'other'
] as const

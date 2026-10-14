import type { FontCategory, FontRecord } from '@shared/types'

/**
 * Font pairing suggestions.
 *
 * A good pairing balances contrast against harmony: the two faces must be
 * different enough to signal their different roles, yet similar enough to sit on
 * the same page. The scoring below encodes the rules typographers actually use,
 * and returns the reasoning so a suggestion can be judged rather than trusted.
 */

/** Categories that read comfortably at body size. */
const BODY_CATEGORIES: FontCategory[] = ['serif', 'sans-serif', 'monospace']

/** How many families enter the O(n²) scoring pass. */
const POOL_SIZE = 420

/** How often a single family may appear across the suggestion list. */
const MAX_FAMILY_USES = 2

/** Upper bound on the ranked list, so "show more" cannot run away. */
const MAX_SUGGESTIONS = 300

export interface PairSuggestion {
  heading: FontRecord
  body: FontRecord
  score: number
  reasons: string[]
}

interface Candidate {
  familyId: string
  heading: FontRecord
  body: FontRecord
}

/** Pick the face of a family best suited to one role. */
function pickFace(faces: FontRecord[], purpose: 'heading' | 'body'): FontRecord {
  const upright = faces.filter((f) => f.style === 'normal')
  const pool = upright.length ? upright : faces

  if (purpose === 'body') {
    // Body copy wants a regular upright: closest to 400 wins.
    return [...pool].sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0]
  }

  // Headings read best a touch heavy; prefer 700, then 600, then 800.
  const preference = [700, 600, 800]
  for (const weight of preference) {
    const hit = pool.find((f) => f.weight === weight)
    if (hit) return hit
  }
  return [...pool].sort((a, b) => b.weight - a.weight)[0]
}

function buildCandidates(fonts: FontRecord[]): Candidate[] {
  const byFamily = new Map<string, FontRecord[]>()
  for (const font of fonts) {
    const list = byFamily.get(font.familyId)
    if (list) list.push(font)
    else byFamily.set(font.familyId, [font])
  }

  const candidates: Candidate[] = []
  for (const [familyId, faces] of byFamily) {
    const bodyPool = faces.filter((f) => BODY_CATEGORIES.includes(f.category))
    if (!bodyPool.length) continue
    candidates.push({
      familyId,
      heading: pickFace(faces, 'heading'),
      body: pickFace(bodyPool, 'body')
    })
  }
  return candidates
}

/**
 * Trim the candidate set for breadth: round-robin across categories so the
 * suggestions are not dominated by the largest group (sans-serif).
 */
function selectPool(candidates: Candidate[], cap: number): Candidate[] {
  if (candidates.length <= cap) return candidates

  const buckets = new Map<FontCategory, Candidate[]>()
  for (const candidate of candidates) {
    const key = candidate.heading.category
    const bucket = buckets.get(key)
    if (bucket) bucket.push(candidate)
    else buckets.set(key, [candidate])
  }

  const lists = [...buckets.values()]
  const out: Candidate[] = []
  let index = 0
  while (out.length < cap) {
    let added = false
    for (const list of lists) {
      if (index < list.length) {
        out.push(list[index])
        added = true
        if (out.length >= cap) break
      }
    }
    if (!added) break
    index++
  }
  return out
}

/** Score one heading/body combination. Returns null when the pair is unusable. */
function scorePair(heading: FontRecord, body: FontRecord): PairSuggestion | null {
  const sameFamily = heading.familyId === body.familyId
  const weightGap = Math.abs(heading.weight - body.weight)

  // Reusing one family is only a real pairing when the weights differ enough to
  // read as two distinct roles.
  if (sameFamily && weightGap < 200) return null

  const reasons: string[] = []
  let score = 0

  const hc = heading.category
  const bc = body.category

  if (hc === bc) {
    score += 6
    reasons.push(`matched ${hc}`)
  } else if ((hc === 'serif' && bc === 'sans-serif') || (hc === 'sans-serif' && bc === 'serif')) {
    score += 30
    reasons.push('serif + sans contrast')
  } else if (hc === 'display' && (bc === 'sans-serif' || bc === 'serif')) {
    score += 26
    reasons.push('display heading, text body')
  } else if (bc === 'monospace') {
    score += 16
    reasons.push('monospace body')
  } else {
    score += 10
    reasons.push(`${hc} + ${bc}`)
  }

  if (weightGap >= 300) {
    score += 12
    reasons.push('strong weight contrast')
  } else if (weightGap >= 200) {
    score += 8
    reasons.push('weight contrast')
  } else if (weightGap >= 100) {
    score += 4
  }

  if (sameFamily) {
    score += 10
    reasons.push('superfamily')
  }

  // Measured x-height harmony, available only when both faces were parsed from a
  // file. Mismatched x-heights are the most visible pairing flaw, so they cost.
  const hx = heading.metrics?.xHeight
  const bx = body.metrics?.xHeight
  if (hx !== undefined && bx !== undefined) {
    const delta = Math.abs(hx - bx)
    if (delta <= 0.02) {
      score += 10
      reasons.push('matched x-height')
    } else if (delta <= 0.04) {
      score += 6
      reasons.push('close x-height')
    } else if (delta <= 0.06) {
      score += 2
    } else if (delta > 0.1) {
      score -= 6
      reasons.push('x-height mismatch')
    }
  }

  if (body.weight < 300) {
    score -= 6
    reasons.push('light body weight')
  }

  return { heading, body, score, reasons }
}

/** FNV-1a. Used only to vary pairs that score identically. */
function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

let memoFonts: FontRecord[] | null = null
let memoRanked: PairSuggestion[] | null = null

/**
 * Rank every viable pairing across a category-balanced sample of the library.
 * Memoised on the library reference so paging through suggestions is instant.
 */
export function rankPairs(fonts: FontRecord[]): PairSuggestion[] {
  if (memoRanked && fonts === memoFonts) return memoRanked

  const pool = selectPool(buildCandidates(fonts), POOL_SIZE)
  const scored: PairSuggestion[] = []

  for (const heading of pool) {
    for (const body of pool) {
      const suggestion = scorePair(heading.heading, body.body)
      if (suggestion) scored.push(suggestion)
    }
  }

  // Many pairs share a score, and sorting those alphabetically would lead every
  // list with the same handful of "A" families. A stable hash spreads them
  // deterministically instead — varied, but identical between launches.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      stableHash(`${a.heading.familyId}+${a.body.familyId}`) -
        stableHash(`${b.heading.familyId}+${b.body.familyId}`)
  )

  // Spread the list across families so the top of it is not one family repeated.
  const usage = new Map<string, number>()
  const ranked: PairSuggestion[] = []
  for (const suggestion of scored) {
    const hUsed = usage.get(suggestion.heading.familyId) ?? 0
    const bUsed = usage.get(suggestion.body.familyId) ?? 0
    if (hUsed >= MAX_FAMILY_USES || bUsed >= MAX_FAMILY_USES) continue

    usage.set(suggestion.heading.familyId, hUsed + 1)
    usage.set(suggestion.body.familyId, bUsed + 1)
    ranked.push(suggestion)

    if (ranked.length >= MAX_SUGGESTIONS) break
  }

  memoFonts = fonts
  memoRanked = ranked
  return ranked
}

/** Stable key for a heading/body combination, used to detect saved pairs. */
export function pairKey(headingId: string, bodyId: string): string {
  return `${headingId}::${bodyId}`
}

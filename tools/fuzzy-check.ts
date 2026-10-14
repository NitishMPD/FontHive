/**
 * Development check for typo-tolerant search.
 * Run via `pnpm check:fuzzy`.
 */
import type { FontRecord } from '../src/shared/types'
import { applyFilters, emptyFilters } from '../src/renderer/src/lib/filter'

function face(family: string, subfamily = 'Regular', weight = 400): FontRecord {
  return {
    id: `local:${family.toLowerCase()}-${weight}`,
    provider: 'local',
    family,
    subfamily,
    fullName: `${family} ${subfamily}`,
    postScriptName: `${family.replace(/\s+/g, '')}-${weight}`,
    format: 'ttf',
    weight,
    style: 'normal',
    category: 'sans-serif',
    axes: [],
    cached: true,
    active: false,
    familyId: `local:${family.toLowerCase()}`,
    collections: [],
    tags: [],
    addedAt: Date.now()
  }
}

const library: FontRecord[] = [
  face('Geist'),
  face('Geist', 'Bold', 700),
  face('Geist Mono'),
  face('Inter'),
  face('Roboto'),
  face('Georgia'),
  face('Consolas'),
  face('Playfair Display'),
  face('ABeeZee'),
  face('Space Grotesk')
]

function run(query: string): { families: string[]; fuzzy: boolean } {
  const result = applyFilters(library, { ...emptyFilters, query }, [])
  return {
    families: [...new Set(result.fonts.map((f) => f.family))],
    fuzzy: result.fuzzy
  }
}

const cases: { query: string; note: string }[] = [
  { query: 'Geist', note: 'exact' },
  { query: 'geist', note: 'exact, lowercase' },
  { query: 'Giest', note: 'TRANSPOSITION i/e' },
  { query: 'Geits', note: 'TRANSPOSITION t/s' },
  { query: 'Geistt', note: 'extra letter' },
  { query: 'Geis', note: 'prefix (already strict)' },
  { query: 'Giest Mono', note: 'typo + second term' },
  { query: 'Gorgia', note: 'typo in Georgia' },
  { query: 'Inter', note: 'exact, must NOT go fuzzy' },
  { query: 'Playfair', note: 'exact prefix' },
  { query: 'xyzzy', note: 'no match at all' },
  { query: 'abc', note: 'short term — fuzzy must stay off' },
  { query: 'Robto', note: 'typo in Roboto' },
  { query: 'Grostek', note: 'typo in Grotesk (Space Grotesk)' }
]

console.log('query            fuzzy  result')
console.log('-'.repeat(72))
for (const { query, note } of cases) {
  const { families, fuzzy } = run(query)
  const shown = families.length ? families.join(', ') : '(none)'
  console.log(`${query.padEnd(16)} ${String(fuzzy).padEnd(6)} ${shown}`)
  console.log(`${''.padEnd(16)}        ${note}`)
}

// Performance: fuzzy over a full-size library.
const big: FontRecord[] = []
for (let i = 0; i < 25000; i++) {
  big.push(face(`Family${i}`, 'Regular', 400))
}
big.push(face('Geist'))

const t0 = performance.now()
const miss = applyFilters(big, { ...emptyFilters, query: 'Giest' }, [])
const t1 = performance.now()
console.log(`\nperf: fuzzy over 25,001 faces -> ${miss.fonts.length} hit(s) in ${(t1 - t0).toFixed(1)} ms (fuzzy=${miss.fuzzy})`)

const t2 = performance.now()
applyFilters(big, { ...emptyFilters, query: 'Geist' }, [])
const t3 = performance.now()
console.log(`perf: strict over 25,001 faces -> ${(t3 - t2).toFixed(1)} ms`)

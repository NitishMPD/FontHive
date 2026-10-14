import { useMemo, useState } from 'react'
import type { FontPair, FontRecord } from '@shared/types'
import { useApp } from '../store'
import { rankPairs, type PairSuggestion } from '../lib/pairs'
import { ensureFontLoaded, variationSettings } from '../lib/fontface'
import Icon from './Icon'

const PAGE = 9

/** Body specimen copy — long enough to judge rhythm, not just a word. */
const BODY_SAMPLE =
  'Nearly all good typography depends on the relationship between the two faces rather than on either one alone.'

interface Resolved {
  key: string
  heading: FontRecord
  body: FontRecord
  score?: number
  reasons: string[]
  saved?: FontPair
}

function Specimen({ pair, onSwap, onSave, onRemove, onOpen }: {
  pair: Resolved
  onSwap: () => void
  onSave: () => void
  onRemove: () => void
  onOpen: (font: FontRecord) => void
}): React.JSX.Element {
  const settings = useApp((s) => s.settings)

  const headingFamily = ensureFontLoaded(pair.heading)
  const bodyFamily = ensureFontLoaded(pair.body)

  const headingText = settings.previewText?.trim() || 'The quick brown fox jumps over the lazy dog'
  const saved = Boolean(pair.saved)

  return (
    <article className="pair-card">
      <header className="pair-head">
        <div className="pair-roles">
          <button className="pair-role" onClick={() => onOpen(pair.heading)} title="Show in library">
            <span className="pair-role-tag">Heading</span>
            <span className="pair-role-name">{pair.heading.family}</span>
          </button>
          <span className="pair-plus">+</span>
          <button className="pair-role" onClick={() => onOpen(pair.body)} title="Show in library">
            <span className="pair-role-tag">Body</span>
            <span className="pair-role-name">{pair.body.family}</span>
          </button>
        </div>

        <div className="pair-actions">
          <button className="icon-btn" title="Swap heading and body" onClick={onSwap}>
            <Icon name="swap" size={14} />
          </button>
          {saved ? (
            <button className="btn sm" onClick={onRemove} title="Remove from saved pairs">
              <Icon name="check" size={13} /> Saved
            </button>
          ) : (
            <button className="btn sm primary" onClick={onSave} title="Save this pair">
              <Icon name="heart" size={13} /> Save
            </button>
          )}
        </div>
      </header>

      <div
        className="pair-heading-sample"
        style={{
          fontFamily: headingFamily,
          fontWeight: pair.heading.weight,
          fontStyle: pair.heading.style,
          fontVariationSettings: variationSettings(pair.heading, {})
        }}
      >
        {headingText}
      </div>

      <div
        className="pair-body-sample"
        style={{
          fontFamily: bodyFamily,
          fontWeight: pair.body.weight,
          fontStyle: pair.body.style,
          fontVariationSettings: variationSettings(pair.body, {})
        }}
      >
        {BODY_SAMPLE}
      </div>

      {(pair.reasons.length > 0 || typeof pair.score === 'number') && (
        <footer className="pair-reasons">
          {pair.reasons.slice(0, 3).map((reason) => (
            <span className="badge" key={reason}>
              {reason}
            </span>
          ))}
          {typeof pair.score === 'number' && (
            <span className="badge pair-score" title="Typographic compatibility score">
              {pair.score}
            </span>
          )}
        </footer>
      )}
    </article>
  )
}

export default function PairsView(): React.JSX.Element {
  const fonts = useApp((s) => s.fonts)
  const pairs = useApp((s) => s.pairs)
  const savePair = useApp((s) => s.savePair)
  const deletePair = useApp((s) => s.deletePair)
  const setFilters = useApp((s) => s.setFilters)
  const setView = useApp((s) => s.setView)

  const [tab, setTab] = useState<'suggested' | 'saved'>('suggested')
  const [limit, setLimit] = useState(PAGE)
  const [swapped, setSwapped] = useState<Record<string, boolean>>({})

  const byId = useMemo(() => new Map(fonts.map((f) => [f.id, f])), [fonts])

  // Deterministic and memoised, so paging through suggestions is instant.
  const ranked = useMemo<PairSuggestion[]>(() => (fonts.length ? rankPairs(fonts) : []), [fonts])

  const suggested = useMemo<Resolved[]>(() => {
    return ranked.slice(0, limit).map((suggestion) => {
      const key = `${suggestion.heading.id}::${suggestion.body.id}`
      const flip = swapped[key]
      const heading = flip ? suggestion.body : suggestion.heading
      const body = flip ? suggestion.heading : suggestion.body
      return {
        key,
        heading,
        body,
        score: suggestion.score,
        reasons: suggestion.reasons,
        saved: pairs.find((p) => p.headingId === heading.id && p.bodyId === body.id)
      }
    })
  }, [ranked, limit, swapped, pairs])

  const savedPairs = useMemo<Resolved[]>(() => {
    const out: Resolved[] = []
    for (const pair of pairs) {
      const heading = byId.get(pair.headingId)
      const body = byId.get(pair.bodyId)
      // A saved pairing outlives the font it referenced; skip it if either is gone.
      if (!heading || !body) continue
      out.push({
        key: pair.id,
        heading,
        body,
        reasons: pair.note ? [pair.note] : [],
        saved: pair
      })
    }
    return out
  }, [pairs, byId])

  const showFont = (font: FontRecord): void => {
    setFilters({ query: font.family, collectionId: null, providers: [] })
    setView({ kind: 'library' })
  }

  const card = (pair: Resolved): React.JSX.Element => (
    <Specimen
      key={pair.key}
      pair={pair}
      onSwap={() => setSwapped((prev) => ({ ...prev, [pair.key]: !prev[pair.key] }))}
      onOpen={showFont}
      onSave={() =>
        void savePair({
          id: `pair-${Date.now().toString(36)}`,
          name: `${pair.heading.family} + ${pair.body.family}`,
          headingId: pair.heading.id,
          bodyId: pair.body.id,
          createdAt: Date.now()
        })
      }
      onRemove={() => {
        if (pair.saved) void deletePair(pair.saved.id)
      }}
    />
  )

  const list = tab === 'suggested' ? suggested : savedPairs

  return (
    <div className="panel panel-wide">
      <h2>Font pairs</h2>
      <p className="sub">
        Heading and body combinations scored on the rules typographers use: role contrast,
        weight separation, and measured x-height harmony.
      </p>

      <div className="chip-row" style={{ marginBottom: 16 }}>
        <button className={`chip ${tab === 'suggested' ? 'on' : ''}`} onClick={() => setTab('suggested')}>
          <Icon name="sparkle" size={12} /> Suggested
          {ranked.length > 0 && <span className="chip-count">{ranked.length}</span>}
        </button>
        <button className={`chip ${tab === 'saved' ? 'on' : ''}`} onClick={() => setTab('saved')}>
          <Icon name="heart" size={12} /> Saved
          {savedPairs.length > 0 && <span className="chip-count">{savedPairs.length}</span>}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <Icon name="layers" size={30} />
          <h3 style={{ marginTop: 12 }}>
            {tab === 'saved' ? 'No saved pairs yet' : 'Nothing to pair yet'}
          </h3>
          <p>
            {tab === 'saved'
              ? 'Save a suggestion to keep it here.'
              : 'Index some fonts first — pairs are generated from your library.'}
          </p>
        </div>
      ) : (
        <>
          <div className="pair-grid">{list.map(card)}</div>

          {tab === 'suggested' && limit < ranked.length && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
              <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
                <Icon name="plus" size={14} /> Show more pairs
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

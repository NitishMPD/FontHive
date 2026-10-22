import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ProviderId } from '@shared/types'
import { useApp } from '../store'
import { applyFilters } from '../lib/filter'
import { FontCard } from './FontCard'
import Icon from './Icon'

const GAP = 12
const PAD = 16

export default function FontGrid(): React.JSX.Element {
  const fonts = useApp((s) => s.fonts)
  const collections = useApp((s) => s.collections)
  const filters = useApp((s) => s.filters)
  const settings = useApp((s) => s.settings)
  const selectedId = useApp((s) => s.selectedId)
  const selection = useApp((s) => s.selection)
  const refreshProvider = useApp((s) => s.refreshProvider)
  const providers = useApp((s) => s.providers)
  const setFilters = useApp((s) => s.setFilters)
  const view = useApp((s) => s.view)
  const busy = useApp((s) => s.busy)

  const scrollRef = useRef<HTMLDivElement>(null)
  const requestedPage = useRef('')
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  // Re-measure when the detail panel opens or closes.
  useEffect(() => {
    const el = scrollRef.current
    if (el) setWidth(el.clientWidth)
  }, [selectedId])

  const { fonts: visible } = useMemo(
    () => applyFilters(fonts, filters, collections),
    [fonts, filters, collections]
  )

  const columns = Math.max(1, settings.gridColumns)
  const usable = Math.max(0, width - PAD * 2 - GAP * (columns - 1))
  const cardWidth = usable > 0 ? Math.floor(usable / columns) : 0

  // Fixed chrome (head, alphabet sample, tags) plus one line of preview text.
  const cardHeight = 192 + Math.round(settings.previewSize * 1.25)
  const rowHeight = cardHeight + GAP

  const rowCount = Math.ceil(visible.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 2
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, cardWidth, virtualizer])

  const selectedSet = useMemo(() => new Set(selection), [selection])

  const source = filters.providers.length === 1
    ? providers.find((p) => p.id === filters.providers[0] && p.paged)
    : undefined
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !source?.hasMore || source.error || busy || view.kind !== 'library' || !visible.length ||
      filters.query.trim() !== (source.query ?? '')) return
    const loadNextPage = (): void => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight > rowHeight * 2) return
      const page = (source.page ?? 1) + 1
      const key = JSON.stringify([source.id, source.query ?? '', page])
      if (requestedPage.current === key) return
      requestedPage.current = key
      void refreshProvider(source.id, { query: source.query ?? '', page })
    }
    el.addEventListener('scroll', loadNextPage, { passive: true })
    loadNextPage()
    return () => el.removeEventListener('scroll', loadNextPage)
  }, [source, busy, view.kind, visible.length, filters.query, rowHeight, refreshProvider])

  if (visible.length === 0) {
    const isCollection = view.kind === 'collection'
    const activeProviderId = filters.providers.length === 1 ? filters.providers[0] : null
    const activeProvider = activeProviderId
      ? (providers.find((p) => p.id === activeProviderId) ?? null)
      : null

    // A catalogue is only genuinely missing when it holds no faces at all. An
    // empty grid beside a populated source is a search/filter problem, and
    // offering a fetch there sends the user to re-download a catalogue they
    // already have.
    const catalogueMissing = activeProvider !== null && activeProvider.count === 0

    const message = catalogueMissing
      ? 'This catalogue source has not been fetched yet.'
      : isCollection
        ? 'This collection has no matching fonts.'
        : fonts.length === 0
          ? 'No fonts indexed yet. Add a folder or fetch a catalogue source.'
          : 'No fonts match the current search and filters.'

    const hasActiveFilters = Boolean(
      filters.query ||
        filters.providers.length ||
        filters.categories.length ||
        filters.onlyActive ||
        filters.onlyInstalled ||
        filters.variableOnly ||
        filters.onlyFavorites ||
        filters.collectionId
    )

    return (
      <div className="empty">
        <Icon name="library" size={30} />
        <h3 style={{ marginTop: 12 }}>Nothing to show</h3>
        <p>{message}</p>

        {catalogueMissing && activeProviderId && (
          <button
            className="btn primary"
            onClick={() => void refreshProvider(activeProviderId as ProviderId)}
          >
            <Icon name="download" size={14} /> Fetch {activeProviderId} catalogue
          </button>
        )}

        {!catalogueMissing && hasActiveFilters && (
          <button
            className="btn"
            onClick={() =>
              setFilters({
                query: '',
                providers: [],
                categories: [],
                onlyActive: false,
                onlyInstalled: false,
                variableOnly: false,
                onlyFavorites: false,
                collectionId: null
              })
            }
          >
            <Icon name="close" size={14} /> Clear filters
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="grid-scroll" ref={scrollRef} style={{ height: '100%' }}>
      <div className="font-grid" style={{ height: virtualizer.getTotalSize() }}>
        {cardWidth > 0 &&
          virtualizer.getVirtualItems().map((virtualRow) => {
            const start = virtualRow.index * columns
            const rowFonts = visible.slice(start, start + columns)
            return rowFonts.map((font, columnIndex) => (
              <FontCard
                key={font.id}
                font={font}
                selected={font.id === selectedId}
                inSelection={selectedSet.has(font.id)}
                width={cardWidth}
                height={cardHeight}
                x={PAD + columnIndex * (cardWidth + GAP)}
                y={virtualRow.start + PAD}
                loadPreview={!virtualizer.isScrolling}
              />
            ))
          })}
      </div>
    </div>
  )
}

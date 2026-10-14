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
  const view = useApp((s) => s.view)

  const scrollRef = useRef<HTMLDivElement>(null)
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

  const visible = useMemo(
    () => applyFilters(fonts, filters, collections),
    [fonts, filters, collections]
  )

  const columns = Math.max(1, settings.gridColumns)
  const usable = Math.max(0, width - PAD * 2 - GAP * (columns - 1))
  const cardWidth = usable > 0 ? Math.floor(usable / columns) : 0

  // Fixed chrome (head, alphabet sample, tags) plus one line of preview text.
  const cardHeight = 212 + Math.round(settings.previewSize * 1.25)
  const rowHeight = cardHeight + GAP

  const rowCount = Math.ceil(visible.length / columns)

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  })

  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, cardWidth, virtualizer])

  const selectedSet = useMemo(() => new Set(selection), [selection])

  if (visible.length === 0) {
    const isCollection = view.kind === 'collection'
    const providerFiltered = filters.providers.length > 0
    return (
      <div className="empty">
        <Icon name="library" size={30} />
        <h3 style={{ marginTop: 12 }}>Nothing to show</h3>
        <p>
          {providerFiltered
            ? 'This catalogue source has not been fetched yet.'
            : isCollection
              ? 'This collection has no matching fonts.'
              : fonts.length === 0
                ? 'No fonts indexed yet. Add a folder or fetch a catalogue source.'
                : 'No fonts match the current search and filters.'}
        </p>
        {providerFiltered && (
          <button
            className="btn primary"
            onClick={() => void refreshProvider(filters.providers[0] as ProviderId)}
          >
            <Icon name="download" size={14} /> Fetch {filters.providers[0]} catalogue
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
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  transform: `translate(${PAD + columnIndex * (cardWidth + GAP)}px, ${
                    virtualRow.start + PAD
                  }px)`
                }}
              />
            ))
          })}
      </div>
    </div>
  )
}

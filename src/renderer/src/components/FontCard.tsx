import type { CSSProperties } from 'react'
import { memo } from 'react'
import type { FontRecord } from '@shared/types'
import { useApp } from '../store'
import { ensureFontLoaded, variationSettings } from '../lib/fontface'
import Icon from './Icon'

const ALPHABET = 'Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm Nn Oo Pp Qq Rr Ss Tt Uu Vv Ww Xx Yy Zz 0123456789'

const CATEGORY_LABEL: Record<string, string> = {
  'sans-serif': 'Sans Serif',
  serif: 'Serif',
  display: 'Display',
  monospace: 'Monospace',
  handwriting: 'Script',
  other: 'Other'
}

interface Props {
  font: FontRecord
  style: CSSProperties
  selected: boolean
  inSelection: boolean
}

function FontCardImpl({ font, style, selected, inSelection }: Props): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const axisValues = useApp((s) => s.axisValues[font.id])
  const toggleSelect = useApp((s) => s.toggleSelect)
  const toggleActive = useApp((s) => s.toggleActive)
  const updateFont = useApp((s) => s.updateFont)

  const family = ensureFontLoaded(font)

  const fontStyle: CSSProperties = {
    fontFamily: family,
    fontWeight: font.weight,
    fontStyle: font.style,
    fontVariationSettings: variationSettings(font, axisValues ?? {})
  }

  const handleClick = (event: React.MouseEvent): void => {
    toggleSelect(font.id, event.ctrlKey || event.metaKey || event.shiftKey)
  }

  const tags = [CATEGORY_LABEL[font.category], ...font.tags].filter(Boolean).slice(0, 4)

  return (
    <article
      className={`font-card ${selected || inSelection ? 'selected' : ''}`}
      style={style}
      onClick={handleClick}
      onDoubleClick={() => void toggleActive(font)}
      title={`${font.fullName}\n${font.provider} · ${font.category}${font.filePath ? '' : '\nNot downloaded'}`}
    >
      <div className="font-card-head">
        <div className="font-card-title">
          <span className="font-card-family">{font.family}</span>
        </div>
        <span className="font-card-meta">
          {font.subfamily}
          {font.axes.length > 0 && ' · Variable'}
        </span>
        <button
          className={`icon-btn heart ${font.favorite ? 'on' : ''}`}
          title={font.favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation()
            void updateFont(font.id, { favorite: !font.favorite })
          }}
        >
          <Icon name="heart" size={18} filled={font.favorite} />
        </button>
      </div>

      <div className="font-card-preview" style={{ ...fontStyle, fontSize: settings.previewSize }}>
        {settings.previewText || font.family}
      </div>

      <div className="font-card-alphabet" style={fontStyle}>
        {ALPHABET}
      </div>

      <div className="font-card-foot">
        <div className="font-card-tags">
          {tags.map((tag) => (
            <span className="pill" key={tag}>
              {tag}
            </span>
          ))}
          {!font.filePath && <span className="pill cloud">Cloud</span>}
        </div>
        <button
          className={`switch ${font.active ? 'on' : ''}`}
          role="switch"
          aria-checked={font.active}
          title={font.active ? 'Deactivate' : 'Activate'}
          onClick={(event) => {
            event.stopPropagation()
            void toggleActive(font)
          }}
        />
      </div>
    </article>
  )
}

export const FontCard = memo(FontCardImpl)

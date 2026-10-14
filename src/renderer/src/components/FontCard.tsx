import type { CSSProperties } from 'react'
import { memo } from 'react'
import type { FontRecord } from '@shared/types'
import { useApp } from '../store'
import { ensureFontLoaded, variationSettings } from '../lib/fontface'
import Icon from './Icon'

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

  const family = ensureFontLoaded(font)

  const previewStyle: CSSProperties = {
    fontFamily: family,
    fontSize: settings.previewSize,
    fontWeight: font.weight,
    fontStyle: font.style,
    fontVariationSettings: variationSettings(font, axisValues ?? {})
  }

  const handleClick = (event: React.MouseEvent): void => {
    toggleSelect(font.id, event.ctrlKey || event.metaKey || event.shiftKey)
  }

  const handleDoubleClick = (): void => {
    void toggleActive(font)
  }

  return (
    <article
      className={`font-card ${selected || inSelection ? 'selected' : ''}`}
      style={style}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={`${font.fullName}\n${font.provider} · ${font.category}${font.filePath ? '' : '\nNot downloaded'}`}
    >
      <div className="font-card-head">
        <span className="font-card-family">{font.family}</span>
        <span className="font-card-meta">{font.subfamily}</span>
      </div>

      <div className="font-card-preview" style={previewStyle}>
        {settings.previewText || 'The quick brown fox'}
      </div>

      <div className="font-card-foot">
        <span className={`dot ${font.provider}`} />
        {font.active && <span className="badge active">Active</span>}
        {!font.filePath && <span className="badge cloud">Cloud</span>}
        {font.axes.length > 0 && <span className="badge axes">Variable</span>}
        <span className="badge">{font.weight}</span>

        <div style={{ flex: 1 }} />

        <button
          className={`icon-btn ${font.active ? 'on' : ''}`}
          title={font.active ? 'Deactivate' : 'Activate'}
          onClick={(event) => {
            event.stopPropagation()
            void toggleActive(font)
          }}
        >
          <Icon name={font.active ? 'check' : 'plus'} size={14} />
        </button>
      </div>
    </article>
  )
}

export const FontCard = memo(FontCardImpl)

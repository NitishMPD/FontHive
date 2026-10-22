import { useMemo, useState } from 'react'
import type { FontRecord } from '@shared/types'
import { useApp } from '../store'
import { defaultAxisValues, ensureFontLoaded, variationSettings } from '../lib/fontface'
import Icon from './Icon'

export default function DetailPanel({ font, leaving }: { font: FontRecord; leaving: boolean }): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const collections = useApp((s) => s.collections)
  const axisValues = useApp((s) => s.axisValues[font.id])
  const setAxis = useApp((s) => s.setAxis)
  const resetAxes = useApp((s) => s.resetAxes)
  const toggleActive = useApp((s) => s.toggleActive)
  const updateFont = useApp((s) => s.updateFont)
  const download = useApp((s) => s.download)
  const select = useApp((s) => s.select)
  const busy = useApp((s) => s.busy)
  const fonts = useApp((s) => s.fonts)
  const installFamily = useApp((s) => s.installFamily)
  const familyFonts = useMemo(() => fonts.filter((face) => face.familyId === font.familyId), [fonts, font.familyId])
  const remaining = familyFonts.filter((face) => !face.active).length

  const [tagDraft, setTagDraft] = useState('')
  const [tab, setTab] = useState<'overview' | 'organize'>('overview')

  const family = ensureFontLoaded(font)
  const values = useMemo(
    () => axisValues ?? defaultAxisValues(font),
    [axisValues, font]
  )

  const previewStyle = {
    fontFamily: family,
    fontWeight: font.weight,
    fontStyle: font.style,
    fontVariationSettings: variationSettings(font, values)
  }

  const toggleCollection = (id: string): void => {
    const next = font.collections.includes(id)
      ? font.collections.filter((c) => c !== id)
      : [...font.collections, id]
    void updateFont(font.id, { collections: next })
  }

  const addTag = (): void => {
    const tag = tagDraft.trim()
    if (!tag || font.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    void updateFont(font.id, { tags: [...font.tags, tag] })
    setTagDraft('')
  }

  return (
    <aside className={`detail ${leaving ? 'leaving' : ''}`}>
      <div className="detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{font.family}</h2>
          <p>
            {font.subfamily} · {font.category} · {font.provider}
          </p>
        </div>
        <button className="icon-btn" onClick={() => select(null)} title="Close">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="detail-preview" style={previewStyle}>
        {font.packageOnly && font.previewImageUrl ? <img className="source-specimen" src={font.previewImageUrl} alt={`${font.family} specimen`} referrerPolicy="no-referrer" /> : settings.previewText || 'The quick brown fox jumps over the lazy dog'}
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'organize' ? 'on' : ''} onClick={() => setTab('organize')}>
          Organize
        </button>
      </div>

      {tab === 'overview' && (
        <>
      <div className="detail-section detail-actions">
        <button
          className={`btn lg ${font.active ? '' : 'primary'}`}
          disabled={Boolean(busy) || (font.active && !font.managedInstall)}
          onClick={() => void toggleActive(font)}
        >
          <Icon name={font.active ? 'close' : 'check'} size={15} />
          {font.active ? font.managedInstall ? 'Deactivate' : 'Installed' : 'Install'}
        </button>

        <div className="detail-actions-sub">
          {!font.filePath && (
            <button className="btn" disabled={Boolean(busy)} onClick={() => void download([font.id])}>
              <Icon name="download" size={14} /> Download
            </button>
          )}
          {font.filePath && (
            <button className="btn" onClick={() => void window.api.revealFont(font.id)}>
              <Icon name="folder" size={14} /> Show file
            </button>
          )}
          <button
            className="btn"
            title={font.packageOnly ? `Download and install every style in ${font.family}` : `Install all ${familyFonts.length} styles of ${font.family} from ${font.provider}`}
            disabled={Boolean(busy) || remaining === 0}
            onClick={() => void installFamily(font.familyId)}
          >
            <Icon name="check" size={14} />
            {font.packageOnly ? 'Install family' : remaining ? <>Family <span className="muted">· {remaining}</span></> : 'Family installed'}
          </button>
        </div>

        {!font.filePath && (
          <p className="muted" style={{ fontSize: 11.5, margin: '10px 0 0', lineHeight: 1.45 }}>
            {font.packageOnly ? 'Download to preview your own text and inspect the included styles. Install imports and installs every style in the package. Check the license before use.' : 'Catalogue entry. Download fetches an installable font file.'}
          </p>
        )}
      </div>

      {font.axes.length > 0 && (
        <div className="detail-section">
          <div className="row" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0, flex: 1 }}>Variable axes</h3>
            <button className="btn sm ghost" onClick={() => resetAxes(font.id)}>
              Reset
            </button>
          </div>

          {font.axes.map((axis) => (
            <div className="axis" key={axis.tag}>
              <div className="axis-head">
                <span>
                  {axis.name} <span className="tag">{axis.tag}</span>
                </span>
                <span className="mono">{Math.round(values[axis.tag] ?? axis.default)}</span>
              </div>
              <input
                type="range"
                min={axis.min}
                max={axis.max}
                step={(axis.max - axis.min) / 100 || 1}
                value={values[axis.tag] ?? axis.default}
                onChange={(event) => setAxis(font.id, axis.tag, Number(event.target.value))}
              />
            </div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <h3>Details</h3>
        <dl className="kv">
          <dt>Provider</dt>
          <dd>{font.provider}</dd>
          <dt>Weight</dt>
          <dd>{font.packageOnly ? 'Available after download' : font.weight}</dd>
          <dt>Style</dt>
          <dd>{font.packageOnly ? 'Available after download' : font.style}</dd>
          <dt>Format</dt>
          <dd>{font.packageOnly ? 'ZIP package' : font.format.toUpperCase()}</dd>
          <dt>PostScript</dt>
          <dd title={font.postScriptName}>{font.packageOnly ? 'Available after download' : font.postScriptName}</dd>
          {font.designer && (
            <>
              <dt>Designer</dt>
              <dd title={font.designer}>{font.designer}</dd>
            </>
          )}
          {font.license && (
            <>
              <dt>License</dt>
              <dd title={font.license}>{font.license}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{font.installationStatus === 'unknown' ? 'Installation status unavailable' : font.active ? font.managedInstall ? 'Installed by Font Hive' : 'Already installed on this PC' : font.filePath ? 'Downloaded' : 'Catalogue only'}</dd>
        </dl>
        {font.sourceUrl && <p className="muted source-attribution">Source: {font.sourceUrl}</p>}
        {font.licenseText && <details className="source-license"><summary>Bundled license and readme</summary><pre>{font.licenseText}</pre></details>}
      </div>

        </>
      )}

      {tab === 'organize' && (
        <>
      <div className="detail-section">
        <h3>Rating</h3>
        <div className="rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              className={`rating-star ${(font.rating ?? 0) >= value ? 'on' : ''}`}
              aria-label={`${value} star${value > 1 ? 's' : ''}`}
              title={font.rating === value ? 'Clear rating' : `${value} star${value > 1 ? 's' : ''}`}
              onClick={() => void updateFont(font.id, { rating: font.rating === value ? 0 : value })}
            >
              <Icon name="star" size={18} filled={(font.rating ?? 0) >= value} />
            </button>
          ))}
          <span className="muted rating-label">{font.rating ? `${font.rating} / 5` : 'Not rated'}</span>
        </div>
      </div>

      <div className="detail-section">
        <h3>Collections</h3>
        {collections.length === 0 ? (
          <p className="empty-hint">Create a collection from the sidebar to group fonts.</p>
        ) : (
          <div className="chip-row">
            {collections.map((collection) => (
              <button
                key={collection.id}
                className={`chip ${font.collections.includes(collection.id) ? 'on' : ''}`}
                onClick={() => toggleCollection(collection.id)}
              >
                {collection.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="detail-section">
        <h3>Tags</h3>
        <div className="tag-input">
          {font.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
              <button
                onClick={() =>
                  void updateFont(font.id, { tags: font.tags.filter((t) => t !== tag) })
                }
                title="Remove tag"
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          <input
            className="text-input"
            style={{ flex: 1, minWidth: 90, padding: '4px 8px' }}
            placeholder={font.tags.length ? 'Add tag…' : 'Add a tag and press Enter'}
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addTag()
              if (event.key === 'Escape') setTagDraft('')
            }}
          />
        </div>
      </div>

      <div className="detail-section">
        <h3>Note</h3>
        <textarea
          className="textarea"
          rows={3}
          placeholder="Notes about this face…"
          value={font.note ?? ''}
          onChange={(event) => void updateFont(font.id, { note: event.target.value })}
        />
      </div>
        </>
      )}
    </aside>
  )
}

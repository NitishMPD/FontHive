import { useApp } from '../store'
import Icon from './Icon'

export default function SettingsView(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const fonts = useApp((s) => s.fonts)
  const platform = useApp((s) => s.platform)

  const downloaded = fonts.filter((f) => f.filePath).length
  const active = fonts.filter((f) => f.active).length

  return (
    <div className="panel">
      <h2>Settings</h2>
      <p className="sub">Preview defaults, storage locations and library statistics.</p>

      <div className="card">
        <div className="card-head">
          <h3>Preview</h3>
        </div>

        <div className="stack">
          <label className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span>Preview text</span>
            <input
              className="text-input"
              value={settings.previewText}
              onChange={(event) => void saveSettings({ previewText: event.target.value })}
            />
          </label>

          <label className="field">
            <span style={{ width: 110 }}>Preview size</span>
            <input
              type="range"
              min={12}
              max={76}
              value={settings.previewSize}
              onChange={(event) => void saveSettings({ previewSize: Number(event.target.value) })}
            />
            <span className="mono">{settings.previewSize}px</span>
          </label>

          <label className="field">
            <span style={{ width: 110 }}>Grid columns</span>
            <input
              type="range"
              min={1}
              max={6}
              value={settings.gridColumns}
              onChange={(event) => void saveSettings({ gridColumns: Number(event.target.value) })}
            />
            <span className="mono">{settings.gridColumns}</span>
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Storage</h3>
        </div>
        <dl className="kv">
          <dt>Download cache</dt>
          <dd className="mono" title={settings.cacheDir}>
            {settings.cacheDir}
          </dd>
          <dt>App data</dt>
          <dd className="mono" title={settings.fontStoreDir}>
            {settings.fontStoreDir}
          </dd>
          <dt>Platform</dt>
          <dd>{platform}</dd>
        </dl>
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          On Windows, activation copies the file into your per-user font store and registers it under
          <span className="mono"> HKCU\...\CurrentVersion\Fonts</span>, then notifies running
          applications so the font appears without a reboot.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Library</h3>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="badge">{fonts.length.toLocaleString()} faces indexed</span>
          <span className="badge">{downloaded.toLocaleString()} files on disk</span>
          <span className="badge active">{active.toLocaleString()} active</span>
          <span className="badge axes">
            {fonts.filter((f) => f.axes.length > 0).length.toLocaleString()} variable
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>About</h3>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          A personal font manager built with Electron, React and fontkit. Catalogues come from the
          public Google Fonts, Bunny Fonts and Fontsource endpoints; fonts themselves stay on this
          machine.
        </p>
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          <Icon name="external" size={12} /> Press <span className="mono">Ctrl+F</span> to focus
          search, <span className="mono">Esc</span> to close the detail panel, and double-click any
          card to toggle activation.
        </p>
      </div>
    </div>
  )
}

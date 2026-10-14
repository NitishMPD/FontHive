import { useApp } from '../store'
import Icon from './Icon'

export default function FoldersView(): React.JSX.Element {
  const folders = useApp((s) => s.folders)
  const addFolder = useApp((s) => s.addFolder)
  const removeFolder = useApp((s) => s.removeFolder)
  const toggleFolder = useApp((s) => s.toggleFolder)
  const rescan = useApp((s) => s.rescan)
  const busy = useApp((s) => s.busy)
  const platform = useApp((s) => s.platform)

  const systemDirs =
    platform === 'win32'
      ? ['C:\\Windows\\Fonts', '%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts']
      : platform === 'darwin'
        ? ['/System/Library/Fonts', '/Library/Fonts', '~/Library/Fonts']
        : ['/usr/share/fonts', '~/.local/share/fonts']

  return (
    <div className="panel">
      <h2>Folders</h2>
      <p className="sub">
        Folders are scanned recursively for .ttf, .otf, .ttc, .woff and .woff2 files. Network shares
        and synced cloud folders work too.
      </p>

      <div className="card">
        <div className="card-head">
          <h3>Watched folders</h3>
          <button className="btn sm" onClick={() => void addFolder()} disabled={Boolean(busy)}>
            <Icon name="plus" size={13} /> Add folder
          </button>
          <button className="btn sm" onClick={() => void rescan()} disabled={Boolean(busy)}>
            <Icon name="refresh" size={13} /> Rescan
          </button>
        </div>

        {folders.length === 0 ? (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            No custom folders yet. System font directories are always scanned.
          </p>
        ) : (
          folders.map((folder) => (
            <div
              key={folder.path}
              className="row"
              style={{
                padding: '8px 0',
                borderTop: '1px solid var(--border-soft)'
              }}
            >
              <Icon name="folder" size={14} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folder.path}
                </div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {folder.fontCount.toLocaleString()} faces
                  {folder.lastScan ? ` · scanned ${new Date(folder.lastScan).toLocaleTimeString()}` : ''}
                </div>
              </div>
              <button
                className={`chip ${folder.enabled ? 'on' : ''}`}
                onClick={() => void toggleFolder(folder.path, !folder.enabled)}
              >
                {folder.enabled ? 'Enabled' : 'Disabled'}
              </button>
              <button
                className="icon-btn"
                title="Remove folder"
                onClick={() => void removeFolder(folder.path)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>System font directories</h3>
          <span className="badge">always scanned</span>
        </div>
        <dl className="kv">
          {systemDirs.map((dir) => (
            <div key={dir} style={{ display: 'contents' }}>
              <dt>
                <Icon name="folder" size={13} />
              </dt>
              <dd className="mono">{dir}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

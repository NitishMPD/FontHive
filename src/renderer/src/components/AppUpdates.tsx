import { useApp } from '../store'

export default function AppUpdates(): React.JSX.Element {
  const update = useApp((s) => s.appUpdate)
  const libraryBusy = useApp((s) => Boolean(s.busy || s.progress))
  const busy = !update || ['unsupported', 'checking', 'downloading', 'installing'].includes(update.status)
  const label = update?.status === 'available' ? 'Download update'
    : update?.status === 'downloaded' ? 'Restart and install'
    : update?.status === 'checking' ? 'Checking...'
    : update?.status === 'downloading' ? 'Downloading...'
    : update?.status === 'installing' ? 'Restarting...'
    : 'Check for updates'
  const description = update?.error ?? (
    update?.status === 'unsupported' ? 'Updates are available in the installed Windows x64 app.'
      : update?.status === 'up-to-date' ? "You're up to date."
      : update?.status === 'available' ? `Version ${update.availableVersion} is available. Download it while you keep working.`
      : update?.status === 'downloading' ? `Downloading version ${update.availableVersion}...`
      : update?.status === 'downloaded' ? `Version ${update.availableVersion} is ready. Restart when you're ready; your library will be saved.`
      : update?.status === 'installing' ? 'Saving your library and restarting Font Hive...'
      : update?.status === 'checking' ? 'Checking for updates...'
      : 'Font Hive checks on launch and every six hours. Downloads and restarts are up to you.'
  )

  const act = (): void => {
    const action = update?.status === 'downloaded' ? window.api.installUpdate
      : update?.status === 'available' ? window.api.downloadUpdate
      : window.api.checkForUpdates
    void action().catch((error) => useApp.getState().toast(String(error), 'error'))
  }

  return (
    <section className="card" aria-labelledby="app-updates-title">
      <div className="card-head">
        <h3 id="app-updates-title">App updates</h3>
        <button className="btn sm" disabled={busy || (update?.status === 'downloaded' && libraryBusy)} onClick={act}>
          {label}
        </button>
      </div>
      <p className="muted">Version {update?.currentVersion ?? '...'}</p>
      <p role="status" aria-live="polite">{description}</p>
      {update?.status === 'downloading' && (
        <div className="row">
          <div className="progress" role="progressbar" aria-label="Update download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(update.percent ?? 0)}>
            <div style={{ width: `${update.percent ?? 0}%` }} />
          </div>
          <span>{Math.round(update.percent ?? 0)}%</span>
        </div>
      )}
      {update?.status === 'downloaded' && libraryBusy && <p className="muted">Wait for library operations to finish before restarting.</p>}
      {update?.availableVersion && (
        <button className="btn ghost sm" onClick={() => {
          void window.api.openExternal(`https://github.com/NitishMPD/FontHive/releases/tag/v${encodeURIComponent(update.availableVersion!)}`)
            .catch((error) => useApp.getState().toast(String(error), 'error'))
        }}>Release notes</button>
      )}
    </section>
  )
}

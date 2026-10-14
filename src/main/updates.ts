import type { NsisUpdater } from 'electron-updater'
import type { AppUpdateState } from '@shared/types'

export function createUpdateController(
  currentVersion: string,
  updater: NsisUpdater | undefined,
  prepareInstall: () => Promise<void>,
  emit: (state: AppUpdateState) => void
) {
  let state: AppUpdateState = {
    revision: 0,
    status: updater ? 'idle' : 'unsupported',
    currentVersion,
    availableVersion: null,
    percent: null,
    error: null
  }
  let pending: Promise<void> | undefined

  const publish = (patch: Partial<AppUpdateState>): void => {
    state = { ...state, ...patch, revision: state.revision + 1 }
    emit({ ...state })
  }
  const fail = (error: unknown): void => {
    publish({ status: 'error', error: error instanceof Error ? error.message : String(error), percent: null })
  }
  const exclusive = (action: () => Promise<void>): Promise<void> => {
    if (pending) return pending
    pending = Promise.resolve().then(action).catch(fail).finally(() => { pending = undefined })
    return pending
  }

  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    updater.on('error', fail)
    updater.on('update-available', ({ version }) => publish({ status: 'available', availableVersion: version, error: null }))
    updater.on('update-not-available', () => publish({ status: 'up-to-date', availableVersion: null, error: null }))
    updater.on('download-progress', ({ percent }) => {
      if (state.status === 'downloading' && Number.isFinite(percent)) {
        publish({ percent: Math.max(0, Math.min(100, percent)) })
      }
    })
    updater.on('update-downloaded', ({ version }) => {
      publish({ status: 'downloaded', availableVersion: version, percent: 100, error: null })
    })
  }

  return {
    getState: (): AppUpdateState => ({ ...state }),
    check(): Promise<void> {
      if (!updater || ['downloading', 'downloaded', 'installing'].includes(state.status)) return Promise.resolve()
      return exclusive(async () => {
        publish({ status: 'checking', error: null, percent: null })
        if (!await updater.checkForUpdates()) throw new Error('The update service did not return release metadata. Try again later.')
      })
    },
    download(): Promise<void> {
      if (!updater || state.status !== 'available') return Promise.resolve()
      return exclusive(async () => {
        publish({ status: 'downloading', percent: 0, error: null })
        await updater.downloadUpdate()
        if (state.status !== 'downloaded' && state.status !== 'error') {
          throw new Error('The update download did not finish. Check for updates and try again.')
        }
      })
    },
    install(): Promise<void> {
      if (!updater || state.status !== 'downloaded') return Promise.resolve()
      return exclusive(async () => {
        publish({ status: 'installing', error: null })
        try {
          await prepareInstall()
        } catch (error) {
          publish({ status: 'downloaded', error: error instanceof Error ? error.message : String(error) })
          return
        }
        updater.quitAndInstall(true, true)
      })
    }
  }
}

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { NsisUpdater } from 'electron-updater'
import { createUpdateController } from '../src/main/updates'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  allowDowngrade = true
  disableWebInstaller = false
  checks = 0
  downloads = 0
  installs = 0
  hasUpdate = true
  completesDownload = true
  checkError: Error | null = null
  beforeInstall = (): void => {}
  async checkForUpdates() {
    this.checks++
    if (this.checkError) throw this.checkError
    this.emit(this.hasUpdate ? 'update-available' : 'update-not-available', { version: '0.1.2' })
    return { isUpdateAvailable: this.hasUpdate, updateInfo: { version: '0.1.2' } }
  }
  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 130 })
    this.emit('download-progress', { percent: NaN })
    if (this.completesDownload) this.emit('update-downloaded', { version: '0.1.2' })
    return ['installer.exe']
  }
  quitAndInstall(silent: boolean, restart: boolean) {
    this.beforeInstall()
    assert.equal(silent, true)
    assert.equal(restart, true)
    this.installs++
  }
}

async function check(): Promise<void> {
  const fake = new FakeUpdater()
  let saved = 0
  let blocked = false
  const revisions: number[] = []
  const percentages: (number | null)[] = []
  const updates = createUpdateController('0.1.1', fake as unknown as NsisUpdater, async () => {
    if (blocked) throw new Error('Library is busy')
    await Promise.resolve()
    saved++
  }, (state) => {
    revisions.push(state.revision)
    percentages.push(state.percent)
  })
  fake.beforeInstall = () => assert.equal(saved, 1, 'Persistence must finish before the installer starts')
  assert.equal(fake.autoDownload, false)
  assert.equal(fake.autoInstallOnAppQuit, false)
  assert.equal(fake.allowPrerelease, false)
  assert.equal(fake.allowDowngrade, false)
  assert.equal(fake.disableWebInstaller, true)
  await updates.install()
  await updates.download()
  assert.equal(fake.installs + fake.downloads, 0, 'Cannot install or download before an update is found')
  await Promise.all([updates.check(), updates.check()])
  assert.equal(fake.checks, 1, 'Concurrent checks share one request')
  assert.equal(updates.getState().status, 'available')
  assert.equal(fake.downloads, 0, 'Finding an update does not download it without user action')
  await Promise.all([updates.download(), updates.download()])
  assert.equal(fake.downloads, 1)
  assert.equal(updates.getState().status, 'downloaded')
  assert(percentages.includes(100))
  assert(percentages.every((percent) => percent === null || (Number.isFinite(percent) && percent >= 0 && percent <= 100)))
  await updates.check()
  assert.equal(fake.checks, 1, 'Checking cannot discard a downloaded update')
  blocked = true
  await updates.install()
  assert.equal(updates.getState().status, 'downloaded')
  assert.equal(updates.getState().error, 'Library is busy')
  assert.equal(fake.installs, 0, 'Failed preparation cannot restart the app')
  blocked = false
  await Promise.all([updates.install(), updates.install()])
  assert.equal(saved, 1, 'Save before restarting, once')
  assert.equal(fake.installs, 1)
  assert.equal(updates.getState().status, 'installing')
  assert(revisions.every((revision, i) => i === 0 || revision > revisions[i - 1]))

  const retryFake = new FakeUpdater()
  retryFake.checkError = new Error('Network unavailable')
  const retry = createUpdateController('0.1.1', retryFake as unknown as NsisUpdater, async () => {}, () => {})
  await retry.check()
  assert.equal(retry.getState().status, 'error')
  retryFake.checkError = null
  retryFake.hasUpdate = false
  await retry.check()
  assert.equal(retry.getState().status, 'up-to-date')
  assert.equal(retry.getState().error, null)
  retryFake.hasUpdate = true
  retryFake.completesDownload = false
  await retry.check()
  await retry.download()
  assert.equal(retry.getState().status, 'error', 'An incomplete download cannot become installable')
  await retry.install()
  assert.equal(retryFake.installs, 0)
  retryFake.completesDownload = true
  await retry.check()
  await retry.download()
  assert.equal(retry.getState().status, 'downloaded')
  retryFake.emit('error', new Error('Installer failed'))
  assert.equal(retry.getState().status, 'error', 'Updater errors reach the UI without crashing')

  const unsupported = createUpdateController('0.1.0', undefined, async () => { throw new Error('Must not install') }, () => {})
  await unsupported.check()
  await unsupported.download()
  await unsupported.install()
  assert.equal(unsupported.getState().status, 'unsupported')
  console.log('Update lifecycle, concurrency, retry, download, save/restart safety, and development-mode checks passed')
}

void check().catch((error) => { console.error(error); process.exitCode = 1 })

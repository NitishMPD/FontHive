import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { FontRecord } from '@shared/types'

const execFileAsync = promisify(execFile)

const WIN_FONT_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'

/** fontId -> absolute path of the file we installed into the OS font store. */
type ActivatedMap = Record<string, string>

function userFontDir(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, 'Microsoft', 'Windows', 'Fonts')
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Fonts')
  return path.join(os.homedir(), '.local', 'share', 'fonts')
}

/** Windows registry value suffix, which must match the font's declared type. */
function registrySuffix(font: FontRecord): string {
  return font.format === 'otf' ? '(OpenType)' : '(TrueType)'
}

function registryValueName(font: FontRecord): string {
  return `${font.fullName} ${registrySuffix(font)}`
}

function safeFileName(font: FontRecord): string {
  const ext = path.extname(font.filePath || '') || `.${font.format}`
  const base = font.postScriptName.replace(/[^A-Za-z0-9._-]/g, '_')
  return `${base}${ext}`
}

/* ------------------------------------------------------------------ *
 * Native notification: tell running applications the font set changed.
 * Loaded lazily so a missing/failed koffi never breaks activation.
 * ------------------------------------------------------------------ */

interface NativeNotify {
  announce(paths: string[]): Promise<void>
  retract(paths: string[]): Promise<void>
}

let nativeNotify: NativeNotify | null | undefined

async function loadNativeNotify(): Promise<NativeNotify | null> {
  if (nativeNotify !== undefined) return nativeNotify
  if (process.platform !== 'win32') {
    nativeNotify = null
    return null
  }

  try {
    const mod = await import('koffi')
    // koffi is CJS; under a bundled CJS build the namespace may carry a default.
    const k = ((mod as unknown as { default?: unknown }).default ?? mod) as typeof mod

    const gdi32 = k.load('gdi32.dll')
    const user32 = k.load('user32.dll')

    const AddFontResourceW = gdi32.func('__stdcall', 'AddFontResourceW', 'int', ['str16'])
    const RemoveFontResourceW = gdi32.func('__stdcall', 'RemoveFontResourceW', 'int', ['str16'])
    const SendMessageTimeoutW = user32.func('__stdcall', 'SendMessageTimeoutW', 'intptr_t', [
      'uintptr_t', // hWnd (HWND_BROADCAST = 0xFFFF)
      'uint', // Msg (WM_FONTCHANGE = 0x001D)
      'uintptr_t',
      'intptr_t',
      'uint', // fuFlags (SMTO_ABORTIFHUNG = 0x0002)
      'uint', // uTimeout
      'void *'
    ])

    const HWND_BROADCAST = 0xffff
    const WM_FONTCHANGE = 0x001d
    const SMTO_ABORTIFHUNG = 0x0002

    const broadcast = (): void => {
      SendMessageTimeoutW(HWND_BROADCAST, WM_FONTCHANGE, 0, 0, SMTO_ABORTIFHUNG, 1000, null)
    }

    nativeNotify = {
      async announce(paths) {
        for (const p of paths) AddFontResourceW(p)
        broadcast()
      },
      async retract(paths) {
        for (const p of paths) RemoveFontResourceW(p)
        broadcast()
      }
    }
  } catch {
    // Registry + file install still activates the font for the next session.
    nativeNotify = null
  }
  return nativeNotify
}

/* ------------------------------------------------------------------ *
 * Registry access (Windows only)
 * ------------------------------------------------------------------ */

export async function listRegisteredFontPaths(): Promise<Set<string>> {
  const out = new Set<string>()
  if (process.platform !== 'win32') return out
  try {
    const { stdout } = await execFileAsync('reg', ['query', WIN_FONT_KEY], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    })
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/REG_SZ\s+(.+)$/)
      if (match) out.add(path.normalize(match[1].trim()).toLowerCase())
    }
  } catch {
    /* key absent means nothing registered by us yet */
  }
  return out
}

async function addRegistryEntry(font: FontRecord, installedPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  await execFileAsync(
    'reg',
    [
      'add',
      WIN_FONT_KEY,
      '/v',
      registryValueName(font),
      '/t',
      'REG_SZ',
      '/d',
      installedPath,
      '/f'
    ],
    { windowsHide: true }
  )
}

async function removeRegistryEntry(font: FontRecord): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    await execFileAsync('reg', ['delete', WIN_FONT_KEY, '/v', registryValueName(font), '/f'], {
      windowsHide: true
    })
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ *
 * Activation bookkeeping
 * ------------------------------------------------------------------ */

function activatedFile(): string {
  return path.join(app.getPath('userData'), 'activated.json')
}

export class Activator {
  private map: ActivatedMap = {}
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(map: ActivatedMap) {
    this.map = map
  }

  static async open(): Promise<Activator> {
    let map: ActivatedMap = {}
    try {
      map = JSON.parse(await fs.readFile(activatedFile(), 'utf8')) as ActivatedMap
    } catch {
      map = {}
    }
    const activator = new Activator(map)
    await activator.reconcile()
    return activator
  }

  /** Drop entries whose installed file vanished or was unregistered externally. */
  private async reconcile(): Promise<void> {
    const registered = await listRegisteredFontPaths()
    let changed = false
    for (const [id, installed] of Object.entries(this.map)) {
      const normalized = path.normalize(installed).toLowerCase()
      let exists = true
      try {
        await fs.access(installed)
      } catch {
        exists = false
      }
      if (!exists || (process.platform === 'win32' && !registered.has(normalized))) {
        delete this.map[id]
        changed = true
      }
    }
    if (changed) await this.persist()
  }

  isActive(id: string): boolean {
    return Boolean(this.map[id])
  }

  activeIds(): Set<string> {
    return new Set(Object.keys(this.map))
  }

  private async persist(): Promise<void> {
    const tmp = `${activatedFile()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.map, null, 2), 'utf8')
    await fs.rename(tmp, activatedFile())
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  activate(font: FontRecord): Promise<void> {
    return this.serial(async () => {
      if (this.map[font.id]) return
      if (!font.filePath) throw new Error('Font file is not available locally')

      const dir = userFontDir()
      await fs.mkdir(dir, { recursive: true })
      const installed = path.join(dir, safeFileName(font))

      if (path.normalize(font.filePath).toLowerCase() !== path.normalize(installed).toLowerCase()) {
        await fs.copyFile(font.filePath, installed)
      }

      await addRegistryEntry(font, installed)
      this.map[font.id] = installed
      await this.persist()

      const notify = await loadNativeNotify()
      await notify?.announce([installed])
      if (process.platform === 'linux') {
        // Fontconfig needs a cache rebuild before the font is visible.
        try {
          await execFileAsync('fc-cache', ['-f'], { windowsHide: true })
        } catch {
          /* fontconfig may be absent */
        }
      }
    })
  }

  deactivate(font: FontRecord): Promise<void> {
    return this.serial(async () => {
      const installed = this.map[font.id]
      if (!installed) return

      const notify = await loadNativeNotify()
      await notify?.retract([installed])

      await removeRegistryEntry(font)
      try {
        await fs.unlink(installed)
      } catch {
        /* already removed */
      }

      delete this.map[font.id]
      await this.persist()
    })
  }
}

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FontRecord, Progress, ProviderId } from '@shared/types'
import { FONT_EXTENSIONS, formatOf, parseFontFile } from './metadata'

const SKIP_DIRS = new Set([
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '.git',
  'windowsapps'
])

export function makeId(provider: ProviderId, postScriptName: string): string {
  return `${provider}:${postScriptName.toLowerCase()}`
}

export function makeFamilyId(provider: ProviderId, family: string): string {
  return `${provider}:${family.toLowerCase()}`
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onTick?: (done: number) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let done = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
      done++
      onTick?.(done)
      // Yield so IPC and window events stay responsive during large scans.
      await new Promise((resolve) => setImmediate(resolve))
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Recursively collect font files. Symlinked directories are not followed, which
 * keeps a Windows font share full of junctions from recursing forever.
 */
export async function collectFontFiles(
  root: string,
  maxDepth = 8
): Promise<{ files: string[]; errors: string[] }> {
  const files: string[] = []
  const errors: string[] = []
  const seen = new Set<string>()

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let real: string
    try {
      real = await fs.realpath(dir)
    } catch {
      real = dir
    }
    if (seen.has(real.toLowerCase())) return
    seen.add(real.toLowerCase())

    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      errors.push(`${dir}: ${(err as Error).message}`)
      return
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        if (entry.name.startsWith('.')) continue
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (FONT_EXTENSIONS.has(ext)) files.push(full)
      }
    }
  }

  await walk(root, 0)
  return { files, errors }
}

export interface ScanOptions {
  provider: ProviderId
  onProgress?: (progress: Progress) => void
  /** Faces already known from providers, used to enrich local files. */
  concurrency?: number
}

/**
 * Scan a directory tree into library records. The same physical file may be
 * referenced by several faces (a .ttc collection), so records are keyed by
 * PostScript name rather than by path.
 */
export async function scanFolder(
  root: string,
  options: ScanOptions
): Promise<{ fonts: FontRecord[]; errors: string[] }> {
  const errors: string[] = []
  const { files, errors: walkErrors } = await collectFontFiles(root)
  errors.push(...walkErrors)

  const total = files.length
  const { provider, concurrency = 6 } = options

  let reported = 0
  const parsed = await mapLimit(
    files,
    concurrency,
    async (file) => ({ file, faces: await parseFontFile(file) }),
    (done) => {
      // Report at most ~100 updates so the UI is not flooded on huge scans.
      if (done - reported >= Math.max(1, Math.floor(total / 100))) {
        reported = done
        options.onProgress?.({
          phase: 'scan',
          completed: done,
          total,
          message: `Reading ${done} / ${total} font files`
        })
      }
    }
  )

  const fonts: FontRecord[] = []
  for (const { file, faces } of parsed) {
    if (faces.length === 0) {
      errors.push(`Unreadable font: ${file}`)
      continue
    }
    const format = formatOf(file)
    for (const face of faces) {
      fonts.push({
        id: makeId(provider, face.postScriptName),
        provider,
        family: face.family,
        subfamily: face.subfamily,
        fullName: face.fullName,
        postScriptName: face.postScriptName,
        format,
        weight: face.weight,
        style: face.style,
        category: face.category,
        axes: face.axes,
        filePath: file,
        cached: true,
        active: false,
        familyId: makeFamilyId(provider, face.family),
        version: face.version,
        license: face.license,
        designer: face.designer,
        copyright: face.copyright,
        collections: [],
        tags: [],
        addedAt: Date.now()
      })
    }
  }

  return { fonts, errors }
}

/** Standard system font locations for the current platform. */
export async function systemFontDirs(): Promise<string[]> {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const dirs: string[] = []
  if (process.platform === 'win32') {
    dirs.push('C:\\Windows\\Fonts')
    if (home) dirs.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts'))
  } else if (process.platform === 'darwin') {
    dirs.push('/System/Library/Fonts', '/Library/Fonts')
    if (home) dirs.push(path.join(home, 'Library', 'Fonts'))
  } else {
    dirs.push('/usr/share/fonts', '/usr/local/share/fonts')
    if (home) dirs.push(path.join(home, '.local', 'share', 'fonts'), path.join(home, '.fonts'))
  }

  const existing: string[] = []
  for (const dir of dirs) {
    try {
      await fs.access(dir)
      existing.push(dir)
    } catch {
      /* not present on this host */
    }
  }
  return existing
}

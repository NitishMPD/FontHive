/**
 * Development check: exercises the provider catalogue code and the native
 * activation binding without installing anything into the system font store.
 * Run via `pnpm check:providers`.
 */
import { googleProvider } from '../src/main/providers/google'
import { bunnyProvider } from '../src/main/providers/bunny'
import { fontsourceProvider } from '../src/main/providers/fontsource'
import { catalogToRecords } from '../src/main/providers'
import type { Provider } from '../src/main/providers/types'

async function checkProvider(provider: Provider): Promise<void> {
  const started = Date.now()
  try {
    const faces = await provider.fetchCatalog()
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const families = new Set(faces.map((f) => f.family))
    console.log(
      `\n[${provider.id}] ${faces.length} faces across ${families.size} families in ${elapsed}s`
    )
    // Prefer a variable family so axis recovery is exercised too.
    const sample =
      faces.find((f) => /^inter$/i.test(f.family) && f.weight === 400) ??
      faces.find((f) => f.axes.length > 0) ??
      faces[0]
    console.log(`  sample: ${sample.family} / ${sample.subfamily} (${sample.weight} ${sample.style})`)
    console.log(`  previewUrl: ${sample.previewUrl ?? sample.previewFileUrl ?? '(none)'}`)

    const records = catalogToRecords(provider.id, [sample])
    const record = records[0]
    const target = await provider.resolveDownload(record)
    console.log(`  resolveDownload -> ${target.format} ${target.url}`)

    // Confirm the resolved file is actually downloadable and non-trivial.
    const res = await fetch(target.url, { method: 'GET' })
    const buffer = Buffer.from(await res.arrayBuffer())
    console.log(`  fetched ${res.status}, ${buffer.byteLength.toLocaleString()} bytes`)

    // The critical check: an installable file must parse and expose real metadata.
    const fontkit = require('fontkit')
    const parsed = fontkit.create(buffer)
    const axes = Object.keys(parsed.variationAxes ?? {})
    console.log(`  parsed family: ${parsed.familyName} / ${parsed.subfamilyName}`)
    console.log(`  weight class: ${parsed['OS/2']?.usWeightClass} | variable axes: ${axes.join(',') || 'none'}`)
    console.log(`  installable: ${buffer.byteLength > 1000 ? 'yes' : 'NO — too small'}`)
  } catch (err) {
    console.log(`\n[${provider.id}] FAILED: ${(err as Error).message}`)
  }
}

async function checkNativeBinding(): Promise<void> {
  console.log('\n== native activation binding ==')
  try {
    const koffi = require('koffi')
    const gdi32 = koffi.load('gdi32.dll')
    const user32 = koffi.load('user32.dll')
    const AddFontResourceW = gdi32.func('__stdcall', 'AddFontResourceW', 'int', ['str16'])
    const RemoveFontResourceW = gdi32.func('__stdcall', 'RemoveFontResourceW', 'int', ['str16'])
    const SendMessageTimeoutW = user32.func('__stdcall', 'SendMessageTimeoutW', 'intptr_t', [
      'uintptr_t',
      'uint',
      'uintptr_t',
      'intptr_t',
      'uint',
      'uint',
      'void *'
    ])
    console.log('  gdi32.AddFontResourceW      bound:', typeof AddFontResourceW === 'function')
    console.log('  gdi32.RemoveFontResourceW   bound:', typeof RemoveFontResourceW === 'function')
    console.log('  user32.SendMessageTimeoutW  bound:', typeof SendMessageTimeoutW === 'function')
    console.log('  (functions bound but not invoked — no font was installed)')
  } catch (err) {
    console.log('  FAILED:', (err as Error).message)
  }
}

async function main(): Promise<void> {
  await checkProvider(googleProvider)
  await checkProvider(bunnyProvider)
  await checkProvider(fontsourceProvider)
  await checkNativeBinding()
}

main().catch((err) => {
  console.error('check failed:', err)
  process.exit(1)
})

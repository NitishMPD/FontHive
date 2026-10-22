const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Exercise Tauri's actual key decoding and password handling before compilation.
// Never print the key, password, signer output, or generated signature.
function checkSigning(env = process.env) {
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    throw new Error('Missing TAURI_SIGNING_PRIVATE_KEY. Set the GitHub Actions secret to the complete contents of .keys/tauri-updater.key.')
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'font-hive-signing-'))
  try {
    const file = path.join(directory, 'probe.txt')
    fs.writeFileSync(file, 'Font Hive release signing check\n')
    const key = env.TAURI_SIGNING_PRIVATE_KEY
    // Build accepts a path or contents; signer sign's environment input accepts
    // contents only. Preserve both forms for local use without logging either.
    const privateKey = fs.existsSync(key) ? fs.readFileSync(key, 'utf8') : key
    const result = spawnSync(process.execPath, [
      require.resolve('@tauri-apps/cli/tauri.js'), 'signer', 'sign', file
    ], {
      env: {
        ...env,
        TAURI_SIGNING_PRIVATE_KEY: privateKey,
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ''
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000
    })
    if (result.error || result.status !== 0 || !fs.existsSync(`${file}.sig`)) {
      throw new Error('Updater signing check failed. Replace the GitHub Actions secret TAURI_SIGNING_PRIVATE_KEY with the complete, unchanged contents of .keys/tauri-updater.key (not its path, public key, or a PowerShell command). Preserve base64 padding and do not add quotes or encode it again. For an encrypted key, also check TAURI_SIGNING_PRIVATE_KEY_PASSWORD. Keep the existing key pair; do not generate a replacement.')
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    checkSigning()
    console.log('Tauri updater signing check passed')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { checkSigning }

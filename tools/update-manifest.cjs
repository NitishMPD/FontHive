const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function manifest(version, filename, signature, notes = '') {
  assert(/^\d+\.\d+\.\d+$/.test(version), 'A stable release version is required')
  assert(filename.endsWith('-setup.exe'), 'Expected a Tauri NSIS installer')
  assert(signature.trim(), 'Missing updater signature')
  return {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/NitishMPD/FontHive/releases/download/v${version}/${encodeURIComponent(filename)}`
      }
    }
  }
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const result = manifest('0.1.2', 'Font Hive_0.1.2_x64-setup.exe', 'signature\n')
    assert.equal(result.platforms['windows-x86_64'].signature, 'signature')
    assert(result.platforms['windows-x86_64'].url.endsWith('/Font%20Hive_0.1.2_x64-setup.exe'))
    assert.throws(() => manifest('0.1.2-beta', 'app-setup.exe', 'signature'))
    assert.throws(() => manifest('0.1.2', 'app-setup.exe', ''))
    assert.throws(() => manifest('0.1.2', 'electron.exe', 'signature'))
    console.log('Tauri update manifest checks passed')
  } else {
    const directory = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis'
    const installers = fs.readdirSync(directory).filter((name) => name.endsWith('-setup.exe'))
    assert.equal(installers.length, 1, 'Expected exactly one Tauri installer')
    const filename = installers[0]
    const signature = fs.readFileSync(path.join(directory, `${filename}.sig`), 'utf8')
    const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
    const notes = process.env.RELEASE_NOTES || 'Font Hive update. See the GitHub release for full notes.'
    fs.writeFileSync(path.join(directory, 'tauri-latest.json'), JSON.stringify(manifest(version, filename, signature, notes), null, 2) + '\n')
  }
}

module.exports = { manifest }

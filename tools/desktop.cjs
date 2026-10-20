const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { homedir } = require('node:os')
const path = require('node:path')

// GUI-hosted terminals can retain the PATH from before rustup was installed.
// Resolve Rust for this command and its children without changing system PATH.
const env = { ...process.env }
// The initial local updater key has an empty password. Passing it explicitly
// avoids an interactive prompt; encrypted keys can override this environment var.
if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
}
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH'
const candidates = [
  process.env.CARGO_HOME && path.join(process.env.CARGO_HOME, 'bin'),
  path.join(homedir(), '.cargo', 'bin')
].filter(Boolean)
env[pathKey] = [env[pathKey] || '', ...candidates.filter(existsSync)].join(path.delimiter)

const [tool, ...args] = process.argv.slice(2)
if (!['tauri', 'cargo'].includes(tool)) {
  console.error('Usage: node tools/desktop.cjs <tauri|cargo> [arguments]')
  process.exit(1)
}
const command = tool === 'tauri' ? process.execPath : 'cargo'
const commandArgs = tool === 'tauri'
  ? [require.resolve('@tauri-apps/cli/tauri.js'), ...args]
  : args
const result = spawnSync(command, commandArgs, { env, stdio: 'inherit', windowsHide: true })
if (result.error) {
  console.error(result.error.code === 'ENOENT'
    ? 'Cargo was not found. Install Rust with rustup, then reopen your terminal.'
    : result.error.message)
}
process.exit(result.status ?? 1)

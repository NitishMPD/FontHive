const assert = require('node:assert/strict')
const fs = require('node:fs')

function releaseVersion(base, runNumber) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base)
  assert(match, 'package.json version must be a stable major.minor.patch version')
  assert(/^[1-9]\d*$/.test(runNumber), 'GITHUB_RUN_NUMBER must be a positive integer')
  const patch = Number(match[3]) + Number(runNumber)
  assert(Number.isSafeInteger(patch), 'Release patch version is too large')
  return `${match[1]}.${match[2]}.${patch}`
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    assert.equal(releaseVersion('0.1.0', '1'), '0.1.1')
    assert.equal(releaseVersion('0.1.0', '2'), '0.1.2')
    assert.equal(releaseVersion('1.2.3', '10'), '1.2.13')
    assert.throws(() => releaseVersion('0.1.0-beta', '1'))
    assert.throws(() => releaseVersion('0.1.0', '0'))
    assert.throws(() => releaseVersion('0.1.0', 'invalid'))
    console.log('Automatic release version checks passed')
  } else {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    pkg.version = releaseVersion(pkg.version, process.env.GITHUB_RUN_NUMBER)
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
    console.log(`Release version: ${pkg.version}`)
  }
}

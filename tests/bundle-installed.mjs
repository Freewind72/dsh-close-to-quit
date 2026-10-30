// Resolve the installed bundle the way the loader will, and report whether every file it
// needs is actually present. Run from the profile directory.
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire('C:/Users/Zeph/.dsh/profiles/desktop/package.json')

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

let pkgPath
try {
  pkgPath = require.resolve('dsh-close-to-quit/package.json')
} catch (error) {
  console.log(`FAIL  cannot resolve dsh-close-to-quit: ${error.message}`)
  process.exit(1)
}
const root = dirname(pkgPath)
console.log(`bundle root = ${root}\n`)
check('bundle root exists', existsSync(root))

const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
console.log(`manifest: ${manifest.name}@${manifest.version}`)
console.log(`  dsh.bundle.patch = ${manifest.dsh?.bundle?.patch}`)
console.log(`  dsh.client       = ${JSON.stringify(manifest.dsh?.client)}\n`)

const patchRel = manifest.dsh?.bundle?.patch
check('manifest declares a bundle patch', typeof patchRel === 'string')
if (typeof patchRel === 'string') {
  const patchPath = join(root, patchRel.replace(/^\.\//u, ''))
  check('bundle patch file exists', existsSync(patchPath), patchPath)
  if (existsSync(patchPath)) {
    const text = readFileSync(patchPath, 'utf8')
    check('bundle patch inserts the plugin row', text.includes('close-to-quit'), 'row present')
  }
}

for (const rel of ['index.js', 'client.js', 'icon.svg', 'locale/zh.json', 'locale/en.json']) {
  check(`${rel} exists`, existsSync(join(root, rel)))
}

// The Client half is only loadable if the export map points at a real file.
for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (typeof target !== 'string' || target.includes('*')) continue
  const path = join(root, target.replace(/^\.\//u, ''))
  check(`exports["${key}"] resolves`, existsSync(path), target)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

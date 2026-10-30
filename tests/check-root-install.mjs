// Check that a package installed from the GitHub repo root resolves every subpath the
// bundle contract needs: the Host half, the Client half, the manifest, the icon, and a
// locale dictionary. Run with the probe project's package.json as the resolution base.
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node check-root-install.mjs <probe project dir>')
  process.exit(2)
}
// createRequire needs an absolute path; a relative argv is resolved against cwd.
const base = resolve(arg)
const require = createRequire(join(base, 'package.json'))

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

let root
try {
  root = dirname(require.resolve('dsh-close-to-quit/package.json'))
} catch (error) {
  console.log(`FAIL  cannot resolve dsh-close-to-quit: ${error.message}`)
  process.exit(1)
}
console.log(`installed at: ${root}\n`)

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
console.log(`manifest: ${manifest.name}@${manifest.version}`)
check('version is not the 0.0.0 placeholder', manifest.version !== '0.0.0', manifest.version)
check('declares dsh.bundle.patch', typeof manifest.dsh?.bundle?.patch === 'string', manifest.dsh?.bundle?.patch)
check('declares dsh.client', manifest.dsh?.client !== undefined)

// The patch path is package-relative and may point into a subdirectory.
const patchRel = manifest.dsh?.bundle?.patch
if (typeof patchRel === 'string') {
  const patchPath = join(root, patchRel.replace(/^\.\//u, ''))
  check('bundle patch exists at the declared path', existsSync(patchPath), patchPath)
  if (existsSync(patchPath)) {
    check('bundle patch inserts the plugin row', readFileSync(patchPath, 'utf8').includes('close-to-quit'))
  }
}

// Every export subpath must resolve, since the loader reads locale and icon through them.
for (const sub of [
  'dsh-close-to-quit',
  'dsh-close-to-quit/client',
  'dsh-close-to-quit/package.json',
  'dsh-close-to-quit/icon',
  'dsh-close-to-quit/locale/en.json',
  'dsh-close-to-quit/locale/zh.json',
]) {
  try {
    const path = require.resolve(sub)
    check(`resolves ${sub}`, existsSync(path), path.replace(root, '<pkg>'))
  } catch (error) {
    check(`resolves ${sub}`, false, error.code)
  }
}

// The Host half must import and expose the plugin contract.
const host = await import(pathToFileURL(require.resolve('dsh-close-to-quit')).href)
check('Host half imports', typeof host.apply === 'function')
check('Host half exports inject', Array.isArray(host.inject) && host.inject.includes('webServer'), JSON.stringify(host.inject))
check('Host half exports name', host.name === 'dsh-close-to-quit', host.name)

// Display metadata comes from the exported locale files.
const zh = JSON.parse(readFileSync(require.resolve('dsh-close-to-quit/locale/zh.json'), 'utf8'))
check('zh display title present', typeof zh.meta?.title === 'string', zh.meta?.title)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

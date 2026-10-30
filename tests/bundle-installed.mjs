// Resolve the installed bundle the way the loader does, and report whether every file the
// bundle contract needs is actually present.
//
// Paths come from the manifest's own export map and dsh.bundle.patch, so this works whether
// the package is flat (plugin files at the root) or nested (root manifest pointing into
// plugin/). Hardcoding flat names would give a false failure for the nested layout.
//
// usage: node tests/bundle-installed.mjs [profileDir]
//        default profileDir = $DSH_PROFILE_DIR, else ~/.dsh/profiles/desktop
import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const profileDir = resolve(
  process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop'),
)
const require = createRequire(join(profileDir, 'package.json'))

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

console.log(`profile = ${profileDir}\n`)

let pkgPath
try {
  pkgPath = require.resolve('dsh-close-to-quit/package.json')
} catch (error) {
  console.log(`FAIL  cannot resolve dsh-close-to-quit: ${error.message}`)
  process.exit(1)
}
const root = dirname(pkgPath)
// A link: install shows up as a symlink; a github/tarball install is a real directory.
// Report which, because a link: target that has been moved away is the silent failure mode.
let real = root
try {
  real = realpathSync(root)
} catch {
  /* the path is already real */
}
console.log(`bundle root = ${root}`)
console.log(`real path   = ${real}`)
console.log(`entry kind  = ${real === root ? 'real directory (github/tarball or local copy)' : 'symlink target'}\n`)

const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
console.log(`manifest: ${manifest.name}@${manifest.version}`)
console.log(`  dsh.bundle.patch = ${manifest.dsh?.bundle?.patch}`)
console.log(`  dsh.client       = ${JSON.stringify(manifest.dsh?.client)}\n`)

check('bundle root exists', existsSync(root))
check('version is not a 0.0.0 placeholder', manifest.version !== '0.0.0', manifest.version)
check('declares dsh.bundle.patch', typeof manifest.dsh?.bundle?.patch === 'string')
check('declares dsh.client', manifest.dsh?.client !== undefined)

// bundlePatchFiles accepts a string or a list of package-relative paths.
const declared = typeof manifest.dsh?.bundle?.patch === 'string'
  ? [manifest.dsh.bundle.patch]
  : manifest.dsh?.bundle?.patch
if (!Array.isArray(declared)) {
  check('dsh.bundle.patch is a string or list', false, typeof manifest.dsh?.bundle?.patch)
} else {
  for (const rel of declared) {
    const patchPath = join(root, String(rel).replace(/^\.\//u, ''))
    check(`bundle patch exists: ${rel}`, existsSync(patchPath), patchPath)
    if (existsSync(patchPath)) {
      check(`bundle patch inserts the plugin row: ${rel}`, readFileSync(patchPath, 'utf8').includes('close-to-quit'))
    }
  }
}

// Every export subpath must resolve to a real file, since the loader reads the Client half,
// the locale dictionaries and the icon through them.
for (const [key, target] of Object.entries(manifest.exports ?? {})) {
  if (typeof target !== 'string' || target.includes('*')) continue
  const path = join(root, target.replace(/^\.\//u, ''))
  check(`exports["${key}"] -> ${target}`, existsSync(path))
}

// The Host half must import and expose the plugin contract.
try {
  const host = await import(pathToFileURL(require.resolve('dsh-close-to-quit')).href)
  check('Host half imports', typeof host.apply === 'function')
  check('Host half exports inject', Array.isArray(host.inject) && host.inject.includes('webServer'), JSON.stringify(host.inject))
  check('Host half exports name', host.name === 'dsh-close-to-quit', host.name)
} catch (error) {
  check('Host half imports', false, error.code ?? error.message)
}

// Display metadata is read from the exported locale dictionaries.
for (const id of ['zh', 'en']) {
  try {
    const dict = JSON.parse(readFileSync(require.resolve(`dsh-close-to-quit/locale/${id}.json`), 'utf8'))
    check(`${id} display title present`, typeof dict.meta?.title === 'string', dict.meta?.title)
  } catch (error) {
    check(`${id} locale resolves`, false, error.code ?? error.message)
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
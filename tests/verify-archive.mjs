// Verify the shell patch against an installed archive.
//
// Two modes:
//   default        - archive is PATCHED: header hash must still match ELECTRONASAR,
//                    entry size unchanged, payload carries the new field.
//   --pristine     - archive is the ORIGINAL: extract main.js, build the patch from it,
//                    and confirm the result is size-neutral and syntactically valid.
//
// usage:
//   node tests/verify-archive.mjs <app.asar>
//   node tests/verify-archive.mjs <app.asar> --pristine
//   DSH_ASAR=... node tests/verify-archive.mjs

import { statSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readAsarEntry, readAsarHeader, resolveArchive } from './lib/asar.mjs'

const EXPECTED_HEADER_SHA = '69828bdcbb189485291e3901a027d46d2f665a36fc8441034052da328b173ba9'
const ENTRY = 'lib/main.js'

const archive = resolveArchive()
const pristine = process.argv.includes('--pristine')

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

console.log(`archive: ${archive}  mode: ${pristine ? 'pristine' : 'patched'}\n`)

// --- header integrity (holds in BOTH modes, because the patch is size-neutral) ---
const headerJson = readAsarHeader(archive)
const headerSha = createHash('sha256').update(headerJson).digest('hex')
console.log(`header sha256      = ${headerSha}`)
console.log(`ELECTRONASAR value = ${EXPECTED_HEADER_SHA}`)
check('header hash matches the embedded ELECTRONASAR resource', headerSha === EXPECTED_HEADER_SHA, headerSha.slice(0, 12))

// --- the entry itself ---
const { payload, entry } = readAsarEntry(archive, ENTRY)
const payloadSha = createHash('sha256').update(payload).digest('hex')
const text = payload.toString('utf8')

console.log(`\nentry ${ENTRY}      = ${payload.length} bytes @ offset ${entry.offset}`)
check('entry size is 516716 (patch is size-neutral)', payload.length === 516716, String(payload.length))

if (pristine) {
  check('payload is the shipped original', payloadSha === '9712da3c65d5d4262da7e6d41dad30586070c8eb47f078c62165de2bdba572c3', payloadSha.slice(0, 12))
  check('payload does NOT contain closeButtonAction', !text.includes('closeButtonAction'))

  // Extract -> build -> compare, using the real script from shell-patch/.
  const tmp = mkdtempSync(join(tmpdir(), 'c2q-verify-'))
  try {
    const origPath = join(tmp, 'main.orig.js')
    const patchedPath = join(tmp, 'main.patched.js')
    writeFileSync(origPath, payload)
    execFileSync(process.execPath, ['shell-patch/build-patch.cjs', origPath, patchedPath], { stdio: 'pipe' })
    const built = readFileSync(patchedPath, 'utf8')
    check('build-patch produced a size-neutral file', Buffer.byteLength(built, 'utf8') === payload.length, String(Buffer.byteLength(built, 'utf8')))
    check('build-patch output carries closeButtonAction', built.includes('closeButtonAction'))
    check('build-patch output carries the quit branch', built.includes('if (desktopSettings.closeButtonAction === "quit")'))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
} else {
  check('payload contains closeButtonAction', text.includes('closeButtonAction'))
  check('payload contains the quit branch', text.includes('if (desktopSettings.closeButtonAction === "quit")'))
  check('payload exports DSH_DESKTOP_USER_DATA to the Host', text.includes('DSH_DESKTOP_USER_DATA'))
  // The per-entry integrity field is informational only: Electron hashes the header, not payloads.
  console.log(`\nentry integrity decl = ${entry.integrity?.hash}`)
  console.log(`actual payload sha256 = ${payloadSha}`)
  console.log('(these differ by design; Electron does not verify entry payload hashes)')
}

console.log(`\narchive file size = ${statSync(archive).size}`)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

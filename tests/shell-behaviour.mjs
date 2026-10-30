// Exercise the shell's real readDesktopSettings and the real close handler, both taken
// verbatim from the archive under test, so this validates the patch rather than a copy of it.
//
// usage: node tests/shell-behaviour.mjs <app.asar>
//        DSH_ASAR=... node tests/shell-behaviour.mjs

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAsarEntry, resolveArchive } from './lib/asar.mjs'

const archive = resolveArchive()
const { payload } = readAsarEntry(archive, 'lib/main.js')
const source = payload.toString('utf8')

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

// ---------------------------------------------------------------- readDesktopSettings
const rsStart = source.indexOf('function readDesktopSettings(userData) {')
const rsEnd = source.indexOf('\n//#endregion', rsStart)
if (rsStart < 0 || rsEnd < 0) throw new Error('readDesktopSettings not found in the archive payload')
const rsSource = source.slice(rsStart, rsEnd)
check('readDesktopSettings carries the new field', rsSource.includes('closeButtonAction'))

const record = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const readDesktopSettings = new Function(
  'join', 'readFileSync', 'writeFileSync', 'mkdirSync', 'record$1', 'console',
  `${rsSource}\nreturn readDesktopSettings;`,
)(join, readFileSync, writeFileSync, mkdirSync, record, { warn() {} })

function withSettings(label, content) {
  const dir = mkdtempSync(join(tmpdir(), 'c2q-rs-'))
  try {
    if (content !== undefined) {
      mkdirSync(join(dir, 'desktop'), { recursive: true })
      writeFileSync(join(dir, 'desktop', 'settings.json'), content)
    }
    const result = readDesktopSettings(dir)
    console.log(`  ${label} -> ${JSON.stringify(result)}`)
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\nreadDesktopSettings:')
const missing = withSettings('no file', undefined)
const shipped = withSettings('shipped default', '{"updates":{"allowTestAuthPopupWindow":false}}')
const tray = withSettings('tray', '{"updates":{"allowTestAuthPopupWindow":true},"closeButtonAction":"tray"}')
const quit = withSettings('quit', '{"closeButtonAction":"quit"}')
const unknown = withSettings('unknown value', '{"closeButtonAction":"minimize"}')
const wrongType = withSettings('wrong type', '{"closeButtonAction":true}')
const broken = withSettings('broken JSON', '{oops')

check('missing file falls back to tray', missing.closeButtonAction === 'tray')
check('shipped default reads as tray', shipped.closeButtonAction === 'tray')
check('explicit tray is honoured', tray.closeButtonAction === 'tray')
check('explicit quit is honoured', quit.closeButtonAction === 'quit')
check('unknown value falls back to tray (never throws)', unknown.closeButtonAction === 'tray')
check('wrong type falls back to tray', wrongType.closeButtonAction === 'tray')
check('broken JSON falls back to defaults', broken.closeButtonAction === 'tray')
check('foreign key still parsed', tray.updates?.allowTestAuthPopupWindow === true)

// --------------------------------------------------------------------- close handler
const marker = 'desktopSettings.closeButtonAction'
const m = source.indexOf(marker)
if (m < 0) throw new Error('quit branch missing from the archive payload')
const start = source.lastIndexOf('window.on("close", (event) => {', m)
const end = source.indexOf('if (process.platform === "win32") window.on("session-end"', m)
if (start < 0 || end < 0) throw new Error('close handler bounds not found')
const handlerSource = source.slice(start, end).trimEnd()
check('close handler is self-contained (no `this`)', !handlerSource.includes('this.'))

function runClose(label, settings, overrides = {}) {
  const calls = { quit: 0, hide: 0, prevented: 0, notice: 0, focus: 0 }
  const env = {
    quitting: false,
    shellInstallerOwnsQuit: false,
    sessionEnding: false,
    event: { preventDefault: () => { calls.prevented++ } },
    updateDialog: { isOpen: false, focus: () => { calls.focus++ } },
    desktopSettings: settings,
    app: { quit: () => { calls.quit++ } },
    backgroundNotice: { close: (then) => { calls.notice++; then() } },
    hideMainWindow: () => { calls.hide++ },
    ...overrides,
  }
  // The stub records the close listener then delivers the event, exactly as Electron does
  // when the user presses the window's X button.
  const windowStub = {
    isDestroyed: () => false,
    on(name, listener) {
      if (name === 'close') listener(env.event)
    },
  }
  new Function(
    'window', 'quitting', 'shellInstallerOwnsQuit', 'sessionEnding',
    'updateDialog', 'desktopSettings', 'app', 'backgroundNotice', 'hideMainWindow',
    handlerSource,
  )(windowStub, env.quitting, env.shellInstallerOwnsQuit, env.sessionEnding,
    env.updateDialog, env.desktopSettings, env.app, env.backgroundNotice, env.hideMainWindow)
  console.log(`  ${label} -> preventDefault=${calls.prevented} quit=${calls.quit} hide=${calls.hide} notice=${calls.notice} focus=${calls.focus}`)
  return calls
}

console.log('\nclose handler:')
const t = runClose('tray', { closeButtonAction: 'tray' })
const q = runClose('quit', { closeButtonAction: 'quit' })
const dlg = runClose('quit + dialog open', { closeButtonAction: 'quit' }, { updateDialog: { isOpen: true, focus: () => {} } })
const ending = runClose('quit + session ending', { closeButtonAction: 'quit' }, { sessionEnding: true })
const absent = runClose('field absent', {})

check('tray: prevents default', t.prevented === 1)
check('tray: does not quit', t.quit === 0)
check('tray: hides via the background notice', t.hide === 1 && t.notice === 1)
check('quit: prevents default so the shell owns teardown', q.prevented === 1)
check('quit: calls app.quit', q.quit === 1)
check('quit: does not hide to the tray', q.hide === 0 && q.notice === 0)
check('update dialog keeps priority over quit', dlg.quit === 0)
check('session ending bypasses the handler', ending.prevented === 0 && ending.quit === 0)
check('absent field behaves like tray', absent.quit === 0 && absent.hide === 1)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

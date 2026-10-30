// Exercise the plugin's real Host half (plugin/index.js) with a mock Cordis context and
// fake HTTP req/res: state read, set write, key preservation, and every refusal path.
//
// usage: node tests/host-route.mjs

import { apply } from '../plugin/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const routes = new Map()
const ctx = {
  inject(_names, fn) {
    fn({
      webServer: {
        getOrigin: () => 'http://127.0.0.1:54197',
        register(route) {
          routes.set(route.path, route.handler)
          return () => routes.delete(route.path)
        },
      },
      effect(fn) {
        const dispose = fn()
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      },
    })
  },
}
apply(ctx)
console.log('routes registered:', [...routes.keys()])

function makeReq({ method = 'GET', headers = {}, body = undefined }) {
  const listeners = {}
  const req = {
    method,
    headers,
    on(event, fn) {
      ;(listeners[event] = listeners[event] || []).push(fn)
      return req
    },
    destroy() {},
  }
  process.nextTick(() => {
    if (body !== undefined) for (const fn of listeners.data || []) fn(Buffer.from(body, 'utf8'))
    for (const fn of listeners.end || []) fn()
  })
  return req
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: '',
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    writeHead(status) {
      res.statusCode = status
      res.headersSent = true
    },
    end(chunk) {
      if (typeof chunk === 'string') res.body += chunk
      res.writableEnded = true
    },
  }
  return res
}

function call(path, opts) {
  return new Promise((resolve) => {
    const res = makeRes()
    const p = routes.get(path)(makeReq(opts), res)
    const settle = () => resolve({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null })
    if (p && typeof p.then === 'function') p.then(settle, settle)
    else setTimeout(settle, 150)
  })
}

let failed = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
  if (!ok) failed++
}

const HOST = '127.0.0.1:54197'
const OK = { host: HOST, origin: `http://${HOST}`, 'x-dsh-close-to-quit': '1' }
const POST = { ...OK, 'content-type': 'application/json' }

const sandbox = mkdtempSync(join(tmpdir(), 'c2q-route-'))
try {
  mkdirSync(join(sandbox, 'desktop'), { recursive: true })
  const settingsFile = join(sandbox, 'desktop', 'settings.json')
  process.env.DSH_DESKTOP_USER_DATA = sandbox

  console.log('\nstate / set:')
  const s0 = await call('/dsh-close-to-quit/state', { headers: OK })
  console.log('  no file ->', JSON.stringify(s0.body))
  check('state on missing file answers tray', s0.status === 200 && s0.body.action === 'tray')

  // The shell's own key must survive a write by this plugin.
  writeFileSync(settingsFile, JSON.stringify({ updates: { allowTestAuthPopupWindow: true } }, null, 2) + '\n')
  const s1 = await call('/dsh-close-to-quit/state', { headers: OK })
  check('state reads the shell document', s1.body.action === 'tray')

  const w1 = await call('/dsh-close-to-quit/set', { method: 'POST', headers: POST, body: '{"action":"quit"}' })
  console.log('  set quit ->', JSON.stringify(w1.body))
  const doc1 = JSON.parse(readFileSync(settingsFile, 'utf8'))
  console.log('  file ->', JSON.stringify(doc1))
  check('set quit is written', w1.status === 200 && doc1.closeButtonAction === 'quit')
  check('foreign key preserved', doc1.updates?.allowTestAuthPopupWindow === true)

  const w2 = await call('/dsh-close-to-quit/set', { method: 'POST', headers: POST, body: '{"action":"tray"}' })
  const doc2 = JSON.parse(readFileSync(settingsFile, 'utf8'))
  check('set tray is written', w2.status === 200 && doc2.closeButtonAction === 'tray')
  check('foreign key still preserved', doc2.updates?.allowTestAuthPopupWindow === true)

  console.log('\nrefusals:')
  const noHeader = { host: HOST, origin: `http://${HOST}` }
  const r1 = await call('/dsh-close-to-quit/state', { headers: noHeader })
  check('missing client header is refused', r1.status === 403, `status ${r1.status}`)

  const r2 = await call('/dsh-close-to-quit/state', { headers: { host: HOST, origin: 'https://evil.example', 'x-dsh-close-to-quit': '1' } })
  check('cross-site origin is refused', r2.status === 403, `status ${r2.status}`)

  const r3 = await call('/dsh-close-to-quit/state', { headers: { host: HOST, origin: 'null', 'x-dsh-close-to-quit': '1' } })
  check('opaque origin is refused', r3.status === 403, `status ${r3.status}`)

  const r4 = await call('/dsh-close-to-quit/set', { headers: OK })
  check('set via GET is refused', r4.status === 405, `status ${r4.status}`)

  const r5 = await call('/dsh-close-to-quit/set', { method: 'POST', headers: POST, body: '{"action":"close"}' })
  check('unknown action is refused', r5.status === 400, `status ${r5.status}`)

  const r6 = await call('/dsh-close-to-quit/set', { method: 'POST', headers: POST, body: '{oops' })
  check('broken JSON is refused', r6.status === 400, `status ${r6.status}`)

  // A refused write must leave the document untouched.
  const after = JSON.parse(readFileSync(settingsFile, 'utf8'))
  check('refused writes did not change the document', after.closeButtonAction === 'tray')

  // ---- desktop-state detection: patched / shell / standalone ----
  console.log('\ndesktop state:')
  const sPatched = await call('/dsh-close-to-quit/state', { headers: OK })
  check('env var present -> patched', sPatched.body.desktop === 'patched', sPatched.body.desktop)

  // A shell whose build predates the patch: no env var, but its settings file exists.
  delete process.env.DSH_DESKTOP_USER_DATA
  const shellRoot = mkdtempSync(join(tmpdir(), 'c2q-shell-'))
  try {
    mkdirSync(join(shellRoot, 'Roaming', '@deepseek-ai', 'dsh-desktop', 'desktop'), { recursive: true })
    writeFileSync(join(shellRoot, 'Roaming', '@deepseek-ai', 'dsh-desktop', 'desktop', 'settings.json'), '{"closeButtonAction":"tray"}\n')
    const savedAppData = process.env.APPDATA
    process.env.APPDATA = join(shellRoot, 'Roaming')
    const sShell = await call('/dsh-close-to-quit/state', { headers: OK })
    check('file exists without env var -> shell', sShell.body.desktop === 'shell', sShell.body.desktop)

    process.env.APPDATA = join(shellRoot, 'Nowhere')
    const sStandalone = await call('/dsh-close-to-quit/state', { headers: OK })
    check('nothing found -> standalone', sStandalone.body.desktop === 'standalone', sStandalone.body.desktop)

    if (savedAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = savedAppData
  } finally {
    rmSync(shellRoot, { recursive: true, force: true })
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true })
  delete process.env.DSH_DESKTOP_USER_DATA
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)

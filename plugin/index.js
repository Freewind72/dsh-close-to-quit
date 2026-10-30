/**
 * Host half of dsh-close-to-quit.
 *
 * Owns one preference: whether the desktop window's close button quits the app or hides it
 * to the tray. The value lives in the Electron shell's own settings document
 * (`<userData>/desktop/settings.json`), which is where the patched `lib/main.js` reads it,
 * so this half writes that file and nothing else.
 *
 * The write is a read-modify-write of a small JSON document the shell also owns. Two rules
 * keep that safe: unknown keys are preserved (the shell may add its own), and the write is
 * atomic (temp file + rename) so a crash cannot leave the shell with an unparseable file —
 * the shell treats an unreadable settings file as "use defaults", which would silently
 * revert this preference.
 *
 * The route is a same-origin bridge for the Client half. It refuses cross-site requests
 * because a page from another origin must not be able to change how this app closes.
 */

import { readFile, rename, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-close-to-quit'

/**
 * Only the Web server is required. The preference itself needs no other service: the
 * Electron shell is the reader, and it is not part of this process.
 */
export const inject = ['webServer']

/** Route prefix owned by this plugin; the Client half fetches exactly these paths. */
const ROUTE_PREFIX = '/dsh-close-to-quit'

/** Preference keys this plugin owns, and the only values the patched shell accepts. */
const TRAY = 'tray'
const QUIT = 'quit'

/** A body larger than this is not a preference write. */
const MAX_BODY_BYTES = 8 * 1024

/** Header the Client half sets; a cross-site form cannot set it without a preflight we deny. */
const CLIENT_HEADER = 'x-dsh-close-to-quit'

/**
 * Resolve the Electron `userData` directory.
 *
 * The shell passes its exact path as `DSH_DESKTOP_USER_DATA`, which is authoritative because
 * Electron derives it from the app name and package identity — not from HOME. The fallbacks
 * below only serve a Host started outside the desktop shell (a plain `dsh web` session), where
 * there is no close button to configure anyway; the route still answers, so the Client half
 * can render a row that explains why it cannot act.
 */
function userDataDirectory() {
  const explicit = process.env.DSH_DESKTOP_USER_DATA
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
  const appData =
    process.env.APPDATA ??
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : join(homedir(), '.config'))
  return join(appData, '@deepseek-ai', 'dsh-desktop')
}

/** The settings document the shell reads once per process at startup. */
function settingsPath() {
  return join(userDataDirectory(), 'desktop', 'settings.json')
}

/**
 * Whether this Host runs inside a patched desktop shell, decided by evidence rather than by
 * one environment variable.
 *
 * `DSH_DESKTOP_USER_DATA` is the shell's exact `userData` path, and the patch is what adds it.
 * A shell still running the shipped build therefore has it absent while the preference file
 * exists — in that case the row must say "restart to enable" instead of claiming it can do
 * nothing.
 *
 * @returns {'patched'|'shell'|'standalone'}: `patched` = the shell honours the value,
 *   `shell` = a desktop shell is present but its build predates the patch, `standalone` = no
 *   desktop shell at all.
 */
async function desktopState() {
  if (typeof process.env.DSH_DESKTOP_USER_DATA === 'string' && process.env.DSH_DESKTOP_USER_DATA.trim() !== '') {
    return 'patched'
  }
  try {
    await stat(settingsPath())
    return 'shell'
  } catch {
    return 'standalone'
  }
}

/** Narrow an arbitrary JSON value to a plain object, or null. */
function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/**
 * Read the current preference.
 *
 * @returns {{action: 'tray'|'quit', restorable: boolean, path: string, error?: string}}
 *   `restorable` is false when the document could not be read or parsed: the shell would
 *   then fall back to its own defaults, so the row must not claim the stored value is live.
 */
async function readPreference() {
  const path = settingsPath()
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      // The shell creates this file on first launch. Before that the effective value is the
      // shell's own default, which the patch sets to "tray".
      return { action: TRAY, restorable: true, path }
    }
    return { action: TRAY, restorable: false, path, error: String(error?.code ?? error) }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { action: TRAY, restorable: false, path, error: 'invalid JSON' }
  }
  const record = asRecord(parsed)
  if (record === null) return { action: TRAY, restorable: false, path, error: 'not an object' }
  return { action: record.closeButtonAction === QUIT ? QUIT : TRAY, restorable: true, path }
}

/**
 * Store the preference, preserving every other key the shell owns.
 *
 * @param action - `'tray'` or `'quit'`.
 * @returns {{ok: true, action: string} | {ok: false, error: string}}
 */
async function writePreference(action) {
  const path = settingsPath()
  let current = {}
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const record = asRecord(parsed)
    // An unreadable document is replaced rather than merged: merging into garbage would keep
    // the garbage. The shell's own defaults are re-derived from its schema on the next start.
    if (record !== null) current = record
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      return { ok: false, error: String(error?.code ?? error) }
    }
  }
  const next = { ...current, closeButtonAction: action }
  const body = `${JSON.stringify(next, null, 2)}\n`
  const temp = `${path}.dsh-close-to-quit.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temp, body, { mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    return { ok: false, error: String(error?.code ?? error) }
  }
  return { ok: true, action }
}

/** Write one JSON answer; a socket already gone must not throw into the caller. */
function sendJson(res, status, payload) {
  try {
    if (res.writableEnded === true || res.destroyed === true) return
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  } catch {
    try {
      if (res.writableEnded !== true && res.destroyed !== true) res.end()
    } catch {
      /* the socket is already gone */
    }
  }
}

/** Read one small JSON body; anything unreadable answers null instead of hanging. */
function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    let size = 0
    let done = false
    const parts = []
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      finish(null)
      try {
        req.destroy?.()
      } catch {
        /* the request is already gone */
      }
    }, 5000)
    timer.unref?.()
    try {
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          finish(null)
          return
        }
        parts.push(chunk)
      })
      req.on('end', () => {
        if (done) return
        try {
          finish(JSON.parse(Buffer.concat(parts).toString('utf8')))
        } catch {
          finish(null)
        }
      })
      req.on('error', () => finish(null))
    } catch {
      finish(null)
    }
  })
}

/**
 * Whether one request may act for the row.
 *
 * The Client half always runs on the Host's own origin (`dsh-app://app` inside the desktop
 * shell, the bound loopback origin in a browser), so an `origin` that differs from the
 * requested host is another site. The custom header is the second gate: a cross-site form
 * cannot set it without a preflight this server never approves.
 */
function requestAllowed(req, origin) {
  const header = req?.headers?.[CLIENT_HEADER]
  if (typeof header !== 'string' || header === '') return false
  const host = typeof req?.headers?.host === 'string' ? req.headers.host.trim().toLowerCase() : ''
  const claimed = typeof req?.headers?.origin === 'string' ? req.headers.origin.trim().toLowerCase() : ''
  // An opaque origin is a document this app did not open.
  if (claimed === 'null') return false
  if (claimed !== '') {
    try {
      if (new URL(claimed).host.toLowerCase() !== host) return false
    } catch {
      return false
    }
  }
  return true
}

export function apply(ctx) {
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const origin = () => {
        try {
          return sctx.webServer.getOrigin()
        } catch {
          return ''
        }
      }

      const state = async (req, res) => {
        if (!requestAllowed(req, origin())) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        const current = await readPreference()
        const desktop = await desktopState()
        sendJson(res, 200, {
          ok: true,
          action: current.action,
          restorable: current.restorable,
          // The shell reads this file once per process, so a write only takes effect on the
          // next launch. The row says so instead of implying an immediate change.
          appliesOnRestart: true,
          desktop,
          path: current.path,
        })
      }

      const set = async (req, res) => {
        if (!requestAllowed(req, origin())) return sendJson(res, 403, { ok: false, error: 'forbidden' })
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })
        const body = await readJsonBody(req)
        const record = asRecord(body)
        const action = record?.action
        if (action !== TRAY && action !== QUIT) return sendJson(res, 400, { ok: false, error: 'action' })
        const written = await writePreference(action)
        if (written.ok !== true) return sendJson(res, 500, { ok: false, error: written.error })
        sendJson(res, 200, {
          ok: true,
          action: written.action,
          appliesOnRestart: true,
          desktop: await desktopState(),
        })
      }

      const disposers = []
      for (const [path, handler] of [
        [`${ROUTE_PREFIX}/state`, state],
        [`${ROUTE_PREFIX}/set`, set],
      ]) {
        try {
          const dispose = sctx.webServer.register({ kind: 'exact', path, handler })
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch {
          // A duplicate route means this composition already registered it; the row still works
          // through the surviving registration.
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* already released */
          }
        }
      }
    }, 'dsh-close-to-quit: preference bridge')
  })
}

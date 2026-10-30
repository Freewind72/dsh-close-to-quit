# dsh-close-to-quit

Make the **window close button (×)** in the DeepSeek Harness desktop app **quit the app**
instead of hiding to the tray — as a toggle in **Settings → General**.

Default stays the shipped behaviour (hide to tray), so nothing changes until you flip the switch.

The row renders as **"Window close button"** with a switch and a restart hint, between
"Link opening" and "Composer enter" in the General list.

> **中文开工速查**（给人看的口径见
> [knowledge/dsh-close-to-quit/README.md](../../knowledge/dsh-close-to-quit/README.md)）
>
> - 改行为的是 `shell-patch/`，画开关的是 `plugin/`，**两层缺一不可**
> - 上手顺序：`extract-main.cjs` → `build-patch.cjs` → `apply-patch.cjs`（先完全退出应用）
> - 补丁必须**等长**（516716 字节），否则会破坏 asar 头部哈希
> - 改完跑 `tests/` 下四个脚本，全 `ALL PASS` 才算数
> - `work/` 是逆向草稿，不入库；`main.orig.js` / `main.patched.js` 也不入库

---

## What this is

Two layers, because the close button lives in the Electron shell, which is not a Cordis plugin:

| Layer | Where | What it does |
|---|---|---|
| **Shell patch** | `lib/main.js` inside `resources/app.asar` | Actually changes behaviour: reads the pref, calls `app.quit()` |
| **Plugin** | `plugin/` (a Cordis bundle) | Draws the Settings → General row and reads/writes the pref |

| Only plugin | Only shell patch | Both |
|---|---|---|
| The switch stores a value, × still hides to tray | Behaviour changes, but no switch exists | Switch works, × obeys it |

---

## Requirements

- DeepSeek Harness **desktop** app, verified on `@deepseek-ai/dsh-desktop 0.2.1-rc.5`
- Node.js (any recent version) to run the patch scripts
- Windows for the `rollback.ps1` helper (the patch scripts themselves are cross-platform)

---

## Install

### 1. Install the plugin

Option A — plugin manager (recommended; keeps the icon and display metadata):

```
plugin_manager(action="install_bundle", target="<abs path>/plugin")
```

Option B — pnpm:

```bash
pnpm add <abs path>/dsh-close-to-quit-1.0.0.tgz
```

Confirm the insert landed in your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: close-to-quit
      name: dsh-close-to-quit
```

### 2. Patch the shell

**Quit DeepSeek Harness completely first** — no window, no tray icon, no
`DeepSeek Harness` process in the task manager.

```bash
cd shell-patch

# Extract lib/main.js from your installation (this file is NOT shipped in the repo)
node extract-main.cjs "E:/dsh/resources/app.asar"

# Build the size-neutral patch
node build-patch.cjs

# Apply it (verifies the header hash before writing)
node apply-patch.cjs "E:/dsh/resources/app.asar" "E:/dsh/resources/app.asar" "main.patched.js"
```

Expected output from `apply-patch.cjs`:

```
header sha256 = 69828bdcbb189485291e3901a027d46d2f665a36fc8441034052da328b173ba9
integrity MATCHES ELECTRONASAR value
payload readback identical = true
archive size: src=182766714 dst=182766714 equal=true
APPLIED OK
```

### 3. Restart and choose

1. Start DeepSeek Harness
2. Open **Settings → General**, find **Window close button**
   (between "Link opening" and "Composer enter")
3. On = × quits the app · Off = × hides to the tray (default)
4. **Restart once more** — the shell reads its settings file once per process

---

## Verify

```bash
# header integrity + entry size (works on both a pristine and a patched archive)
node tests/verify-archive.mjs "E:/dsh/resources/app.asar"

# prove the patch can be reproduced from the original archive
node tests/verify-archive.mjs "E:/dsh/resources/app.asar.bak-close-to-quit" --pristine

# run the shell's real readDesktopSettings and real close handler
node tests/shell-behaviour.mjs "E:/dsh/resources/app.asar"

# the plugin's Host half: reads, writes, refusals, three desktop states
node tests/host-route.mjs

# is the bundle actually installed where the loader will look?
node tests/bundle-installed.mjs
```

Set `DSH_ASAR` instead of passing a path if you prefer:

```bash
DSH_ASAR="E:/dsh/resources/app.asar" node tests/verify-archive.mjs
```

Check the preference actually landed (`%APPDATA%\@deepseek-ai\dsh-desktop\desktop\settings.json`):

```powershell
Get-Content "$env:APPDATA\@deepseek-ai\dsh-desktop\desktop\settings.json" -Raw
```

After choosing "Quit app" you should see `"closeButtonAction": "quit"`.

---

## Why the patch is size-neutral

The installation contains an `INTEGRITY/ELECTRONASAR` resource declaring a SHA-256 for
`resources/app.asar`. **That hash covers only the asar header JSON** (bytes `16..16+jsonSize`),
not the entry payloads — hashing the whole file does not match, hashing the header does.

A payload edit is therefore invisible to the check, **but any length change would force header
offset rewrites**, which would change the header and break the hash.

So the patch keeps `lib/main.js` at exactly **516716 bytes**:

- 4 code edits add 274 bytes
- one JSDoc block above `writeFileAtomic` shrinks from 1000 → 726 bytes to compensate

Only comment prose is removed; code semantics are unchanged, and `node --check` passes.

> If a future change cannot be made size-neutral, the header must be rewritten *and* the
> executable's `INTEGRITY` resource recomputed — a different order of magnitude.

The per-entry `integrity` field in the header also goes stale. Electron does not verify it:
entry payloads are read straight from the data region. `tests/verify-archive.mjs` prints both
hashes so the difference is visible rather than hidden.

---

## What the patch changes

| # | Location | Change |
|---|---|---|
| 1 | `readDesktopSettings` defaults | adds `closeButtonAction: "tray"` |
| 2 | `readDesktopSettings` return | adds the field, accepting only `"tray"` / `"quit"` |
| 3 | window `close` handler | `"quit"` → `app.quit()`, before the hide path |
| 4 | Host child environment | adds `DSH_DESKTOP_USER_DATA` so the plugin can find the file |
| 5 | `writeFileAtomic` JSDoc | 1000 → 726 bytes, to keep the file size identical |

The quit branch sits **after** the update-dialog check and **after** the
`quitting` / `shellInstallerOwnsQuit` / `sessionEnding` early return, so:

- an open update dialog still wins over closing
- OS shutdown and installer-driven quit paths are untouched
- `app.quit()` runs the shell's own `before-quit` confirmation, so the
  "active tasks will be interrupted" prompt is preserved

An unrecognised `closeButtonAction` value falls back to `"tray"` rather than throwing:
`readDesktopSettings` failures fall back to defaults, and a typo must never brick startup.

---

## Rollback

```powershell
# Quit the app completely first
pwsh -File shell-patch/rollback.ps1
```

Restores `resources/app.asar` from `app.asar.bak-close-to-quit` and verifies the hash.
Disable or remove the plugin through the plugin manager separately.

---

## Layout

```
.
├── plugin/                  # Cordis bundle (Host half + Client half)
│   ├── package.json         # dsh.bundle.patch + dsh.client
│   ├── cordis.patch.yml     # one insert row
│   ├── index.js             # Host: /dsh-close-to-quit/{state,set}
│   ├── client.js            # Client: the Settings → General row
│   ├── locale/{zh,en}.json  # display name and description
│   └── icon.svg
├── shell-patch/
│   ├── extract-main.cjs     # pull lib/main.js out of app.asar
│   ├── build-patch.cjs      # main.orig.js -> main.patched.js (size-neutral)
│   ├── apply-patch.cjs      # write the patch, verifying the header hash
│   └── rollback.ps1         # restore from backup
└── tests/
    ├── lib/asar.mjs          # dependency-free asar reader
    ├── verify-archive.mjs    # header integrity, entry size, payload contents
    ├── shell-behaviour.mjs   # real readDesktopSettings + real close handler
    ├── host-route.mjs        # plugin Host half, refusals, desktop states
    └── bundle-installed.mjs  # is the bundle resolvable where the loader looks?
```

`main.orig.js` and `main.patched.js` are **not committed**: the first is DeepSeek's own code,
and both are regenerable with the two scripts above.

---

## Caveats

- **Replace `app.asar` only with the app fully quit.** Windows keeps the archive open while
  the shell runs, and a half-written archive corrupts the installation.
- **Keep `app.asar.bak-close-to-quit` (~182 MB).** It is the only copy of the original.
- **The shell reads its settings file once per process.** Every change needs a restart; the
  row says so instead of pretending otherwise.
- **`DSH_DESKTOP_USER_DATA` is the only signal that the shell is patched.** A shell started
  before patching lacks it, so the plugin reports three states — `patched`, `shell`,
  `standalone` — and tells the user to restart instead of claiming nothing can be changed.
- **Never rewrite header offsets by hand.** That breaks the `ELECTRONASAR` hash.
- **If you install the plugin from this directory, it is a `link:` dependency.** The profile's
  `package.json` records an absolute path to `plugin/`. Renaming or moving this directory
  silently breaks the plugin: the loader cannot read `package.json`, so the row simply
  disappears with no error. Change the `link:` path and re-run `pnpm install` *before* moving
  anything, and confirm with `node tests/bundle-installed.mjs` rather than trusting
  `list_plugins`.

## Not verified

- The row's on-screen rendering (switch appearance, zh/en copy, hint placement) — only the
  slot registration was confirmed.
- A real × press in quit mode — the branches are verified against the archive's own code,
  but no live window was clicked.

## Licence

MIT — see [LICENSE](LICENSE). That licence covers only this project's own code (the Cordis
plugin and the patch/test scripts).

It does **not** cover DeepSeek Harness or any part of it. This project modifies an installed
copy of that application in place; it neither ships nor redistributes its code, and the terms
that application ships with govern it. `shell-patch/main.orig.js` is generated locally from
your own installation and is git-ignored for that reason.

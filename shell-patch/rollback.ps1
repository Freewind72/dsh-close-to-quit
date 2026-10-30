# Roll back the lib/main.js patch in the installed desktop shell.
#
# Restores resources/app.asar from the backup this project created before patching.
# Run it with the app FULLY QUIT — Windows holds the archive open while the shell runs.
#
# usage: pwsh -File rollback.ps1
param(
  [string]$InstallRoot = 'E:\dsh',
  [string]$Backup = ''
)

$ErrorActionPreference = 'Stop'
$asar = Join-Path $InstallRoot 'resources\app.asar'
if ($Backup -eq '') { $Backup = "$asar.bak-close-to-quit" }

if (-not (Test-Path $asar))    { throw "archive not found: $asar" }
if (-not (Test-Path $Backup))  { throw "backup not found: $Backup" }

# Refuse while the shell is running: replacing a live archive corrupts the running process.
$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running) {
  throw "DeepSeek Harness is running ($($running.Count) processes). Quit it completely, then rerun."
}

$expected = 'E1B6F25FA937DA98086C3E77AF77AA14791105963C4D337A1C42179D232C6915'
$actual = (Get-FileHash $Backup -Algorithm SHA256).Hash
if ($actual -ne $expected) {
  throw "backup hash mismatch: expected $expected, got $actual. Refusing to restore an unverified archive."
}

Copy-Item $Backup $asar -Force
$restored = (Get-FileHash $asar -Algorithm SHA256).Hash
Write-Output "restored app.asar sha256=$restored"
if ($restored -ne $expected) { throw "restore verification failed" }
Write-Output "OK: app.asar restored to the shipped build"
Write-Output "The Settings > General row stays installed; with the shipped shell it reports that a restart is needed."

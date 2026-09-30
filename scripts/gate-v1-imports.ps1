# Gate: V1 @opencode-ai/* imports must not remain in ported source.
# Usage: pwsh scripts/gate-v1-imports.ps1 [-Target packages/]
param([string]$Target = "packages/")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$exclude = 'node_modules|dist|\.git'
$files = Get-ChildItem -Path $Target -Recurse -File `
  -Include *.ts,*.tsx,*.js,*.mjs,*.cjs |
  Where-Object { $_.FullName -notmatch $exclude } |
  Where-Object { Select-String -Path $_.FullName -Pattern '@opencode-ai/' -Quiet }
if ($files) {
  Write-Error "FAIL: V1 @opencode-ai/ imports found under $Target"
  $files | ForEach-Object { Write-Error $_.FullName }
  exit 1
}
Write-Host "PASS: no @opencode-ai/ imports under $Target"

# Gate: no ': any' type suppression in source.
# Usage: pwsh scripts/gate-any.ps1 [-Target packages/]
param([string]$Target = "packages/")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$exclude = 'node_modules|dist|\.git'
$hits = Get-ChildItem -Path $Target -Recurse -File -Include *.ts,*.tsx |
  Where-Object { $_.FullName -notmatch $exclude } |
  Select-String -Pattern ':\s*any\b'
if ($hits) {
  Write-Error "FAIL: ': any' found under $Target"
  $hits | ForEach-Object { Write-Error "$($_.Path):$($_.LineNumber): $($_.Line.Trim())" }
  exit 1
}
Write-Host "PASS: no ': any' under $Target"

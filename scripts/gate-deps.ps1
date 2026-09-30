# Gate: deps must not use @opencode-ai/* (V1 line); every @opencode/* dep
# must be pinned EXACTLY to 2.0.20.
# Usage: pwsh scripts/gate-deps.ps1 [-Target packages/]
param([string]$Target = "packages/")
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$exclude = 'node_modules|dist|\.git'
$fail = $false
$pkgFiles = Get-ChildItem -Path $Target -Recurse -File -Filter package.json |
  Where-Object { $_.FullName -notmatch $exclude }
foreach ($pj in $pkgFiles) {
  $p = Get-Content $pj.FullName -Raw | ConvertFrom-Json
  foreach ($sec in @("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")) {
    $d = $p.$sec
    if ($null -eq $d) { continue }
    foreach ($k in $d.PSObject.Properties.Name) {
      $v = $d.$k
      if ($k -like "@opencode-ai/*") {
        Write-Error "$($pj.FullName): forbidden V1 dep $k@$v"
        $fail = $true
      }
      if ($k -like "@opencode/*" -and $v -ne "2.0.20") {
        Write-Error "$($pj.FullName): $k must be exact 2.0.20, found $v"
        $fail = $true
      }
    }
  }
}
if ($fail) { Write-Error "FAIL: dependency gate violations under $Target"; exit 1 }
Write-Host "PASS: deps clean under $Target"

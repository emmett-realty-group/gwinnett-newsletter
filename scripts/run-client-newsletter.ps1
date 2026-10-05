param(
  [Parameter(Mandatory = $true)]
  [string]$ClientSlug
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$clientRoot = Join-Path $root "clients\$ClientSlug"
$clientDataPath = Join-Path $clientRoot "newsletter-data.json"

if (!(Test-Path $clientRoot)) {
  throw "Client folder not found: $clientRoot"
}

$nodeExe = "node"
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
  $fallbackNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $fallbackNode) {
    $nodeExe = $fallbackNode
  } else {
    throw "Node.js was not found."
  }
}

& $nodeExe (Join-Path $root "scripts\refresh-client-market-data.js") $ClientSlug
if ($LASTEXITCODE -ne 0) {
  throw "Market refresh failed."
}

& $nodeExe (Join-Path $root "scripts\generate-client-issue.js") $ClientSlug
if ($LASTEXITCODE -ne 0) {
  throw "AI issue generation failed."
}

& $nodeExe (Join-Path $root "generate-client.js") $clientDataPath
if ($LASTEXITCODE -ne 0) {
  throw "Newsletter generation failed."
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\send-client-newsletter.ps1") -ClientSlug $ClientSlug
if ($LASTEXITCODE -ne 0) {
  throw "Newsletter send failed."
}

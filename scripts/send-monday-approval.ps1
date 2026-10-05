param(
  [switch]$ForceResend,
  [switch]$DryRun,
  [switch]$SkipMarketFetch,
  [string]$IssueDate
)
# Compatibility wrapper (legacy name). The active workflow has no approval step.
# It forwards to scripts/run-monday-newsletter.ps1, which emails ONLY dannyemmett@kw.com.
if ($SkipMarketFetch) { Write-Warning "-SkipMarketFetch is no longer supported; the Market Snapshot always uses live data." }
$forward = @{}
if ($ForceResend) { $forward.ForceResend = $true }
if ($DryRun) { $forward.DryRun = $true }
if (-not [string]::IsNullOrWhiteSpace($IssueDate)) { $forward.IssueDate = $IssueDate }
& (Join-Path $PSScriptRoot "run-monday-newsletter.ps1") @forward
exit $LASTEXITCODE

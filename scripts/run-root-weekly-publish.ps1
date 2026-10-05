param(
  [switch]$ForceResend,
  [switch]$DryRun,
  [string]$IssueDate
)
# Compatibility wrapper (legacy name) for the Danny-only Monday workflow.
$forward = @{}
if ($ForceResend) { $forward.ForceResend = $true }
if ($DryRun) { $forward.DryRun = $true }
if (-not [string]::IsNullOrWhiteSpace($IssueDate)) { $forward.IssueDate = $IssueDate }
& (Join-Path $PSScriptRoot "run-monday-newsletter.ps1") @forward
exit $LASTEXITCODE

param([string]$IssueDate)
# Sunday 6:00 PM Eastern: verify sources, select content, write Danny's Note, generate and host the cartoon,
# and save drafts/YYYY-MM-DD.json. This task never sends email or records delivery.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "automation-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir ("sunday-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))) -Append | Out-Null

function Import-SecretEnv([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return }
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($name, "User") }
  if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
  if (-not [string]::IsNullOrWhiteSpace($value)) { Set-Item -Path "Env:$name" -Value $value }
}

$exitCode = 0
try {
  Import-SecretEnv "OPENAI_API_KEY"
  $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { $nodeExe = Join-Path $env:ProgramFiles "nodejs\node.exe" }
  if (!(Test-Path $nodeExe)) { throw "Node.js was not found." }

  $nodeArgs = @((Join-Path $root "scripts\prestage-newsletter.js"))
  if (-not [string]::IsNullOrWhiteSpace($IssueDate)) { $nodeArgs += @("--issue-date", $IssueDate) }
  $ErrorActionPreference = "Continue"
  $output = & $nodeExe @nodeArgs 2>&1 | ForEach-Object { "$_" }
  $prestageExit = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  $output | ForEach-Object { Write-Host $_ }
  if ($prestageExit -ne 0) {
    Write-Warning "Sunday pre-stage needs attention (exit $prestageExit). Review the report in data/newsletter-reports. No email was sent."
    $exitCode = $prestageExit
  }
} catch {
  Write-Warning $_.Exception.Message
  $exitCode = 1
} finally {
  Stop-Transcript | Out-Null
}
exit $exitCode

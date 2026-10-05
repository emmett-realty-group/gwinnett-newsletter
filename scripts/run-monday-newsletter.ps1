param(
  [switch]$ForceResend,
  [switch]$DryRun,
  [string]$IssueDate
)
# Monday 8:00 AM Eastern: load Sunday's draft -> recheck -> verify -> email ONLY dannyemmett@kw.com.
# Never emails Stacy, subscribers, or contacts. On any failure Danny gets a short notice with no attachment.
# -DryRun prepares and verifies into drafts/ without publishing anything or sending any email.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDir = Join-Path $root "automation-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("monday-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))
Start-Transcript -Path $logPath -Append | Out-Null

function Get-NodeExe {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  )
  foreach ($candidate in $candidates) { if (Test-Path $candidate) { return $candidate } }
  throw "Node.js was not found."
}

# Loads a secret from the user/machine environment into this process only. Never printed.
function Import-SecretEnv([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return }
  $value = [Environment]::GetEnvironmentVariable($name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($name, "User") }
  if ([string]::IsNullOrWhiteSpace($value)) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
  if (-not [string]::IsNullOrWhiteSpace($value)) { Set-Item -Path "Env:$name" -Value $value }
}

# Last-resort failure notice if Node itself cannot run. Recipient is hard-coded.
function Send-EmergencyNotice([string]$subject, [string]$body) {
  try {
    $config = Get-Content -Raw (Join-Path $root "automation.local.json") | ConvertFrom-Json
    $password = [Environment]::GetEnvironmentVariable([string]$config.smtp.passwordEnv, "Process")
    if ([string]::IsNullOrWhiteSpace($password)) { Write-Warning "No SMTP password available; cannot send emergency notice."; return }
    $client = New-Object System.Net.Mail.SmtpClient([string]$config.smtp.host, [int]$config.smtp.port)
    $client.EnableSsl = $true
    $client.Credentials = New-Object System.Net.NetworkCredential([string]$config.smtp.username, ($password -replace "\s", ""))
    $message = New-Object System.Net.Mail.MailMessage([string]$config.smtp.fromAddress, "dannyemmett@kw.com", $subject, $body)
    $client.Send($message)
    $message.Dispose(); $client.Dispose()
  } catch {
    Write-Warning "Emergency notice could not be sent: $($_.Exception.Message)"
  }
}

$exitCode = 0
try {
  $config = Get-Content -Raw (Join-Path $root "automation.local.json") | ConvertFrom-Json
  Import-SecretEnv ([string]$config.smtp.passwordEnv)
  Import-SecretEnv "OPENAI_API_KEY"
  $nodeExe = Get-NodeExe

  $prepareArgs = @((Join-Path $root "scripts\prepare-monday-newsletter.js"))
  if ($ForceResend) { $prepareArgs += "--force-resend" }
  if ($DryRun) { $prepareArgs += "--dry-run" }
  if (-not [string]::IsNullOrWhiteSpace($IssueDate)) { $prepareArgs += @("--issue-date", $IssueDate) }

  # Windows PowerShell treats native stderr as errors under "Stop"; relax it only for this call.
  $ErrorActionPreference = "Continue"
  $output = & $nodeExe @prepareArgs 2>&1 | ForEach-Object { "$_" }
  $prepareExit = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  $output | ForEach-Object { Write-Host $_ }
  $reportLine = $output | Where-Object { $_ -like "REPORT *" } | Select-Object -Last 1
  if (-not $reportLine) { throw "Preparation did not produce a report (exit $prepareExit)." }
  $report = Get-Content -Raw ($reportLine.Substring(7)) | ConvertFrom-Json
  $iso = [string]$report.issueIsoDate

  $senderArgs = @((Join-Path $root "scripts\send-newsletter-to-danny.js"), "--issue-date", $iso)
  if ($DryRun) {
    Write-Host "Dry run finished with status $($report.deliveryStatus). No email was sent."
    if ($report.deliveryStatus -ne "DRY_RUN_VERIFIED") { $exitCode = 1 }
  } elseif ($report.duplicateSkipped -eq $true) {
    Write-Host "Already emailed to Danny for $iso. Use -ForceResend for a revised copy."
  } elseif ($report.failureNoticeNeeded -eq $true) {
    & $nodeExe @($senderArgs + "--failure-notice")
    if ($LASTEXITCODE -ne 0) { throw "Failure notice could not be sent." }
    $exitCode = 1
  } elseif ($report.shouldSendDannyEmail -eq $true) {
    if ($ForceResend) { $senderArgs += "--force-resend" }
    & $nodeExe @senderArgs
    if ($LASTEXITCODE -ne 0) { throw "Sending the verified newsletter to Danny failed." }
  } else {
    throw "Unexpected preparation status: $($report.deliveryStatus)"
  }
} catch {
  Write-Warning $_.Exception.Message
  if (-not $DryRun) {
    Send-EmergencyNotice "Gwinnett & Beyond Weekly - Monday run error" ("Hi Danny,`r`n`r`nThe Monday newsletter run stopped with an error, so nothing was attached:`r`n`r`n" + $_.Exception.Message + "`r`n`r`nLog: $logPath")
  }
  $exitCode = 1
} finally {
  Stop-Transcript | Out-Null
}
exit $exitCode

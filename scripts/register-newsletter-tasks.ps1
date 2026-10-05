param(
  [switch]$UsePassword,
  [switch]$InteractiveOnly,
  [switch]$DryRun
)
# Registers the Danny-only Monday newsletter task. Sunday image preparation is a Codex automation.
#   "Gwinnett & Beyond Weekly - Monday 8AM Email to Danny" Mondays 8:00 AM (computer local time, Eastern)
# Default: "Run whether user is logged on or not" without storing a password (S4U), wake the computer to run,
# start late if a run was missed, and retry up to 3 times. If Windows refuses S4U, re-run with -UsePassword
# (Windows stores the password securely; it never touches this project) or -InteractiveOnly.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

$tasks = @(
  @{ Name = "Gwinnett & Beyond Weekly - Monday 8AM Email to Danny"; Script = "scripts\run-monday-newsletter.ps1"; Day = "Monday"; Time = "08:00" }
)

if ($DryRun) {
  Write-Host "DRY RUN: no scheduled tasks will be registered, changed, enabled, disabled, or removed."
  foreach ($task in $tasks) {
    $scriptPath = Join-Path $root $task.Script
    if (!(Test-Path $scriptPath)) { throw "Missing task script: $scriptPath" }
    Write-Host "Would register: $($task.Name) | $($task.Day) $($task.Time) | $scriptPath"
  }
  Write-Host "Would retire obsolete task: Gwinnett & Beyond Weekly - Thursday Prestage"
  Write-Host "Would retire obsolete task: Gwinnett & Beyond Weekly - Sunday Source Check (replaced by Codex automation)"
  Write-Host "Would keep old disabled task disabled: Gwinnett & Beyond Weekly - Monday Email to Danny"
  exit 0
}

$credential = $null
if ($UsePassword) { $credential = Get-Credential -UserName $userId -Message "Windows password for running the newsletter tasks while logged out" }

foreach ($task in $tasks) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $root $task.Script)`"" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $task.Day -At $task.Time
  if ($UsePassword) {
    Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -User $userId `
      -Password $credential.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
    $mode = "Run whether logged on or not (stored by Windows)"
  } else {
    $logonType = if ($InteractiveOnly) { "Interactive" } else { "S4U" }
    try {
      $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType $logonType -RunLevel Limited
      Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
      $mode = if ($InteractiveOnly) { "Only when logged on" } else { "Run whether logged on or not (S4U, no stored password)" }
    } catch {
      Write-Warning "Windows would not register '$($task.Name)' as $logonType ($($_.Exception.Message)). Falling back to 'only when logged on'. Re-run with -UsePassword to run while logged out."
      $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
      Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
      $mode = "Only when logged on (fallback)"
    }
  }
  $info = Get-ScheduledTaskInfo -TaskName $task.Name
  Write-Host "Registered: $($task.Name)"
  Write-Host "  $($task.Day) $($task.Time) | $mode | wake to run, retry x3, start if missed"
  Write-Host "  Next run: $($info.NextRunTime)"
}

# Legacy tasks that must never run again.
foreach ($legacy in @("Gwinnett & Beyond Weekly - Monday Approval Email", "Codex Newsletter - Root Weekly Publish", "Gwinnett & Beyond Weekly - Thursday Prestage", "Gwinnett & Beyond Weekly - Sunday Source Check")) {
  $old = Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue
  if ($old) { Unregister-ScheduledTask -TaskName $legacy -Confirm:$false; Write-Host "Removed legacy task: $legacy" }
}

$oldMonday = Get-ScheduledTask -TaskName "Gwinnett & Beyond Weekly - Monday Email to Danny" -ErrorAction SilentlyContinue
if ($oldMonday) {
  Disable-ScheduledTask -TaskName $oldMonday.TaskName | Out-Null
  Write-Host "Kept old task disabled: $($oldMonday.TaskName)"
}

$tz = (Get-TimeZone).Id
if ($tz -ne "Eastern Standard Time") { Write-Warning "This computer's time zone is '$tz'. Task times are local time; set Windows to Eastern Time." }
Write-Host "Reminder: the computer must be powered on (sleep is OK, shut down is not) for the tasks to run."

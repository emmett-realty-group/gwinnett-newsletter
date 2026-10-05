param(
  [Parameter(Mandatory = $true)]
  [string]$ClientSlug
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$clientConfigPath = Join-Path $root "clients\$ClientSlug\client.json"
if (!(Test-Path $clientConfigPath)) {
  throw "Client config not found: $clientConfigPath"
}

$clientConfig = Get-Content -Raw $clientConfigPath | ConvertFrom-Json
$schedule = $clientConfig.automation.schedule
if ($null -eq $schedule) {
  throw "automation.schedule is missing in $clientConfigPath"
}

$taskName = "Codex Newsletter - $ClientSlug"
$runScript = Join-Path $root "scripts\run-client-newsletter.ps1"
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`" -ClientSlug `"$ClientSlug`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$scheduledDay = [System.Enum]::Parse([System.DayOfWeek], [string]$schedule.dayOfWeek, $true)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $scheduledDay -At $schedule.time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered scheduled task: $taskName"

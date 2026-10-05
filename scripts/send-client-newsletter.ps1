param(
  [Parameter(Mandatory = $true)]
  [string]$ClientSlug
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$clientRoot = Join-Path $root "clients\$ClientSlug"
$clientConfigPath = Join-Path $clientRoot "client.json"
$newsletterPath = Join-Path $clientRoot "newsletter-data.json"
$htmlPath = Join-Path $clientRoot "dist\newsletter.html"
$automationPath = Join-Path $clientRoot "automation.local.json"

if (!(Test-Path $automationPath)) {
  throw "Missing automation config: $automationPath. Copy automation.local.example.json to automation.local.json first."
}

$clientConfig = Get-Content -Raw $clientConfigPath | ConvertFrom-Json
$newsletter = Get-Content -Raw $newsletterPath | ConvertFrom-Json
$automationConfig = Get-Content -Raw $automationPath | ConvertFrom-Json

if (!(Test-Path $htmlPath)) {
  throw "Generated HTML not found: $htmlPath"
}

$passwordEnvName = [string]$automationConfig.smtp.passwordEnv
$smtpPassword = [Environment]::GetEnvironmentVariable($passwordEnvName, "User")
if ([string]::IsNullOrWhiteSpace($smtpPassword)) {
  $smtpPassword = [Environment]::GetEnvironmentVariable($passwordEnvName, "Machine")
}
if ([string]::IsNullOrWhiteSpace($smtpPassword)) {
  throw "Environment variable $passwordEnvName is not set."
}

$mailMessage = New-Object System.Net.Mail.MailMessage
$mailMessage.From = New-Object System.Net.Mail.MailAddress(
  [string]$automationConfig.smtp.fromAddress,
  [string]$automationConfig.smtp.fromDisplayName
)

foreach ($recipient in $automationConfig.recipients) {
  [void]$mailMessage.To.Add([string]$recipient)
}

$mailMessage.Subject = [string]$newsletter.subjectLine
$mailMessage.IsBodyHtml = $true
$mailMessage.BodyEncoding = [System.Text.Encoding]::UTF8
$mailMessage.SubjectEncoding = [System.Text.Encoding]::UTF8
$mailMessage.Body = Get-Content -Raw $htmlPath
[void]$mailMessage.Attachments.Add($htmlPath)

$smtpClient = New-Object System.Net.Mail.SmtpClient([string]$automationConfig.smtp.host, [int]$automationConfig.smtp.port)
$smtpClient.EnableSsl = [bool]$automationConfig.smtp.enableSsl
$smtpClient.Credentials = New-Object System.Net.NetworkCredential(
  [string]$automationConfig.smtp.username,
  $smtpPassword
)

try {
  $smtpClient.Send($mailMessage)
  Write-Host "Sent newsletter for $ClientSlug to $($automationConfig.recipients -join ', ')"
} finally {
  $mailMessage.Dispose()
  $smtpClient.Dispose()
}

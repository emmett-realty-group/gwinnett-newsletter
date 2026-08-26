param([Parameter(Mandatory=$true)][string]$IssueDate, [switch]$Live)
$arguments = @("$PSScriptRoot\prepare-hosted-approval.js", $IssueDate)
if ($Live) { $arguments += "--live" }
node @arguments
exit $LASTEXITCODE

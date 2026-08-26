param([Parameter(Mandatory=$true)][string]$IssueDate, [switch]$Live)
$env:LIVE_SEND_APPROVAL = if ($Live) { "true" } else { "false" }
node "$PSScriptRoot\send-monday-approval-node.js" $IssueDate
exit $LASTEXITCODE

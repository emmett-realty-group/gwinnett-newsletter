# Retired. This legacy script emailed whatever addresses were listed in automation.local.json and told the
# reader to forward to Stacy. The only permitted delivery is the verified Monday email to dannyemmett@kw.com:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-monday-newsletter.ps1
Write-Error "send-root-newsletter.ps1 is retired. Use scripts\run-monday-newsletter.ps1 (Danny-only)."
exit 1

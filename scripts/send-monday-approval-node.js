"use strict";
// Compatibility wrapper (legacy name). Forwards to scripts/send-newsletter-to-danny.js, which can only email
// dannyemmett@kw.com. The old --raw-recipient/--raw-subject/--raw-body/--raw-attachment options were removed
// because they allowed sending to any address.
const path = require("path");
const { spawnSync } = require("child_process");
const forwarded = process.argv.slice(2);
if (forwarded.some((arg) => /^--raw-/.test(arg))) {
  console.error("Raw sending was removed. This project can only email the verified newsletter to dannyemmett@kw.com.");
  process.exit(1);
}
const result = spawnSync(process.execPath, [path.join(__dirname, "send-newsletter-to-danny.js"), ...forwarded], { stdio: "inherit" });
process.exit(result.status === null ? 1 : result.status);

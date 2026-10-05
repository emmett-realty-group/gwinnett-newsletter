"use strict";
// Retired. Successful Danny-only deliveries are now recorded automatically by scripts/send-newsletter-to-danny.js
// immediately after the SMTP server accepts the message. Recording by hand could mark an issue as sent when it
// was not, which would block the next real send, so this script no longer changes anything.
console.error("record-monday-approval-delivery.js is retired; delivery is recorded by scripts/send-newsletter-to-danny.js.");
process.exit(1);

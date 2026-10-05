"use strict";
// Retired. This older helper created next week's issue by copying the previous issue's data, which could carry
// old content forward. Use the verified workflow instead:
//   node scripts/prestage-newsletter.js --issue-date YYYY-MM-DD      (pick content and cartoon into drafts/)
//   node scripts/prepare-monday-newsletter.js --dry-run --issue-date YYYY-MM-DD
console.error("prepare-root-issue.js is retired. Use scripts/prestage-newsletter.js and scripts/prepare-monday-newsletter.js.");
process.exit(1);

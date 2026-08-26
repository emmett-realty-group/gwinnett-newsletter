# Gwinnett & Beyond Weekly

This repository is the permanent source of truth for the newsletter. Historical July 2026 issues and assets remain intact. The active system uses the root dated JSON file, `newsletter-template.html`, and `generate.js`.

## September recovery issue

```powershell
node scripts/prepare-root-issue.js 2026-09-02
node generate.js
node scripts/verify-root-newsletter.js --issue=2026-09-02
npm run test:recovery
```

Generated output is written to `dist/newsletter.html` and a permanent dated file. If dated content changes, the generator adds `-v2`, `-v3`, and so on rather than overwriting a prior dated revision. `index.html` is the latest browser preview.

## Monday workflow

Schedule this command for Mondays at 8:00 AM Eastern:

```powershell
node scripts/prepare-monday-newsletter.js
```

For a deterministic local rehearsal:

```powershell
node scripts/prepare-monday-newsletter.js --run-date=2026-08-31
```

The script calculates Wednesday as Monday + 2 calendar days, determines the numbered-week rotation, requires researched dated content, generates HTML, verifies it, and creates a secure approval record. It never sends to subscribers or automatically sends to an assistant.

## Approval

`newsletter-approval.js prepare` generates a cryptographically random per-issue token and stores only its SHA-256 hash. The record binds approval to the issue date, Danny's configured approval address, and the exact HTML SHA-256 hash.

```powershell
node scripts/newsletter-approval.js prepare --issue=2026-09-02
node scripts/newsletter-approval.js approve --issue=2026-09-02 --token=TOKEN_SHOWN_ONCE
node scripts/newsletter-approval.js status --issue=2026-09-02
```

Statuses are `DRAFT`, `SENT_FOR_APPROVAL`, `APPROVED`, and `HANDED_OFF`. Approval ends at `APPROVED`. It performs no email operation and leaves the exact approved HTML available for a later, separate handoff.

The local endpoint is optional:

```powershell
node scripts/approval-endpoint.js
```

Do not expose it directly to the internet. A production deployment must add HTTPS, trusted proxy/host controls, request throttling, and secure state storage appropriate to its host.

## Approval email and SMTP

Dry run is the default and prints the complete approval copy:

```powershell
.\scripts\send-monday-approval.ps1 -IssueDate 2026-09-02
```

Live approval mail requires the explicit `-Live` switch plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM` / `SMTP_SECURE`. Install the optional Node transport with `npm install`. Never commit credentials. The approval email goes only to `newsletter.approvalRecipient`; it contains the review checklist and Command compliance reminder.

## Configuration and safety

Edit `automation.local.json` to change `newsletter.handoffRecipient`; no source change is required. Handoff remains a separate explicit action. `newsletter.subscriberDistributionEnabled` and `newsletter.automaticAssistantHandoffEnabled` must remain `false`, and verification fails if subscriber distribution is enabled.

No subscriber-distribution implementation exists in this repository. Copy verified HTML into the authorized email platform only after approval and final compliance checks.

See `docs/master-newsletter-prompt.md` for permanent structure, rotation, editorial, CTA, and output rules.

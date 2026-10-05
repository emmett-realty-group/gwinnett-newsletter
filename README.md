# Gwinnett & Beyond Weekly Newsletter Builder

The finished email is `dist/newsletter.html`. `index.html` is an identical browser-preview copy.

The master weekly build prompt lives at [docs/master-newsletter-prompt.md](C:/Users/danny/Documents/Codex/2026-05-11/where-are-my-chats/docs/master-newsletter-prompt.md).

## Selling this to other agents

Paid/client newsletters should live under `clients/`, one folder per agent, so their brand, assets, links, issue archive, and send schedule stay separate from Gwinnett & Beyond and from each other.

Start with:

- `docs/agent-newsletter-business-process.md`
- `docs/new-agent-action-checklist.md`
- `clients/_template/`

The core ownership rule is: the client owns their brand, list, and supplied content; Danny owns the generator, reusable templates, workflow, automations, and system improvements.

## Build this week's newsletter

1. Open `newsletter-data.json`.
2. Replace the weekly text, links, and image URLs.
3. Write a topical quick personal note in Danny's voice. Use the current week's real local/seasonal context and avoid reusing a generic opener.
4. Add exactly two rotating feature sections using the default week schedule.
5. Make Cartoon Corner different from every prior issue. Do not reuse the same cartoon image, scene, caption, or image prompt.
6. Advance `themeIndex` and `footerImageIndex` by one. Both indexes start at `0`; they wrap automatically.
7. Double-click `build-newsletter.cmd`. If Node.js is already installed, you can instead run `node generate.js`.

## Personal note rule

Each quick note should sound current and personal, like Danny is checking in with neighbors that week.

- Use a real local or seasonal hook, such as school starting, a holiday week, weather, community rhythm, or a verified nearby event.
- Keep the tone warm, plainspoken, and conversational.
- Include one natural reader question when it fits.
- Do not reuse the same generic opener from prior weeks.

## Rotating feature schedule

Default rotation:

- Week 1: Local Business Spotlight + Homeowner / Seasonal Home Tip
- Week 2: Recipe + Local Community Event
- Week 3: Local History + Seasonal Home Maintenance
- Week 4: Restaurant, Coffee Shop, or Community Spotlight + Weekend Idea
- Fifth Wednesday: an appropriate non-repetitive combination from the master prompt

The active issue stores these in `rotatingFeatures`, with exactly two enabled feature objects unless Danny deliberately overrides the issue.

## Weekly freshness rule

Every issue needs fresh rotating content and a fresh cartoon.

- Homeowner tips and seasonal maintenance features should use a new topic, title, checklist, and practical angle when selected.
- The cartoon should use a new image or concept, caption, scene, and image prompt.
- [scripts/verify-root-newsletter.js](C:/Users/danny/Documents/Codex/2026-05-11/where-are-my-chats/scripts/verify-root-newsletter.js) checks the active `newsletter-data.json` against prior files in `issues/` and fails if rotating feature titles or cartoon details repeat.

## Master subject-line rule

Gwinnett & Beyond now uses one enforced short subject line for every issue:

- `A Short Weekly Update`

The generator applies that rule automatically and overwrites any different `subjectLine` value in `newsletter-data.json`.

## Weekly newsletter automation (Danny-only)

**Generate -> Verify -> Email Danny.** Nothing is ever sent to Stacy, subscribers, or contacts. The only address the code can email is `dannyemmett@kw.com` (enforced in `scripts/lib/common.js` and `scripts/send-newsletter-to-danny.js`).

### Schedule

| When | Task | What happens |
| --- | --- | --- |
| Sunday 6:00 PM | GitHub Actions | Runs pre-stage, creates the required cartoon with the OpenAI Images API, uploads it to Cloudinary, persists the dated draft, and alerts only Danny if required content is still missing. |
| Monday 8:00 AM | GitHub Actions | Loads Sunday's persisted draft, refreshes market data, re-verifies every source and cartoon URL, generates and verifies the HTML, archives it, and emails the attachment only to Danny. On failure Danny gets a short needs-attention notice with no attachment. |
| Wednesday 12:00 PM | Manual in Keller Williams Command | Danny imports the verified HTML and schedules or sends the subscriber newsletter. |

### One-time setup

1. GitHub Actions secret `GWINNETT_SMTP_PASSWORD` = Gmail app password for `dannyemmett@gmail.com`.
2. GitHub Actions secret `OPENAI_API_KEY` = API project key with image-generation access and billing.
3. Keep both workflows on the default branch: `.github/workflows/newsletter-sunday.yml` and `.github/workflows/newsletter-monday.yml`.

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-newsletter-tasks.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-newsletter-tasks.ps1
```

If Windows refuses, re-run with `-UsePassword` (Windows stores the password; this project never does).

The cloud Sunday workflow explicitly enables the OpenAI Images API only for cartoon generation. Local Monday preparation never calls the image API. Secrets must remain in GitHub Actions or the local environment and must never be committed.

```powershell
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "<your API key>", "User")
```

If the Images API remains unavailable, keep the pipeline blocked and use `scripts/publish-cartoon.js` with an approved AI-generated image. Do not weaken the cartoon verification gate.

### Content sources

- `content/homeowner-tips.json`: 40 sourced, seasonal homeowner tips. Each one has its own cartoon concept and is used once, ever.
- `content/event-queue.json`: verified upcoming events. **Keep at least 2-3 future events here.** The Sunday check warns when it runs low. An event qualifies only if it ends after the issue date, starts within 31 days, has never been featured, has its own event page, and that page loads and names the event (plus its date, or a human verification within 30 days).
- `content/event-feeds.json`: optional official iCalendar feeds. They're disabled until confirmed with `node scripts/check-event-feeds.js`.
- Market data: Realtor.com county CSV, downloaded live every Monday.

### Useful commands

```text
powershell -File scripts\run-monday-newsletter.ps1 -DryRun -IssueDate 2026-10-07   (prepare + verify, no publish, no email)
powershell -File scripts\run-monday-newsletter.ps1 -IssueDate 2026-10-07 -ForceResend   (revised copy to Danny)
node scripts\prestage-newsletter.js --issue-date 2026-10-07 --no-cartoon-generation
scripts\run-sunday-prestage.ps1 -IssueDate 2026-10-07   (manual source-check fallback only; Codex owns the scheduled Sunday run)
node scripts\publish-cartoon.js --issue-date 2026-10-07 --file C:\path\image.png   (manually made cartoon)
node scripts\send-newsletter-to-danny.js --issue-date 2026-10-07 --dry-run   (builds the email as .eml, sends nothing)
node --test tests\pipeline.test.js
```

To change an issue, edit `drafts/YYYY-MM-DD.json` (set `"author": "danny"` on `dannysNote` to keep your own note) and re-run with `-ForceResend`.

### Safety behavior

- Dry runs and failed runs never modify `issues/`, `newsletter-data.json`, `dist/newsletter.html`, or `index.html`.
- Sunday pre-stage sends only Danny a needs-attention alert when its final verification still fails; it never sends newsletter HTML or records delivery.
- The sender refuses to send unless the report passed verification, the attachment's SHA-256 matches what was verified, and the issue hasn't already been emailed (unless `--force-resend`).
- Duplicate checks compare every editorial sentence, tip, event, and cartoon against all archived issues, including legacy fields.
- Reports: `data/newsletter-reports/`. Logs: `automation-logs/`. Attachments: `dist/newsletter-attachments/`.
- Legacy names (`send-monday-approval.ps1`, `send-monday-approval-node.js`, `register-monday-approval-task.ps1`, `run-root-weekly-publish.ps1`) forward to the new scripts. `send-root-newsletter.ps1`, `register-root-weekly-publish-task.ps1`, `prepare-root-issue.js`, and `record-monday-approval-delivery.js` are retired.

The generator creates:

- `dist/newsletter.html` as the latest issue
- A separately dated HTML file such as `dist/gwinnett-and-beyond-wednesday-july-15-2026.html`
- `index.html` as the local browser preview

Each dated HTML file is a complete standalone email file beginning with `<!DOCTYPE html>` and can be retained as the permanent archive or uploaded to Command.

## Cloudinary image hosting

`upload-cloudinary.js` uploads the five footer images and the current cartoon, then writes their public HTTPS URLs into `newsletter-data.json`.

Only the Cloud Name and an **unsigned upload preset** are used. API keys and API secrets are not stored in this project.

## Rotation indexes

Background themes:

- `0` Light Blue
- `1` Soft Peach
- `2` Pale Green
- `3` Soft Lavender
- `4` Light Cream

The five Around Gwinnett footer designs rotate automatically:

- Issue 1: footer 1
- Issue 2: footer 2
- Issue 3: footer 3
- Issue 4: footer 4
- Issue 5: footer 5
- Issue 6: footer 1 again

Set `footerImageIndex` to `0` through `4`; the generator wraps the rotation automatically. Local image paths support the browser preview. Before sending email, replace them with public hosted image URLs.

## Copy into Keller Williams Command

1. Generate the newsletter.
2. Open `dist/newsletter.html` in a plain-text editor and select all.
3. Copy only the HTML, beginning with `<!DOCTYPE html>`.
4. Paste it into Command's HTML/source editor.
5. Confirm the cartoon and footer image URLs are hosted and publicly accessible.
6. Resolve any market or source verification reminders only after checking the cited references.
7. Verify the event page, date, time, location, buttons, brokerage address, and unsubscribe footer.
8. Send a test to Danny and check it on desktop and mobile before scheduling Wednesday at 12:00 PM.

## Permanent market coverage

The newsletter's primary market is **Gwinnett County, Georgia**.

The surrounding research area includes:

- Barrow County
- Walton County
- Rockdale County
- DeKalb County
- Jackson County

Research should lead with Gwinnett and use the surrounding counties when they provide a useful comparison, local story, event, homeowner issue, or referral opportunity. It is not necessary to mention all six counties every week.

The detailed source hierarchy, preferred metrics, and research rules are stored in `market-research-config.json`.

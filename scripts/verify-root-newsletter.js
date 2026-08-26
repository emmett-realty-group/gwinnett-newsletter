const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const issueArg = process.argv.find(x => x.startsWith("--issue="));
const pointer = JSON.parse(fs.readFileSync(path.join(root, "newsletter-data.json"), "utf8"));
const iso = issueArg ? issueArg.split("=")[1] : pointer.issueDateIso;
const data = JSON.parse(fs.readFileSync(path.join(root, `${iso}.json`), "utf8"));
const htmlPath = path.join(root, "dist", `gwinnett-and-beyond-${iso}.html`);
if (!fs.existsSync(htmlPath)) throw new Error(`Missing generated output: ${htmlPath}`);
const html = fs.readFileSync(htmlPath, "utf8");
const failures = [];
const requireText = (label, value) => { if (!html.includes(value)) failures.push(`missing ${label}`); };
requireText("doctype", "<!DOCTYPE html>"); requireText("subject", "<title>A Short Weekly Update</title>"); requireText("issue date", data.issueDate);
requireText("Danny's Note", "DANNY'S NOTE"); requireText("Market Snapshot", "MARKET SNAPSHOT");
for (const f of data.features) { requireText(`feature type ${f.type}`, f.type.toUpperCase()); requireText(`feature title ${f.title}`, f.title); }
requireText("Cartoon Corner", "CARTOON CORNER"); requireText("Referral / Share", "Know someone who would enjoy this update?");
for (const link of ["tel:+14047718629", "sms:+14047718629", "mailto:dannyemmett@kw.com", "https://emmettrealtygroup.com/equity-report", "https://calendar.app.google/TkqULC8rNLSWrhjt5"]) requireText(`contact link ${link}`, link);
const forbidden = [/monthly quiz/i, /gift.?card/i, /winner announcement/i, /Cathy Jordan/i, /\[INSERT\b/i, /Needs verification/i, /August is wrapping up/i, /Command compliance/i, /confirm (the )?brokerage footer/i, /subscriber distribution enabled/i, /{{[^}]+}}/];
for (const pattern of forbidden) if (pattern.test(html)) failures.push(`forbidden subscriber-facing content: ${pattern}`);
if (data.issueDateIso.startsWith("2026-09") && /August is wrapping up/i.test(data.dannysNote)) failures.push("stale Danny's Note date language");
const mentioned = data.dannysNote.toLowerCase();
if (mentioned.includes("business spotlight") && !data.features.some(f => /business spotlight/i.test(f.type))) failures.push("Danny's Note references absent business spotlight");
if (!/^<!DOCTYPE html>[\s\S]*<\/html>\s*$/i.test(html)) failures.push("output is not complete HTML");
const config = JSON.parse(fs.readFileSync(path.join(root, "automation.local.json"), "utf8"));
if (config.newsletter.subscriberDistributionEnabled !== false) failures.push("subscriber distribution must remain disabled");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(JSON.stringify({ verified: true, issue: iso, checks: 13, subscriberDistributionEnabled: false }, null, 2));

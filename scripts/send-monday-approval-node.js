const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "automation.local.json"), "utf8"));
const issue = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(issue || "")) throw new Error("Usage: node scripts/send-monday-approval-node.js YYYY-MM-DD");
const record = JSON.parse(fs.readFileSync(path.join(root, ".newsletter-state", "approvals", `${issue}.json`), "utf8"));
if (record.status !== "SENT_FOR_APPROVAL") throw new Error("Issue is not ready for approval email");
const featureData = JSON.parse(fs.readFileSync(path.join(root, `${issue}.json`), "utf8"));
const checklist = ["Review all copy and links", "Confirm market figures and source", "Confirm brokerage footer, physical mailing address, fair housing language, email preferences, and unsubscribe link in Command before subscriber distribution"];
const hosted = config.newsletter.approvalBaseUrl;
const token = process.env.NEWSLETTER_APPROVAL_TOKEN;
const approveUrl = hosted && token ? `${hosted.replace(/\/$/, "")}/approve?issue=${encodeURIComponent(issue)}&token=${encodeURIComponent(token)}` : "";
const text = `Gwinnett & Beyond Weekly approval\nIssue: ${featureData.issueDate}\nFeatures: ${featureData.features.map(x => x.type).join("; ")}\n\n${checklist.map(x => `- ${x}`).join("\n")}\n\n${approveUrl ? `APPROVE NEWSLETTER: ${approveUrl}` : "Hosted approval is not configured; use the local approval command."}\n\nApproval ends at APPROVED. It does not email an assistant or subscribers.`;
if (process.env.LIVE_SEND_APPROVAL !== "true") { console.log(text); console.log("\nDRY RUN: no email sent."); process.exit(0); }
if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASS are required");
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: config.newsletter.approvalRecipient, subject: `Approval needed: Gwinnett & Beyond Weekly — ${featureData.issueDate}`, text }).then(info => console.log(`Approval email sent: ${info.messageId}`)).catch(error => { console.error(error.message); process.exit(1); });

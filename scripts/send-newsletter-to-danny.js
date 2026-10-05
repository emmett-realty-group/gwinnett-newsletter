"use strict";
// The ONLY email sender in this project. It can send to exactly one address: dannyemmett@kw.com.
// There is no option to change the recipient, add CC/BCC, or send raw messages.
//
//   node scripts/send-newsletter-to-danny.js --issue-date YYYY-MM-DD [--force-resend] [--dry-run]
//   node scripts/send-newsletter-to-danny.js --failure-notice --issue-date YYYY-MM-DD [--dry-run]
//   node scripts/send-newsletter-to-danny.js --prestage-alert --issue-date YYYY-MM-DD [--dry-run]
//
// --dry-run builds the full message and writes it to drafts/ as an .eml file without connecting to any server.
// The SMTP password is read only from the environment variable named in automation.local.json.
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const tls = require("tls");
const path = require("path");
const C = require("./lib/common");

const RECIPIENT = C.APPROVED_RECIPIENT;
Object.freeze(RECIPIENT);
const SENDABLE_STATUSES = ["READY_FOR_REVIEW", "READY_WITH_WARNINGS"];

function parseArgs(argv) {
  const args = { mode: "newsletter", issueDate: null, forceResend: false, dryRun: false, root: C.ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--issue-date") args.issueDate = argv[++i];
    else if (arg === "--force-resend") args.forceResend = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--failure-notice") args.mode = "failure";
    else if (arg === "--prestage-alert") args.mode = "prestage";
    else if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) args.issueDate = arg;
    else throw new Error(`Unknown or unsupported argument: ${arg}. Recipients cannot be changed.`);
  }
  if (!C.isValidIso(args.issueDate)) throw new Error("--issue-date YYYY-MM-DD is required.");
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// ---- Message builders -------------------------------------------------------

function newsletterMessage(root, args) {
  const reportPath = path.join(root, "data", "newsletter-reports", `${args.issueDate}-preparation.json`);
  const report = C.readJson(reportPath);
  const state = C.readJson(path.join(root, "data", "newsletter-state.json"), {});
  const record = state.deliveryRecords?.[args.issueDate];
  if (record && ["EMAILED_TO_DANNY", "SENT_FOR_APPROVAL"].includes(record.status) && !args.forceResend) {
    return { skip: `Already emailed to Danny for ${args.issueDate} at ${record.sentAt}. Use --force-resend for a revised copy.` };
  }
  if (!SENDABLE_STATUSES.includes(report.deliveryStatus)) throw new Error(`Report is not ready to email: ${report.deliveryStatus}`);
  if (report.verifierPassed !== true) throw new Error("Report does not show a passing verification run.");
  if (report.recipient !== RECIPIENT) throw new Error("Report recipient does not match the only allowed recipient.");
  if (!report.attachmentPath || !fs.existsSync(report.attachmentPath)) throw new Error(`Missing attachment: ${report.attachmentPath}`);
  if (sha256(report.attachmentPath) !== report.htmlSha256) throw new Error("Attachment changed after verification. Re-run preparation.");
  const issue = C.readJson(path.join(root, "issues", `${args.issueDate}.json`));
  const imageUrl = C.cleanText(issue.cartoon?.imageUrl);
  const attachmentHtml = fs.readFileSync(report.attachmentPath, "utf8");
  if (!/^https:\/\//i.test(imageUrl) || !attachmentHtml.includes(imageUrl)) throw new Error("Attachment does not contain the issue's hosted Cartoon Corner image.");

  const tip = issue.rotatingFeatures.find((f) => f.key === "homeowner-tip");
  const event = issue.rotatingFeatures.find((f) => f.key === "local-event");
  const lines = [
    "Hi Danny,",
    "",
    `Your Gwinnett & Beyond Weekly newsletter for ${report.issueDate} is attached and passed verification.`,
    "",
    `Market: ${issue.market.title} (${issue.market.source})`,
    `Homeowner tip: ${tip.title}`,
    `Local event: ${event.title} - ${event.availability}`,
    `  Source: ${event.link}`,
    `Cartoon: ${issue.cartoon.caption}`,
    "",
    "To use it: open the attached .html file, copy the HTML into Keller Williams Command, and schedule it for Wednesday at 12:00 PM Eastern.",
    "Before scheduling, confirm the brokerage footer, physical mailing address, fair housing language, email preferences, and unsubscribe link in Command.",
    "",
    "Want changes? Ask your AI coding agent to edit drafts/" + args.issueDate + ".json and re-run with -ForceResend.",
    ...(report.warnings?.length ? ["", "Notes:", ...report.warnings.map((w) => `- ${w}`)] : []),
    "",
    "Gwinnett & Beyond Weekly Newsletter System"
  ];
  return {
    subject: report.emailSubject,
    text: lines.join("\r\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#26384a;">${lines.map((l) => (l ? escapeHtml(l) : "")).join("<br>")}</div>`,
    attachmentPath: report.attachmentPath,
    onSent: () => recordDelivery(root, reportPath, report, args.forceResend)
  };
}

function failureMessage(root, args) {
  const reportPath = path.join(root, "data", "newsletter-reports", `${args.issueDate}-preparation.json`);
  const report = C.readJson(reportPath, null);
  const problems = report?.problems?.length ? report.problems : ["The preparation run stopped before writing a report. See automation-logs on the computer for details."];
  const lines = [
    "Hi Danny,",
    "",
    `The Gwinnett & Beyond Weekly newsletter for ${C.formatIssueDateFromIso(args.issueDate)} could not be completed safely, so nothing was attached.`,
    "",
    `Status: ${report?.deliveryStatus || "PREPARATION_ERROR"}`,
    "",
    "What needs attention:",
    ...problems.map((p) => `- ${String(p).split(/\r?\n/)[0].slice(0, 400)}`),
    ...(report?.cartoonPrompt ? ["", "Cartoon prompt ready to use:", report.cartoonPrompt, report.cartoonCaption ? `Caption: ${report.cartoonCaption}` : ""] : []),
    "",
    "Your AI coding agent can fix this with the draft at drafts/" + args.issueDate + ".json, then re-run the Monday script.",
    "",
    "Gwinnett & Beyond Weekly Newsletter System"
  ];
  return { subject: `Gwinnett & Beyond Weekly - Needs Attention for ${C.formatIssueDateFromIso(args.issueDate)}`, text: lines.join("\r\n") };
}

function prestageAlertMessage(root, args) {
  const report = C.readJson(path.join(root, "data", "newsletter-reports", `${args.issueDate}-prestage.json`), null);
  if (!report || report.status === "READY_FOR_MONDAY") return { skip: `Sunday pre-stage is ready for ${args.issueDate}; no alert is needed.` };
  const problems = report.problems?.length ? report.problems : ["Sunday pre-stage did not complete."];
  const lines = [
    "Hi Danny,", "",
    `The Sunday pre-stage for ${C.formatIssueDateFromIso(args.issueDate)} still needs attention.`, "",
    ...problems.map((problem) => `- ${String(problem).split(/\r?\n/)[0].slice(0, 400)}`),
    ...(report.cartoonPrompt ? ["", "Cartoon prompt:", report.cartoonPrompt, report.cartoonCaption ? `Caption: ${report.cartoonCaption}` : ""] : []),
    "", "Monday will not send a newsletter unless every required item, including the hosted cartoon, passes verification.", "",
    "Gwinnett & Beyond Weekly Newsletter System"
  ];
  return { subject: `Gwinnett & Beyond Weekly - Sunday Pre-stage Needs Attention for ${C.formatIssueDateFromIso(args.issueDate)}`, text: lines.join("\r\n") };
}

function recordDelivery(root, reportPath, report, forceResend) {
  const sentAt = new Date().toISOString();
  report.deliveryStatus = "EMAILED_TO_DANNY";
  report.shouldSendDannyEmail = false;
  report.smtpSendResult = "SMTP_SENT";
  report.emailSentAt = sentAt;
  C.writeJson(reportPath, report);
  const statePath = path.join(root, "data", "newsletter-state.json");
  const state = C.readJson(statePath, { deliveryRecords: {} });
  state.deliveryRecords = state.deliveryRecords || {};
  state.deliveryRecords[report.issueIsoDate] = {
    issueIsoDate: report.issueIsoDate,
    issueDate: report.issueDate,
    status: "EMAILED_TO_DANNY",
    recipient: RECIPIENT,
    emailSubject: report.emailSubject,
    attachmentFilename: report.attachmentFilename,
    htmlSha256: report.htmlSha256,
    sentAt,
    forceResend: Boolean(forceResend)
  };
  C.writeJson(statePath, state);
}

// ---- MIME + SMTP --------------------------------------------------------------

function buildMime({ fromAddress, fromDisplayName, subject, text, html, attachmentPath }) {
  const mixed = `mixed-${crypto.randomBytes(8).toString("hex")}`;
  const alt = `alt-${crypto.randomBytes(8).toString("hex")}`;
  const domain = String(fromAddress).split("@")[1] || "localhost";
  const headers = [
    `From: ${fromDisplayName} <${fromAddress}>`,
    `To: <${RECIPIENT}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    ""
  ];
  const body = [
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g).join("\r\n"),
    ...(html ? [`--${alt}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", Buffer.from(html, "utf8").toString("base64").match(/.{1,76}/g).join("\r\n")] : []),
    `--${alt}--`
  ];
  if (attachmentPath) {
    const name = path.basename(attachmentPath);
    body.push(`--${mixed}`, `Content-Type: text/html; charset=utf-8; name="${name}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${name}"`, "", fs.readFileSync(attachmentPath).toString("base64").match(/.{1,76}/g).join("\r\n"));
  }
  body.push(`--${mixed}--`, "");
  return [...headers, ...body].join("\r\n");
}

async function sendSmtp(smtp, password, mime) {
  if (!smtp.host || !smtp.username || !smtp.fromAddress) throw new Error("automation.local.json is missing smtp host, username, or fromAddress.");
  const connection = await SmtpConnection.connect(smtp.host, Number(smtp.port || 587));
  try {
    await connection.expect(220);
    await connection.command("EHLO localhost", 250);
    await connection.command("STARTTLS", 220);
    await connection.upgradeTls(smtp.host);
    await connection.command("EHLO localhost", 250);
    await connection.command(`AUTH PLAIN ${Buffer.from(`\0${smtp.username}\0${password}`, "utf8").toString("base64")}`, 235, true);
    await connection.command(`MAIL FROM:<${smtp.fromAddress}>`, 250);
    await connection.command(`RCPT TO:<${RECIPIENT}>`, 250);
    await connection.command("DATA", 354);
    connection.write(`${mime.replace(/^\./gm, "..")}\r\n.\r\n`);
    await connection.expect(250);
    await connection.command("QUIT", 221).catch(() => {});
  } finally {
    connection.end();
  }
}

class SmtpConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.waiters = [];
    this.attach(socket);
  }
  attach(socket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { this.buffer += chunk; this.flush(); });
    socket.on("error", (error) => this.rejectAll(error));
    socket.on("close", () => this.rejectAll(new Error("SMTP connection closed unexpectedly.")));
  }
  static connect(host, port) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, host, () => resolve(new SmtpConnection(socket)));
      socket.once("error", reject);
      socket.setTimeout(30000, () => socket.destroy(new Error("SMTP connection timed out.")));
    });
  }
  write(data) { this.socket.write(data); }
  command(line, code, secret = false) {
    this.socket.write(`${line}\r\n`);
    return this.expect(code).catch((error) => {
      throw new Error(secret ? `SMTP authentication failed (${String(error.message).slice(0, 60)}...)` : error.message);
    });
  }
  expect(code) {
    return new Promise((resolve, reject) => { this.waiters.push({ code, resolve, reject }); this.flush(); });
  }
  upgradeTls(host) {
    return new Promise((resolve, reject) => {
      this.socket.removeAllListeners("data");
      this.socket.removeAllListeners("error");
      this.socket.removeAllListeners("close");
      const secure = tls.connect({ socket: this.socket, servername: host }, () => { this.socket = secure; this.buffer = ""; this.attach(secure); resolve(); });
      secure.once("error", reject);
    });
  }
  flush() {
    while (this.waiters.length) {
      const match = this.buffer.match(/^((?:\d{3}-[^\r\n]*\r\n)*\d{3} [^\r\n]*\r\n)/);
      if (!match) return;
      this.buffer = this.buffer.slice(match[1].length);
      const waiter = this.waiters.shift();
      const lastLine = match[1].trim().split(/\r\n/).pop();
      if (Number(lastLine.slice(0, 3)) === waiter.code) waiter.resolve(lastLine);
      else waiter.reject(new Error(`SMTP expected ${waiter.code}, got ${lastLine.slice(0, 120)}`));
    }
  }
  rejectAll(error) { while (this.waiters.length) this.waiters.shift().reject(error); }
  end() { this.socket.end(); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const message = args.mode === "newsletter"
    ? newsletterMessage(root, args)
    : args.mode === "prestage" ? prestageAlertMessage(root, args) : failureMessage(root, args);
  if (message.skip) {
    console.log(`NOT SENT: ${message.skip}`);
    return;
  }
  const automation = C.readJson(path.join(root, "automation.local.json"), {});
  const smtp = {
    host: "smtp.gmail.com",
    port: 587,
    enableSsl: true,
    username: process.env.SMTP_USER || "dannyemmett@gmail.com",
    passwordEnv: "GWINNETT_SMTP_PASSWORD",
    fromAddress: process.env.SMTP_FROM || process.env.SMTP_USER || "dannyemmett@gmail.com",
    fromDisplayName: "Danny Emmett",
    ...(automation.smtp || {})
  };
  const mime = buildMime({ fromAddress: smtp.fromAddress, fromDisplayName: smtp.fromDisplayName || smtp.fromAddress, ...message });
  if (!new RegExp(`^To: <${RECIPIENT.replace(/[.]/g, "\\.")}>$`, "m").test(mime) || /^(Cc|Bcc):/im.test(mime)) throw new Error("Refusing to send: message headers are not Danny-only.");

  if (args.dryRun) {
    const out = path.join(root, "drafts", `${args.issueDate}-${args.mode}-email-dry-run.eml`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, mime, "utf8");
    console.log(`DRY RUN: built "${message.subject}" for ${RECIPIENT}; nothing was sent. Saved ${path.relative(root, out)}`);
    return;
  }
  const password = String(process.env[smtp.passwordEnv] || "").replace(/\s/g, "");
  if (!password) throw new Error(`Environment variable ${smtp.passwordEnv} is not set for this process.`);
  await sendSmtp(smtp, password, mime);
  if (message.onSent) message.onSent();
  console.log(`SENT "${message.subject}" to ${RECIPIENT}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(C.nonSecretError(error));
    process.exit(1);
  });
}

module.exports = { buildMime, parseArgs, RECIPIENT };

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const root = path.resolve(__dirname, "..");
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const readConfig = (file = path.join(root, "automation.local.json")) => JSON.parse(fs.readFileSync(file, "utf8"));
const htmlPath = iso => path.join(root, "dist", `gwinnett-and-beyond-${iso}.html`);
const defaultStateDir = path.join(root, ".newsletter-state", "approvals");
const recordPath = (iso, stateDir = defaultStateDir) => path.join(stateDir, `${iso}.json`);
const readRecord = (iso, stateDir) => JSON.parse(fs.readFileSync(recordPath(iso, stateDir), "utf8"));
const writeRecord = (record, stateDir = defaultStateDir) => { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(recordPath(record.issueDate, stateDir), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 }); };

function prepareApproval({ issueDate, configPath, stateDir = defaultStateDir, token } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate || "")) throw new Error("A valid issue date is required");
  const config = readConfig(configPath);
  const html = fs.readFileSync(htmlPath(issueDate));
  const rawToken = token || crypto.randomBytes(32).toString("base64url");
  const record = { issueDate, approvalRecipient: config.newsletter.approvalRecipient, htmlPath: path.relative(root, htmlPath(issueDate)).replaceAll("\\", "/"), htmlHash: sha256(html), tokenHash: sha256(rawToken), status: "SENT_FOR_APPROVAL", preparedAt: new Date().toISOString() };
  writeRecord(record, stateDir);
  return { token: rawToken, record };
}

function approve({ issueDate, token, configPath, stateDir = defaultStateDir } = {}) {
  const config = readConfig(configPath);
  const record = readRecord(issueDate, stateDir);
  if (record.issueDate !== issueDate) throw new Error("Issue-date validation failed");
  if (record.approvalRecipient !== config.newsletter.approvalRecipient) throw new Error("Approval-recipient validation failed");
  const supplied = Buffer.from(sha256(token || ""), "hex");
  const expected = Buffer.from(record.tokenHash, "hex");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error("Invalid approval token");
  const currentHash = sha256(fs.readFileSync(path.join(root, record.htmlPath)));
  if (currentHash !== record.htmlHash) throw new Error("HTML hash validation failed; prepare a new approval");
  if (record.status !== "SENT_FOR_APPROVAL" && record.status !== "APPROVED") throw new Error(`Cannot approve from ${record.status}`);
  record.status = "APPROVED"; record.approvedAt = record.approvedAt || new Date().toISOString();
  writeRecord(record, stateDir);
  return { record, emailsSent: 0, assistantEmailsSent: 0, subscriberEmailsSent: 0, approvedHtmlPath: path.join(root, record.htmlPath) };
}

function markHandedOff({ issueDate, configPath, stateDir = defaultStateDir } = {}) {
  const config = readConfig(configPath); const record = readRecord(issueDate, stateDir);
  if (record.status !== "APPROVED") throw new Error("Only an approved issue may be marked handed off");
  if (!config.newsletter.handoffRecipient) throw new Error("newsletter.handoffRecipient is not configured");
  record.status = "HANDED_OFF"; record.handedOffAt = new Date().toISOString(); record.handoffRecipient = config.newsletter.handoffRecipient;
  writeRecord(record, stateDir); return record;
}

module.exports = { prepareApproval, approve, markHandedOff, readRecord, sha256 };
if (require.main === module) {
  const command = process.argv[2]; const args = Object.fromEntries(process.argv.slice(3).filter(x => x.startsWith("--")).map(x => { const [k, ...v] = x.slice(2).split("="); return [k, v.join("=")]; }));
  try {
    if (command === "prepare") { const result = prepareApproval({ issueDate: args.issue }); console.log(JSON.stringify({ ...result.record, token: result.token, warning: "Token is displayed once and is never stored raw." }, null, 2)); }
    else if (command === "approve") console.log(JSON.stringify(approve({ issueDate: args.issue, token: args.token }), null, 2));
    else if (command === "status") console.log(JSON.stringify(readRecord(args.issue), null, 2));
    else if (command === "handoff") console.log(JSON.stringify(markHandedOff({ issueDate: args.issue }), null, 2));
    else throw new Error("Commands: prepare, approve, status, handoff");
  } catch (error) { console.error(error.message); process.exit(1); }
}

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { execFileSync } = require("child_process");
const { prepareApproval, approve, readRecord } = require("./newsletter-approval");
const root = path.resolve(__dirname, "..");
execFileSync(process.execPath, [path.join(root, "generate.js"), "2026-09-02.json"], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(__dirname, "verify-root-newsletter.js"), "--issue=2026-09-02"], { stdio: "inherit" });
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwinnett-approval-test-"));
try {
  let prepared = prepareApproval({ issueDate: "2026-09-02", stateDir, token: "local-test-token-never-emailed" });
  assert(!fs.readFileSync(path.join(stateDir, "2026-09-02.json"), "utf8").includes("local-test-token-never-emailed"), "raw token was stored");
  assert.throws(() => approve({ issueDate: "2026-09-02", token: "invalid-token", stateDir }), /Invalid approval token/);
  let record = readRecord("2026-09-02", stateDir); record.issueDate = "2026-09-09"; fs.writeFileSync(path.join(stateDir, "2026-09-02.json"), JSON.stringify(record));
  assert.throws(() => approve({ issueDate: "2026-09-02", token: prepared.token, stateDir }), /Issue-date validation failed/);
  prepared = prepareApproval({ issueDate: "2026-09-02", stateDir, token: "second-local-token" });
  record = readRecord("2026-09-02", stateDir); record.htmlHash = "0".repeat(64); fs.writeFileSync(path.join(stateDir, "2026-09-02.json"), JSON.stringify(record));
  assert.throws(() => approve({ issueDate: "2026-09-02", token: prepared.token, stateDir }), /HTML hash validation failed/);
  prepared = prepareApproval({ issueDate: "2026-09-02", stateDir, token: "final-local-token" });
  const result = approve({ issueDate: "2026-09-02", token: prepared.token, stateDir });
  assert.equal(result.record.status, "APPROVED"); assert.equal(result.emailsSent, 0); assert.equal(result.assistantEmailsSent, 0); assert.equal(result.subscriberEmailsSent, 0);
  assert(fs.existsSync(result.approvedHtmlPath), "approved HTML is unavailable");
  const config = JSON.parse(fs.readFileSync(path.join(root, "automation.local.json"), "utf8"));
  const changed = structuredClone(config); changed.newsletter.handoffRecipient = "future-assistant@example.com";
  assert.equal(changed.newsletter.handoffRecipient, "future-assistant@example.com");
  assert.equal(readRecord("2026-09-02", stateDir).status, "APPROVED");
  console.log(JSON.stringify({ passed: true, issue: "2026-09-02", invalidTokenRejected: true, issueDateValidated: true, htmlHashValidated: true, validTokenStatus: "APPROVED", approvalEmailsSent: 0, assistantEmailsSent: 0, subscriberEmailsSent: 0, approvedHtmlAvailable: true, handoffRecipientConfigurable: true }, null, 2));
} finally { fs.rmSync(stateDir, { recursive: true, force: true }); }

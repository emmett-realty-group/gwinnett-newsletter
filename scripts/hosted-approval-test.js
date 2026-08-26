const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { prepareApproval } = require("./newsletter-approval");

const root = path.resolve(__dirname, "..");
const issue = "2026-09-02";
const config = JSON.parse(fs.readFileSync(path.join(root, "automation.local.json"), "utf8"));
const endpoint = config.approval.baseUrl;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-hosted-test-"));
const blobFile = path.join(tempDir, "record.json");
const netlifyCommand = process.platform === "win32" ? process.execPath : "netlify";
const netlifyPrefix = process.platform === "win32" ? [path.join(process.env.APPDATA, "npm", "node_modules", "netlify-cli", "bin", "run.js")] : [];
const setRecord = record => {
  fs.writeFileSync(blobFile, JSON.stringify(record));
  execFileSync(netlifyCommand, [...netlifyPrefix, "blobs:set", config.approval.blobStore, issue, "--input", blobFile], { cwd: root, stdio: "ignore" });
};
const hostedOnly = record => ({ issueDate: record.issueDate, approvalRecipient: record.approvalRecipient, tokenHash: record.tokenHash, htmlHash: record.htmlHash, status: record.status, preparedAt: record.preparedAt, expiresAt: record.expiresAt });
const call = async (token, requestedIssue = issue) => fetch(`${endpoint}?issue=${encodeURIComponent(requestedIssue)}&token=${encodeURIComponent(token)}`, { redirect: "manual" });

(async () => {
  try {
    let prepared = prepareApproval({ issueDate: issue });
    const wrongHash = hostedOnly(prepared.record); wrongHash.htmlHash = "0".repeat(64); setRecord(wrongHash);
    let response = await call(prepared.token); assert.equal(response.status, 409); assert((await response.text()).includes("HTML changed"));

    prepared = prepareApproval({ issueDate: issue });
    const expired = hostedOnly(prepared.record); expired.expiresAt = new Date(Date.now() - 60000).toISOString(); setRecord(expired);
    response = await call(prepared.token); assert.equal(response.status, 410); assert((await response.text()).includes("expired"));

    prepared = prepareApproval({ issueDate: issue });
    const wrongIssue = hostedOnly(prepared.record); wrongIssue.issueDate = "2026-09-09"; setRecord(wrongIssue);
    response = await call(prepared.token); assert.equal(response.status, 400); assert((await response.text()).includes("does not match"));

    prepared = prepareApproval({ issueDate: issue }); setRecord(hostedOnly(prepared.record));
    const email = execFileSync(process.execPath, [path.join(__dirname, "send-monday-approval-node.js"), issue], { cwd: root, env: { ...process.env, NEWSLETTER_APPROVAL_TOKEN: prepared.token, LIVE_SEND_APPROVAL: "false" }, encoding: "utf8" });
    assert(email.includes("APPROVE NEWSLETTER")); assert(email.includes(endpoint)); assert(email.includes("DRY RUN: no email sent"));

    response = await call("invalid-hosted-token"); assert.equal(response.status, 403); assert((await response.text()).includes("invalid"));
    response = await call(prepared.token); assert.equal(response.status, 200); const success = await response.text(); assert(success.includes("Newsletter Approved")); assert(success.includes("Status:</strong> APPROVED"));

    execFileSync(netlifyCommand, [...netlifyPrefix, "blobs:get", config.approval.blobStore, issue, "--output", blobFile], { cwd: root, stdio: "ignore" });
    const persisted = JSON.parse(fs.readFileSync(blobFile, "utf8")); assert.equal(persisted.status, "APPROVED"); assert(persisted.approvedAt);
    response = await call(prepared.token); assert.equal(response.status, 409); assert((await response.text()).includes("already been used"));
    assert(fs.existsSync(path.join(root, "dist", `gwinnett-and-beyond-${issue}.html`)));
    console.log(JSON.stringify({ passed: true, issue, approvalEmailContainsHostedButton: true, invalidTokenRejected: true, expiredTokenRejected: true, issueDateValidated: true, htmlHashValidated: true, persistedStatus: persisted.status, approvalTimestampPersisted: true, tokenReuseRejected: true, assistantEmailsSent: 0, subscriberEmailsSent: 0, approvedHtmlAvailable: true }, null, 2));
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack); process.exit(1); });

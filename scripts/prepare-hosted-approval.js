const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { prepareApproval } = require("./newsletter-approval");

const root = path.resolve(__dirname, "..");
const issue = process.argv[2];
const live = process.argv.includes("--live");
if (!/^\d{4}-\d{2}-\d{2}$/.test(issue || "")) throw new Error("Usage: node scripts/prepare-hosted-approval.js YYYY-MM-DD [--live]");
const config = JSON.parse(fs.readFileSync(path.join(root, "automation.local.json"), "utf8"));
const prepared = prepareApproval({ issueDate: issue });
const hostedRecord = {
  issueDate: prepared.record.issueDate,
  approvalRecipient: prepared.record.approvalRecipient,
  tokenHash: prepared.record.tokenHash,
  htmlHash: prepared.record.htmlHash,
  status: prepared.record.status,
  preparedAt: prepared.record.preparedAt,
  expiresAt: prepared.record.expiresAt
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "newsletter-hosted-approval-"));
const input = path.join(tempDir, `${issue}.json`);
const netlifyCommand = process.platform === "win32" ? process.execPath : "netlify";
const netlifyPrefix = process.platform === "win32" ? [path.join(process.env.APPDATA, "npm", "node_modules", "netlify-cli", "bin", "run.js")] : [];
try {
  fs.writeFileSync(input, JSON.stringify(hostedRecord));
  execFileSync(netlifyCommand, [...netlifyPrefix, "blobs:set", config.approval.blobStore, issue, "--input", input], { cwd: root, stdio: "inherit" });
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
const env = { ...process.env, NEWSLETTER_APPROVAL_TOKEN: prepared.token, LIVE_SEND_APPROVAL: live ? "true" : "false" };
execFileSync(process.execPath, [path.join(__dirname, "send-monday-approval-node.js"), issue], { cwd: root, env, stdio: "inherit" });
console.log(JSON.stringify({ issue, stateStoredIn: "Netlify Blobs", status: "SENT_FOR_APPROVAL", liveApprovalEmailRequested: live, assistantEmailsSent: 0, subscriberEmailsSent: 0 }, null, 2));

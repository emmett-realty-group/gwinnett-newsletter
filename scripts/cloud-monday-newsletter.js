"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const C = require("./lib/common");

const root = C.ROOT;
const issueArg = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
const issueIso = issueArg || C.upcomingWednesdayIso();
const forceResend = process.argv.includes("--force-resend");
const localConfig = path.join(root, "automation.local.json");
if (!require("fs").existsSync(localConfig)) {
  require("fs").copyFileSync(path.join(root, "automation.local.example.json"), localConfig);
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

const prepareArgs = ["--issue-date", issueIso];
if (forceResend) prepareArgs.push("--force-resend");
const preparation = run("prepare-monday-newsletter.js", prepareArgs);
const report = C.readJson(path.join(root, "data", "newsletter-reports", `${issueIso}-preparation.json`), null);
if (!report) throw new Error(`Preparation did not produce a report for ${issueIso}.`);

if (report.duplicateSkipped) {
  console.log(`Already emailed to Danny for ${issueIso}; no email was sent.`);
} else if (report.failureNoticeNeeded) {
  const failure = run("send-newsletter-to-danny.js", ["--failure-notice", "--issue-date", issueIso]);
  if (failure.status !== 0) throw new Error("The Danny-only failure notice could not be sent.");
  process.exitCode = 1;
} else if (report.shouldSendDannyEmail) {
  const sendArgs = ["--issue-date", issueIso];
  if (forceResend) sendArgs.push("--force-resend");
  const send = run("send-newsletter-to-danny.js", sendArgs);
  if (send.status !== 0) throw new Error("The verified newsletter could not be emailed to Danny.");
} else {
  throw new Error(`Unexpected preparation status ${report.deliveryStatus}; prepare exit ${preparation.status}.`);
}

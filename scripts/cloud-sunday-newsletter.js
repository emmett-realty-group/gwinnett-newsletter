"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const C = require("./lib/common");

const root = C.ROOT;
const issueIso = process.argv[2] || C.upcomingWednesdayIso();
const localConfig = path.join(root, "automation.local.json");
if (process.env.GITHUB_ACTIONS === "true" || !require("fs").existsSync(localConfig)) {
  require("fs").copyFileSync(path.join(root, "automation.local.example.json"), localConfig);
}

function run(script, args = [], allowFailure = false) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!allowFailure && result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}.`);
  return result.status || 0;
}

// First pass selects content and records the exact prompt without using an image API.
run("prestage-newsletter.js", ["--issue-date", issueIso, "--no-cartoon-generation"], true);

// The legacy flag explicitly enables the API only in this cloud Sunday process.
run("prestage-newsletter.js", ["--issue-date", issueIso, "--legacy-openai-cartoon-generation"], true);

// Final pass proves that the hosted image saved in the draft is sufficient by itself.
const finalStatus = run("prestage-newsletter.js", ["--issue-date", issueIso, "--no-cartoon-generation"], true);
if (finalStatus !== 0) {
  run("send-newsletter-to-danny.js", ["--prestage-alert", "--issue-date", issueIso]);
  process.exitCode = 1;
} else {
  console.log(`Sunday pre-stage is ready for ${issueIso}. No email was sent.`);
}

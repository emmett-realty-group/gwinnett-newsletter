"use strict";
// Monday preparation: build -> generate -> verify -> stage the Danny-only attachment.
// This script never sends email. It writes a report that scripts/run-monday-newsletter.ps1 reads.
//
//   node scripts/prepare-monday-newsletter.js [--issue-date YYYY-MM-DD] [--dry-run] [--force-resend]
//        [--plan-only] [--today YYYY-MM-DD] [--market-csv file] [--no-feeds]
//
// Failed and dry runs never touch issues/, the published newsletter-data.json, dist/newsletter.html, or index.html.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const C = require("./lib/common");
const { buildIssue, saveDraft } = require("./lib/build-issue");
const { COUNTY_ROTATION } = require("./lib/market");
const { remainingTipCount } = require("./lib/tips");
const { remainingFutureQueueEvents } = require("./lib/events");

const FAILURE_STATUSES = ["CONTENT_INCOMPLETE", "GENERATION_FAILED", "VERIFICATION_FAILED"];

function parseArgs(argv) {
  const args = { dryRun: false, forceResend: false, planOnly: false, issueDate: null, today: null, marketCsv: null, feeds: true, root: C.ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force-resend") args.forceResend = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--skip-market-fetch") throw new Error("--skip-market-fetch was removed: the Market Snapshot must use live data. For offline tests use --market-csv <file> with --dry-run.");
    else if (arg === "--issue-date") args.issueDate = argv[++i];
    else if (arg === "--today") args.today = argv[++i];
    else if (arg === "--market-csv") args.marketCsv = argv[++i];
    else if (arg === "--no-cartoon-generation") { /* retained as a no-op for old task commands */ }
    else if (arg === "--no-feeds") args.feeds = false;
    else if (arg === "--root") args.root = path.resolve(argv[++i]);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) args.issueDate = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.marketCsv && !args.dryRun) throw new Error("--market-csv is only allowed with --dry-run.");
  return args;
}

function newReport(issueIso, args) {
  return {
    issueDate: C.formatIssueDateFromIso(issueIso),
    issueIsoDate: issueIso,
    pipeline: "Generate -> Verify -> Email Danny only",
    scheduledRunTime: "Monday 8:00 AM America/New_York",
    intendedPublishTarget: "Wednesday 12:00 PM America/New_York via Keller Williams Command (scheduled by Danny)",
    startTime: new Date().toISOString(),
    finishTime: null,
    dryRun: args.dryRun,
    forceResend: args.forceResend,
    recipient: C.APPROVED_RECIPIENT,
    emailSubject: `Gwinnett & Beyond Weekly - ${args.forceResend ? "Revised " : ""}Newsletter for ${C.formatIssueDateFromIso(issueIso)}`,
    deliveryStatus: "PREPARING",
    shouldSendDannyEmail: false,
    failureNoticeNeeded: false,
    verifierPassed: false,
    problems: [],
    warnings: [],
    notes: [],
    tipCandidates: [],
    eventCandidates: [],
    cartoonActions: [],
    verificationResults: []
  };
}

function runNode(root, script, scriptArgs, report) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...scriptArgs], { cwd: root, encoding: "utf8" });
  const entry = { name: `node ${script}`, ok: result.status === 0, output: `${result.stdout || ""}${result.stderr || ""}`.trim().slice(0, 4000) };
  report.verificationResults.push(entry);
  return entry;
}

const PUBLISHED_FILES = ["newsletter-data.json", path.join("dist", "newsletter.html"), "index.html"];

function backup(root) {
  const saved = {};
  for (const rel of PUBLISHED_FILES) {
    const full = path.join(root, rel);
    saved[rel] = fs.existsSync(full) ? fs.readFileSync(full) : null;
  }
  return saved;
}

function restore(root, saved, datedFileBefore) {
  for (const [rel, content] of Object.entries(saved)) {
    const full = path.join(root, rel);
    if (content === null) { if (fs.existsSync(full)) fs.unlinkSync(full); }
    else fs.writeFileSync(full, content);
  }
  // generate.js also writes dist/gwinnett-and-beyond-<date>.html; remove it if this run created it.
  for (const file of fs.readdirSync(path.join(root, "dist")).filter((name) => /^gwinnett-and-beyond-.*\.html$/.test(name))) {
    if (!datedFileBefore.has(file)) fs.unlinkSync(path.join(root, "dist", file));
  }
}

function listDated(root) {
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  return new Set(fs.readdirSync(dist).filter((name) => /^gwinnett-and-beyond-.*\.html$/.test(name)));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function lowContentWarnings(root, issueIso, report) {
  const archive = C.loadArchive(root, "");
  const tipKeys = C.archivedTipKeys(archive);
  const tips = remainingTipCount(root, Number(issueIso.slice(5, 7)), tipKeys);
  if (tips.nextMonth < 5) report.warnings.push(`Only ${tips.nextMonth} unused homeowner tips fit next month. Add more to content/homeowner-tips.json.`);
  const events = remainingFutureQueueEvents(root, issueIso, C.archivedEventKeys(archive));
  if (events.length < 2) report.warnings.push(`Only ${events.length} upcoming event(s) left in content/event-queue.json after this issue. Add more soon.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const todayIso = args.today || C.todayIsoInEastern();
  const issueIso = args.issueDate || C.upcomingWednesdayIso();
  if (!C.isValidIso(issueIso) || C.isoToUtcNoon(issueIso).getUTCDay() !== 3) throw new Error(`Issue date must be a Wednesday in YYYY-MM-DD form: ${issueIso}`);

  const reportDir = path.join(root, "data", "newsletter-reports");
  const reportPath = path.join(reportDir, `${issueIso}-${args.dryRun ? "dry-run" : "preparation"}.json`);
  const statePath = path.join(root, "data", "newsletter-state.json");
  const state = C.readJson(statePath, { nextMarketRotationIndex: 0, preparedIssues: {}, deliveryRecords: {} });

  if (args.planOnly) {
    const index = Number(state.nextMarketRotationIndex || 0) % COUNTY_ROTATION.length;
    console.log(JSON.stringify({ issueIso, issueDate: C.formatIssueDateFromIso(issueIso), featuredCounty: COUNTY_ROTATION[index], alreadyEmailed: Boolean(state.deliveryRecords?.[issueIso]) }, null, 2));
    return;
  }

  const report = newReport(issueIso, args);
  const record = state.deliveryRecords?.[issueIso];
  if (record && ["EMAILED_TO_DANNY", "SENT_FOR_APPROVAL"].includes(record.status) && !args.forceResend && !args.dryRun) {
    report.deliveryStatus = "EMAILED_TO_DANNY";
    report.duplicateSkipped = true;
    report.notes.push(`Already emailed to Danny at ${record.sentAt}. Use -ForceResend to send a revised copy.`);
    finish(reportPath, report);
    return;
  }

  let saved = null;
  let datedBefore = null;
  try {
    const { issue, problems, rotationIndex } = await buildIssue({
      root, issueIso, todayIso, report,
      options: {
        mode: "monday",
        csvText: args.marketCsv ? fs.readFileSync(path.resolve(args.marketCsv), "utf8") : undefined,
        allowCartoonGeneration: false,
        includeFeeds: args.feeds
      }
    });
    report.featuredCounty = issue.automation.featuredCounty;
    report.tipTitle = issue.rotatingFeatures.find((f) => f.key === "homeowner-tip")?.title || null;
    report.eventTitle = issue.rotatingFeatures.find((f) => f.key === "local-event")?.title || null;
    report.draftPath = path.relative(root, saveDraft(root, issueIso, issue));
    lowContentWarnings(root, issueIso, report);

    if (problems.length) {
      report.problems.push(...problems);
      report.deliveryStatus = "CONTENT_INCOMPLETE";
      return;
    }

    saved = backup(root);
    datedBefore = listDated(root);
    C.writeJson(path.join(root, "newsletter-data.json"), issue);
    const generated = runNode(root, "generate.js", [], report);
    if (!generated.ok) {
      report.problems.push(`generate.js failed: ${generated.output}`);
      report.deliveryStatus = "GENERATION_FAILED";
      return;
    }
    const verified = runNode(root, path.join("scripts", "verify-root-newsletter.js"), ["--today", todayIso], report);
    if (!verified.ok) {
      report.problems.push(...verified.output.split(/\r?\n/).filter((line) => line.startsWith(" - ")).map((line) => line.slice(3)));
      if (!report.problems.length) report.problems.push(verified.output);
      report.deliveryStatus = "VERIFICATION_FAILED";
      return;
    }
    report.verifierPassed = true;

    const htmlPath = path.join(root, "dist", "newsletter.html");
    if (args.dryRun) {
      const preview = path.join(root, "drafts", `${issueIso}-dry-run.html`);
      fs.copyFileSync(htmlPath, preview);
      report.previewHtml = path.relative(root, preview);
      report.deliveryStatus = "DRY_RUN_VERIFIED";
      return; // finally{} restores the published files
    }

    // Success: publish the verified issue to the archive and stage the attachment.
    const finalData = C.readJson(path.join(root, "newsletter-data.json"));
    C.writeJson(path.join(root, "issues", `${issueIso}.json`), finalData);
    const attachmentDir = path.join(root, "dist", "newsletter-attachments");
    fs.mkdirSync(attachmentDir, { recursive: true });
    report.attachmentFilename = `Gwinnett-and-Beyond-Weekly-${issueIso}.html`;
    report.attachmentPath = path.join(attachmentDir, report.attachmentFilename);
    fs.copyFileSync(htmlPath, report.attachmentPath);
    report.htmlSha256 = sha256(report.attachmentPath);
    report.cartoonImageUrl = finalData.cartoon.imageUrl;

    state.preparedIssues = state.preparedIssues || {};
    state.preparedIssues[issueIso] = {
      issueIsoDate: issueIso,
      issueDate: finalData.issueDate,
      featuredCounty: finalData.automation.featuredCounty,
      marketRotationIndex: rotationIndex,
      tipId: finalData.automation.tipId,
      eventId: finalData.automation.eventId,
      preparedAt: new Date().toISOString()
    };
    if (Number(state.nextMarketRotationIndex || 0) % COUNTY_ROTATION.length === rotationIndex) {
      state.nextMarketRotationIndex = (rotationIndex + 1) % COUNTY_ROTATION.length;
    }
    C.writeJson(statePath, state);
    saved = null; // keep the newly published files
    report.deliveryStatus = report.warnings.length ? "READY_WITH_WARNINGS" : "READY_FOR_REVIEW";
    report.shouldSendDannyEmail = true;
  } catch (error) {
    report.problems.push(C.nonSecretError(error));
    if (report.deliveryStatus === "PREPARING") report.deliveryStatus = "GENERATION_FAILED";
  } finally {
    if (saved) restore(root, saved, datedBefore);
    if (args.dryRun && FAILURE_STATUSES.includes(report.deliveryStatus)) report.deliveryStatus = `DRY_RUN_${report.deliveryStatus}`;
    report.failureNoticeNeeded = !args.dryRun && FAILURE_STATUSES.includes(report.deliveryStatus);
    finish(reportPath, report);
  }
}

function finish(reportPath, report) {
  report.finishTime = new Date().toISOString();
  C.writeJson(reportPath, report);
  console.log(`STATUS ${report.deliveryStatus}`);
  for (const problem of report.problems) console.log(`PROBLEM ${problem}`);
  for (const warning of report.warnings) console.log(`WARNING ${warning}`);
  console.log(`REPORT ${reportPath}`);
  if (report.dryRun) console.log("Dry run: nothing was published and no email may be sent.");
  if (report.failureNoticeNeeded || /^DRY_RUN_(CONTENT|GENERATION|VERIFICATION)/.test(report.deliveryStatus)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(C.nonSecretError(error));
  process.exit(1);
});

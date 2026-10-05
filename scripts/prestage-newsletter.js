"use strict";
// Sunday pre-stage: verify sources, pick next Wednesday's tip and event, compose the copy, and prepare the cartoon prompt.
// A Codex automation generates and publishes the image, then reruns this script. Monday re-verifies the saved draft.
// Exit code 2 means something needs attention. This script never sends email or records delivery.
//
//   node scripts/prestage-newsletter.js [--issue-date YYYY-MM-DD] [--today YYYY-MM-DD] [--no-cartoon-generation] [--no-feeds]
const path = require("path");
const C = require("./lib/common");
const { buildIssue, saveDraft } = require("./lib/build-issue");
const { remainingTipCount } = require("./lib/tips");
const { remainingFutureQueueEvents } = require("./lib/events");

function parseArgs(argv) {
  const args = { issueDate: null, today: null, cartoonGeneration: false, feeds: true, root: C.ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--issue-date") args.issueDate = argv[++i];
    else if (argv[i] === "--today") args.today = argv[++i];
    else if (argv[i] === "--no-cartoon-generation") args.cartoonGeneration = false;
    else if (argv[i] === "--legacy-openai-cartoon-generation") args.cartoonGeneration = true;
    else if (argv[i] === "--no-feeds") args.feeds = false;
    else if (argv[i] === "--root") args.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const todayIso = args.today || C.todayIsoInEastern();
  const issueIso = args.issueDate || C.upcomingWednesdayIso();
  const reportPath = path.join(root, "data", "newsletter-reports", `${issueIso}-prestage.json`);
  const report = {
    issueIsoDate: issueIso,
    issueDate: C.formatIssueDateFromIso(issueIso),
    startTime: new Date().toISOString(),
    problems: [], warnings: [], notes: [], tipCandidates: [], eventCandidates: [], cartoonActions: []
  };
  try {
    const state = C.readJson(path.join(root, "data", "newsletter-state.json"), {});
    if (state.deliveryRecords?.[issueIso]) {
      report.notes.push("This issue was already emailed to Danny; nothing to pre-stage.");
    } else {
      const { issue, problems } = await buildIssue({ root, issueIso, todayIso, report, options: { mode: "prestage", skipMarket: false, allowCartoonGeneration: args.cartoonGeneration, includeFeeds: args.feeds } });
      report.problems.push(...problems);
      report.draftPath = path.relative(root, saveDraft(root, issueIso, issue));
      report.tipTitle = issue.rotatingFeatures.find((f) => f.key === "homeowner-tip")?.title || null;
      report.eventTitle = issue.rotatingFeatures.find((f) => f.key === "local-event")?.title || null;
      report.cartoonImageUrl = issue.cartoon?.imageUrl || null;
    }
    const archive = C.loadArchive(root, "");
    const tips = remainingTipCount(root, Number(issueIso.slice(5, 7)), C.archivedTipKeys(archive));
    if (tips.nextMonth < 5) report.warnings.push(`Only ${tips.nextMonth} unused homeowner tips fit next month in content/homeowner-tips.json.`);
    const events = remainingFutureQueueEvents(root, issueIso, C.archivedEventKeys(archive));
    if (events.length < 2) report.warnings.push(`Only ${events.length} upcoming event(s) remain in content/event-queue.json after this issue.`);
  } catch (error) {
    report.problems.push(C.nonSecretError(error));
  }
  report.finishTime = new Date().toISOString();
  report.status = report.problems.length ? "NEEDS_ATTENTION" : "READY_FOR_MONDAY";
  C.writeJson(reportPath, report);
  console.log(`STATUS ${report.status}`);
  for (const problem of report.problems) console.log(`PROBLEM ${problem}`);
  for (const warning of report.warnings) console.log(`WARNING ${warning}`);
  console.log(`REPORT ${reportPath}`);
  if (report.problems.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(C.nonSecretError(error));
  process.exit(1);
});

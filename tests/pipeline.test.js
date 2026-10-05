"use strict";
// Offline tests for the Danny-only newsletter pipeline. Network calls are replaced with stubs; nothing is sent.
// Run: node --test tests/pipeline.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..");
const CSV = fs.readFileSync(path.join(__dirname, "fixtures", "realtor-county-sample.csv"), "utf8");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gbw-test-"));
  for (const item of ["generate.js", "newsletter-template.html", "newsletter-data.json", "cloudinary-config.json", "automation.local.example.json", "scripts", "content", "issues", "data/newsletter-state.json"]) {
    const from = path.join(REAL_ROOT, item);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(root, item), { recursive: true });
  }
  fs.copyFileSync(path.join(REAL_ROOT, "automation.local.example.json"), path.join(root, "automation.local.json"));
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  // Tests that rebuild September 30 explicitly remove its completed archive entry.
  return root;
}

const okValidator = async () => ({ ok: true, status: 200, contentType: "text/html" });
const pageWith = (text) => async () => ({ ok: true, status: 200, text });
const fakeCartoon = async ({ issueIso, slug, concept }) => ({
  imageUrl: `https://res.cloudinary.com/agkgjldk/image/upload/v1/gwinnett-newsletter/cartoons/${issueIso}-${slug}.png`,
  imageAlt: concept.alt,
  caption: concept.caption,
  closing: concept.closing,
  imagePrompt: `TEST ${concept.prompt}`
});

function newReport() {
  return { problems: [], warnings: [], notes: [], tipCandidates: [], eventCandidates: [], cartoonActions: [], verificationResults: [] };
}

async function buildAndVerify(root, issueIso, todayIso, overrides = {}) {
  const { buildIssue } = require(path.join(root, "scripts", "lib", "build-issue.js"));
  const { verify } = require(path.join(root, "scripts", "verify-root-newsletter.js"));
  const report = newReport();
  const eventPage = overrides.eventPage || "Norcross Art Splash Saturday, October 3 10AM to 6PM Sunday October 4 Autumnfest October 17, 2026 BOO Fest October 23, 2026 Fall Festival October 24, 2026";
  const { issue, problems } = await buildIssue({
    root, issueIso, todayIso, report,
    options: { mode: overrides.mode || "prestage", csvText: CSV, validator: okValidator, fetcher: pageWith(eventPage), cartoonProducer: overrides.cartoonProducer || fakeCartoon, allowCartoonGeneration: true, includeFeeds: false }
  });
  if (problems.length) return { issue, problems, failures: null, report };
  fs.writeFileSync(path.join(root, "newsletter-data.json"), JSON.stringify(issue, null, 2));
  const gen = spawnSync(process.execPath, [path.join(root, "generate.js")], { cwd: root, encoding: "utf8" });
  assert.strictEqual(gen.status, 0, gen.stderr);
  const failures = verify({ root, dataPath: path.join(root, "newsletter-data.json"), htmlPath: path.join(root, "dist", "newsletter.html"), todayIso });
  return { issue, problems, failures, report };
}

test("builds and verifies a complete issue for 2026-09-30 from verified content", async () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "issues", "2026-09-30.json"));
  const { issue, problems, failures } = await buildAndVerify(root, "2026-09-30", "2026-09-28");
  assert.deepStrictEqual(problems, []);
  assert.deepStrictEqual(failures, []);
  const tip = issue.rotatingFeatures.find((f) => f.key === "homeowner-tip");
  const event = issue.rotatingFeatures.find((f) => f.key === "local-event");
  assert.strictEqual(event.title, "Norcross Art Splash");
  assert.ok(tip.title.length > 5);
  assert.match(issue.dannysNote.paragraphs.join(" "), /Norcross Art Splash is this weekend/);
  assert.match(issue.market.paragraphs[0], /3,828 active listings in Gwinnett County/);
});

test("the completed 2026-09-30 archive is treated as published history", () => {
  const C = require(path.join(REAL_ROOT, "scripts", "lib", "common.js"));
  const archive = C.loadArchive(REAL_ROOT, "");
  assert.ok(archive.some((issue) => issue.automation?.tipId === "draft-check-doors-windows"));
  assert.ok(C.archivedTipKeys(archive).has(C.normalizeText("Find the Drafty Door Before the First Cool Night")));
  assert.ok(C.archivedEventKeys(archive).has("id:2026-norcross-art-splash"));
});

test("consecutive weeks never repeat a tip, event, cartoon, or editorial sentence", async () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "issues", "2026-09-30.json"));
  const seen = { tips: new Set(), events: new Set() };
  for (const [issueIso, todayIso] of [["2026-09-30", "2026-09-28"], ["2026-10-07", "2026-10-05"], ["2026-10-14", "2026-10-12"], ["2026-10-21", "2026-10-19"]]) {
    const { issue, problems, failures } = await buildAndVerify(root, issueIso, todayIso);
    assert.deepStrictEqual(problems, [], `${issueIso}: ${problems.join("; ")}`);
    assert.deepStrictEqual(failures, [], `${issueIso}: ${(failures || []).join("; ")}`);
    const tip = issue.rotatingFeatures.find((f) => f.key === "homeowner-tip");
    const event = issue.rotatingFeatures.find((f) => f.key === "local-event");
    assert.ok(!seen.tips.has(tip.tipId));
    assert.ok(!seen.events.has(event.eventId));
    seen.tips.add(tip.tipId);
    seen.events.add(event.eventId);
    fs.writeFileSync(path.join(root, "issues", `${issueIso}.json`), JSON.stringify(issue, null, 2)); // publish
    fs.rmSync(path.join(root, "drafts"), { recursive: true, force: true });
  }
});

test("fails safely when no upcoming verified event exists", async () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "issues", "2026-09-30.json"));
  fs.writeFileSync(path.join(root, "content", "event-queue.json"), JSON.stringify({ events: [] }));
  const { problems } = await buildAndVerify(root, "2026-09-30", "2026-09-28");
  assert.ok(problems.some((p) => /No verified upcoming local event/.test(p)));
});

test("rejects an event whose page does not mention it, even if the link loads", async () => {
  const root = makeRoot();
  const { problems, report } = await buildAndVerify(root, "2026-09-30", "2026-09-28", { eventPage: "Welcome to our website. Page not found." });
  assert.ok(problems.some((p) => /No verified upcoming local event/.test(p)));
  assert.ok(report.eventCandidates.every((c) => !c.accepted));
});

test("rejects past events and generic listing links", () => {
  const { structuralProblems } = require(path.join(REAL_ROOT, "scripts", "lib", "events.js"));
  const base = { title: "X", startDate: "2026-09-26", endDate: "2026-09-27", link: "https://example.org/event/x", paragraphs: ["a"], source: "s", availability: "Sept" };
  assert.ok(structuralProblems(base, "2026-09-30").some((p) => /not after/.test(p)));
  assert.ok(structuralProblems({ ...base, startDate: "2026-10-03", endDate: "2026-10-03", link: "https://www.gwinnettcounty.com/news-events/news-releases" }, "2026-09-30").some((p) => /generic/.test(p)));
});

test("Monday fails safely without calling a cartoon producer when the draft has no cartoon", async () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "issues", "2026-09-30.json"));
  let called = false;
  const { problems } = await buildAndVerify(root, "2026-09-30", "2026-09-28", { mode: "monday", cartoonProducer: async () => { called = true; return fakeCartoon({ issueIso: "2026-09-30", slug: "x", concept: { caption: "x", prompt: "x", alt: "x" } }); } });
  assert.equal(called, false);
  assert.ok(problems.some((p) => /Cartoon Corner image has not been generated yet/.test(p)));
});

test("verifier catches placeholders, repeats, quiz content, missing cartoon, and generic notes", async () => {
  const root = makeRoot();
  fs.rmSync(path.join(root, "issues", "2026-09-30.json"));
  const { issue } = await buildAndVerify(root, "2026-09-30", "2026-09-28");
  const { verify } = require(path.join(root, "scripts", "verify-root-newsletter.js"));
  const regenerateAndVerify = (mutated) => {
    fs.writeFileSync(path.join(root, "newsletter-data.json"), JSON.stringify(mutated, null, 2));
    const gen = spawnSync(process.execPath, [path.join(root, "generate.js")], { cwd: root, encoding: "utf8" });
    if (gen.status !== 0) return [gen.stderr];
    return verify({ root, dataPath: path.join(root, "newsletter-data.json"), htmlPath: path.join(root, "dist", "newsletter.html"), todayIso: "2026-09-28" });
  };
  const clone = () => JSON.parse(JSON.stringify(issue));

  let bad = clone(); bad.dannysNote.paragraphs = ["Here is the local update I pulled together for Wednesday, September 30, 2026, with a quick market note and two useful features from around Gwinnett.", "I hope there is something here."];
  assert.ok(regenerateAndVerify(bad).some((f) => /generic fallback/.test(f)));

  bad = clone(); bad.cartoon.caption = "\"The filter was not emotionally prepared for August either.\"";
  assert.ok(regenerateAndVerify(bad).some((f) => /repeats/.test(f)));

  bad = clone(); bad.referralShare.ps = "Reply with your quiz answer to win an Amazon gift card.";
  assert.ok(regenerateAndVerify(bad).some((f) => /discontinued/.test(f)));

  bad = clone(); bad.rotatingFeatures[1].endDate = "2026-09-29"; bad.rotatingFeatures[1].startDate = "2026-09-29";
  assert.ok(regenerateAndVerify(bad).some((f) => /not after the Wednesday/.test(f)));

  bad = clone(); bad.rotatingFeatures[0].title = "Test Every Smoke Alarm Before Heating Season";
  assert.ok(regenerateAndVerify(bad).some((f) => /already used|repeats/.test(f)));

  bad = clone(); bad.dannysNote.paragraphs = ["August is wrapping up and it has been a busy one.", "This week's homeowner tip is a good one. Norcross Art Splash is this weekend."];
  assert.ok(regenerateAndVerify(bad).some((f) => /stale month/.test(f)));

  bad = clone(); bad.rotatingFeatures[1].sourceVerified = false;
  assert.ok(regenerateAndVerify(bad).some((f) => /not verified live/.test(f)));

  bad = clone(); bad.cartoon.imageUrl = "";
  assert.ok(regenerateAndVerify(bad).length > 0); // generate.js refuses, or verifier fails

  assert.deepStrictEqual(regenerateAndVerify(clone()), []);
});

test("sender can only address dannyemmett@kw.com and has no raw mode", () => {
  const sender = require(path.join(REAL_ROOT, "scripts", "send-newsletter-to-danny.js"));
  assert.strictEqual(sender.RECIPIENT, "dannyemmett@kw.com");
  for (const bad of [["--raw-recipient", "x@y.com", "--issue-date", "2026-09-30"], ["--to", "stacy@example.com", "--issue-date", "2026-09-30"], ["--cc", "a@b.com", "--issue-date", "2026-09-30"]]) {
    assert.throws(() => sender.parseArgs(bad));
  }
  assert.equal(sender.parseArgs(["--prestage-alert", "--issue-date", "2026-10-07"]).mode, "prestage");
  const mime = sender.buildMime({ fromAddress: "dannyemmett@gmail.com", fromDisplayName: "Danny Emmett", subject: "t", text: "hello" });
  assert.match(mime, /^To: <dannyemmett@kw\.com>$/m);
  assert.doesNotMatch(mime, /^(Cc|Bcc):/im);
  const wrapper = spawnSync(process.execPath, [path.join(REAL_ROOT, "scripts", "send-monday-approval-node.js"), "--raw-recipient", "x@y.com"], { encoding: "utf8" });
  assert.notStrictEqual(wrapper.status, 0);
});

test("sender refuses unverified, tampered, or already-sent issues", () => {
  const root = makeRoot();
  const statePath = path.join(root, "data", "newsletter-state.json");
  const initialState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  initialState.deliveryRecords = {};
  fs.writeFileSync(statePath, JSON.stringify(initialState));
  const reports = path.join(root, "data", "newsletter-reports");
  fs.mkdirSync(reports, { recursive: true });
  const attachment = path.join(root, "dist", "a.html");
  fs.writeFileSync(attachment, "<html>ok</html>");
  const reportPath = path.join(reports, "2026-10-07-preparation.json");
  const run = () => spawnSync(process.execPath, [path.join(root, "scripts", "send-newsletter-to-danny.js"), "--issue-date", "2026-10-07", "--dry-run"], { cwd: root, encoding: "utf8" });

  fs.writeFileSync(reportPath, JSON.stringify({ deliveryStatus: "VERIFICATION_FAILED", recipient: "dannyemmett@kw.com" }));
  assert.match(run().stderr, /not ready to email/);

  fs.writeFileSync(reportPath, JSON.stringify({ deliveryStatus: "READY_FOR_REVIEW", verifierPassed: true, recipient: "dannyemmett@kw.com", attachmentPath: attachment, htmlSha256: "0000" }));
  assert.match(run().stderr, /changed after verification/);

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.deliveryRecords["2026-10-07"] = { status: "EMAILED_TO_DANNY", sentAt: "2026-10-05T10:31:00Z" };
  fs.writeFileSync(statePath, JSON.stringify(state));
  assert.match(run().stdout, /NOT SENT: Already emailed/);
});

test("prepare dry run never touches issues/, newsletter-data.json, or dist/newsletter.html", () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, "dist", "newsletter.html"), "PUBLISHED");
  const before = {
    data: fs.readFileSync(path.join(root, "newsletter-data.json"), "utf8"),
    issues: fs.readdirSync(path.join(root, "issues")).join(","),
    state: fs.readFileSync(path.join(root, "data", "newsletter-state.json"), "utf8")
  };
  // Offline: the event page fetch and cartoon generation fail, so this must end as a safe dry-run failure.
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-monday-newsletter.js"), "--dry-run", "--issue-date", "2026-10-07", "--today", "2026-10-05", "--market-csv", path.join(__dirname, "fixtures", "realtor-county-sample.csv"), "--no-cartoon-generation", "--no-feeds"], { cwd: root, encoding: "utf8", timeout: 120000 });
  assert.match(result.stdout, /STATUS DRY_RUN_/);
  assert.strictEqual(fs.readFileSync(path.join(root, "newsletter-data.json"), "utf8"), before.data);
  assert.strictEqual(fs.readFileSync(path.join(root, "dist", "newsletter.html"), "utf8"), "PUBLISHED");
  assert.strictEqual(fs.readdirSync(path.join(root, "issues")).join(","), before.issues);
  assert.strictEqual(fs.readFileSync(path.join(root, "data", "newsletter-state.json"), "utf8"), before.state);
});

test("--market-csv is refused outside dry runs, and --skip-market-fetch is gone", () => {
  const root = makeRoot();
  const a = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-monday-newsletter.js"), "--issue-date", "2026-10-07", "--market-csv", "x.csv"], { cwd: root, encoding: "utf8" });
  assert.notStrictEqual(a.status, 0);
  const b = spawnSync(process.execPath, [path.join(root, "scripts", "prepare-monday-newsletter.js"), "--skip-market-fetch"], { cwd: root, encoding: "utf8" });
  assert.notStrictEqual(b.status, 0);
});

test("tip pool is well-formed, unique, sourced, and does not repeat archived tips or captions", () => {
  const C = require(path.join(REAL_ROOT, "scripts", "lib", "common.js"));
  const { loadTipPool } = require(path.join(REAL_ROOT, "scripts", "lib", "tips.js"));
  const pool = loadTipPool(REAL_ROOT);
  const archive = C.loadArchive(REAL_ROOT, "");
  const usedText = C.archiveTextIndex(archive);
  const usedTips = C.archivedTipKeys(archive);
  const usedCartoons = C.archivedCartoonKeys(archive);
  assert.ok(pool.length >= 40);
  assert.strictEqual(new Set(pool.map((t) => t.id)).size, pool.length);
  assert.strictEqual(new Set(pool.map((t) => C.normalizeText(t.title))).size, pool.length);
  for (const tip of pool) {
    assert.match(tip.link, /^https:\/\//, tip.id);
    assert.ok(tip.source && tip.topic && tip.shortTopic && tip.cartoon?.caption && tip.cartoon?.prompt && tip.cartoon?.alt, tip.id);
    const alreadyUsed = usedTips.has(C.normalizeText(tip.title));
    if (!alreadyUsed) assert.ok(!usedCartoons.has(`caption:${C.normalizeText(tip.cartoon.caption)}`), `${tip.id} caption already used`);
    for (const text of [tip.title, ...tip.paragraphs, ...(tip.items || []), tip.closing, tip.cartoon.caption, tip.cartoon.closing]) {
      if (!alreadyUsed && text && text.length >= 25) assert.ok(!usedText.has(C.normalizeText(text)), `${tip.id} repeats archived text: ${text}`);
    }
    assert.doesNotMatch(tip.cartoon.prompt, /["']?(sign|label|text|words)["']?\s+(that says|reading)/i, tip.id);
  }
});

test("Windows task registration keeps Monday at 8 AM and leaves Sunday to Codex", () => {
  const register = fs.readFileSync(path.join(REAL_ROOT, "scripts", "register-newsletter-tasks.ps1"), "utf8");
  const sunday = fs.readFileSync(path.join(REAL_ROOT, "scripts", "run-sunday-prestage.ps1"), "utf8");
  assert.match(register, /Sunday Source Check \(replaced by Codex automation\)/);
  assert.doesNotMatch(register, /Script = "scripts\\run-sunday-prestage\.ps1"; Day = "Sunday"/);
  assert.match(register, /Monday 8AM Email to Danny/);
  assert.match(register, /Day = "Monday"; Time = "08:00"/);
  assert.match(register, /\[switch\]\$DryRun/);
  assert.doesNotMatch(sunday, /send-newsletter-to-danny|Send-EmergencyNotice|SmtpClient/i);
  assert.match(sunday, /prestage-newsletter\.js/);
});

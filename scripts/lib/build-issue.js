"use strict";
// Assembles one issue's data from verified sources. Used by both the Sunday pre-stage run and the Monday run.
// It never fills a gap with placeholder or invented content: anything it cannot verify is reported as a problem.
const fs = require("fs");
const path = require("path");
const C = require("./common");
const { selectTip } = require("./tips");
const { selectEvent, verifyEventPage, structuralProblems } = require("./events");
const { composeNote, composeReferral, composePreview } = require("./copy");
const { buildMarket, COUNTY_ROTATION } = require("./market");
const { produceCartoon } = require("./cartoon");
const { validateUrl } = require("./web");

const PIPELINE_VERSION = 2;

function draftPath(root, issueIso) {
  return path.join(root, "drafts", `${issueIso}.json`);
}

function loadStartingPoint(root, issueIso) {
  // Drafts hold work in progress (pre-stage output or Danny's edits). A published issue file is used only
  // for an explicit re-send of an issue that already passed verification.
  const draft = C.readJson(draftPath(root, issueIso), null);
  if (draft) return { data: draft, from: `drafts/${issueIso}.json` };
  const published = C.readJson(path.join(root, "issues", `${issueIso}.json`), null);
  if (published && !C.isIncompleteDraft(published) && published.automation?.pipelineVersion >= PIPELINE_VERSION) {
    return { data: published, from: `issues/${issueIso}.json` };
  }
  return { data: {}, from: "new" };
}

function latestArchived(archive) {
  return [...archive].sort((a, b) => a.__archiveIso.localeCompare(b.__archiveIso)).pop() || {};
}

function nextIndex(value, length) {
  const n = Number(value);
  return Number.isFinite(n) ? (n + 1) % length : 0;
}

function tipFeature(tip, validation) {
  return {
    include: true,
    key: "homeowner-tip",
    type: "Homeowner / Seasonal Home Tip",
    label: "HOMEOWNER / SEASONAL HOME TIP",
    tipId: tip.id,
    title: tip.title,
    topic: tip.topic,
    shortTopic: tip.shortTopic,
    cityState: "",
    availability: "",
    paragraphs: tip.paragraphs,
    items: tip.items || [],
    closing: tip.closing || "",
    link: tip.link,
    source: tip.source,
    sourceVerified: Boolean(validation?.ok),
    imageUrl: "",
    imageAlt: ""
  };
}

function eventFeature(event, verification) {
  return {
    include: true,
    key: "local-event",
    type: "Local Community Event",
    label: "LOCAL COMMUNITY EVENT",
    eventId: event.eventId || null,
    title: event.title,
    shortName: event.shortName || event.title,
    cityState: event.cityState || "",
    availability: event.availability,
    startDate: event.startDate,
    endDate: event.endDate || event.startDate,
    paragraphs: event.paragraphs,
    items: event.items || [],
    closing: event.closing || "",
    link: event.link,
    source: event.source,
    sourceVerified: Boolean(verification?.ok),
    verification: verification ? {
      checkedAt: new Date().toISOString(),
      loaded: verification.loaded,
      titleFound: verification.titleFound,
      dateFound: verification.dateFound,
      humanVerified: verification.humanVerified,
      verifiedBy: event.verifiedBy || null,
      verifiedAt: event.verifiedAt || null
    } : null,
    imageUrl: "",
    imageAlt: ""
  };
}

// options: { mode: "prestage" | "monday", skipMarket, csvText, fetcher, validator, cartoonProducer, allowCartoonGeneration }
async function buildIssue({ root = C.ROOT, issueIso, todayIso = C.todayIsoInEastern(), report, options = {} }) {
  const problems = [];
  const archive = C.loadArchive(root, issueIso);
  const usedIndex = C.archiveTextIndex(archive);
  const usedTips = C.archivedTipKeys(archive);
  const usedEvents = C.archivedEventKeys(archive);
  const usedCartoons = C.archivedCartoonKeys(archive);
  const start = loadStartingPoint(root, issueIso);
  report.startedFrom = start.from;
  const existing = start.data;
  const existingFeatures = Array.isArray(existing.rotatingFeatures) ? existing.rotatingFeatures : [];
  const last = latestArchived(archive);
  const state = C.readJson(path.join(root, "data", "newsletter-state.json"), {});
  const rotationIndex = Number.isInteger(existing.automation?.marketRotationIndex)
    ? existing.automation.marketRotationIndex
    : Number(state.nextMarketRotationIndex || 0) % COUNTY_ROTATION.length;
  const featuredCounty = COUNTY_ROTATION[rotationIndex];

  // ---- Homeowner tip ----
  let tip = null;
  let tipValidation = null;
  const existingTip = existingFeatures.find((feature) => feature.key === "homeowner-tip" && feature.tipId);
  if (existingTip && !usedTips.has(`id:${existingTip.tipId}`) && !usedTips.has(C.normalizeText(existingTip.title))) {
    const pool = require("./tips").loadTipPool(root);
    const pooled = pool.find((item) => item.id === existingTip.tipId);
    if (pooled) {
      tipValidation = await (options.validator || validateUrl)(pooled.link);
      if (tipValidation.ok) tip = pooled;
    }
  }
  if (!tip) {
    const selected = await selectTip({ root, issueIso, usedKeys: usedTips, usedCartoonKeys: usedCartoons, report, validator: options.validator });
    if (selected) ({ tip, validation: tipValidation } = selected);
  }
  if (!tip) problems.push("No unused, in-season homeowner tip with a working source link is left in content/homeowner-tips.json.");

  // ---- Local event ----
  let event = null;
  let eventVerification = null;
  const existingEvent = existingFeatures.find((feature) => feature.key === "local-event" && feature.startDate);
  if (existingEvent && !usedEvents.has(C.normalizeText(existingEvent.title)) && !(existingEvent.eventId && usedEvents.has(`id:${existingEvent.eventId}`))
    && structuralProblems(existingEvent, issueIso).length === 0) {
    const queued = require("./events").loadEventQueue(root).find((item) => item.eventId && item.eventId === existingEvent.eventId);
    const candidate = { ...existingEvent, ...(queued || {}) };
    const verification = await verifyEventPage(candidate, todayIso, options.fetcher);
    report.eventCandidates.push({ title: candidate.title, accepted: verification.ok, reason: verification.reason, verification, reused: true });
    if (verification.ok) { event = candidate; eventVerification = verification; }
  }
  if (!event) {
    const selected = await selectEvent({ root, issueIso, todayIso, usedKeys: usedEvents, report, fetcher: options.fetcher, includeFeeds: options.includeFeeds !== false });
    if (selected) ({ event, verification: eventVerification } = selected);
  }
  if (!event) problems.push("No verified upcoming local event is available. Add one to content/event-queue.json (it must occur after the issue date and have a direct event page).");

  // ---- Cartoon (tied to the tip so it is always fresh and relevant) ----
  let cartoon = null;
  const existingCartoon = existing.cartoon || {};
  const existingCartoonFresh = C.cleanText(existingCartoon.imageUrl)
    && !usedCartoons.has(`imageUrl:${C.normalizeText(existingCartoon.imageUrl)}`)
    && !usedCartoons.has(`caption:${C.normalizeText(existingCartoon.caption)}`)
    && (!tip || !existingCartoon.tipId || existingCartoon.tipId === tip.id);
  if (existingCartoonFresh) {
    const check = await (options.validator || validateUrl)(existingCartoon.imageUrl);
    if (check.ok) cartoon = existingCartoon;
    else problems.push(`The saved cartoon image is not reachable (${check.reason}).`);
  }
  if (!cartoon && tip) {
    const concept = tip.cartoon;
    // Monday only accepts the hosted image saved into the draft by Sunday's Codex run.
    // The legacy API producer remains available only through an explicit opt-in.
    if (options.mode === "monday" || options.allowCartoonGeneration !== true) {
      problems.push("Cartoon Corner image has not been generated yet.");
      report.cartoonPrompt = require("./cartoon").buildPrompt(concept.prompt);
      report.cartoonCaption = concept.caption;
    } else {
      try {
        const producer = options.cartoonProducer || produceCartoon;
        cartoon = await producer({ root, issueIso, slug: tip.id, concept, report });
        cartoon.tipId = tip.id;
      } catch (error) {
        problems.push(`Cartoon Corner image could not be produced: ${C.nonSecretError(error)}`);
        report.cartoonPrompt = require("./cartoon").buildPrompt(concept.prompt);
        report.cartoonCaption = concept.caption;
      }
    }
  }

  // ---- Copy composed only from included content ----
  let dannysNote = null;
  let referralShare = null;
  let previewText = "";
  if (tip && event) {
    const dannyNote = existing.dannysNote;
    if (dannyNote?.author === "danny" && Array.isArray(dannyNote.paragraphs) && dannyNote.paragraphs.some(C.cleanText)) {
      dannysNote = dannyNote;
      report.notes.push("Kept Danny's own note from the draft.");
    } else {
      try { dannysNote = composeNote({ issueIso, tip, event, usedIndex }); } catch (error) { problems.push(error.message); }
    }
    try {
      referralShare = existing.referralShare?.author === "danny" ? existing.referralShare : composeReferral({ issueIso, tip, event, usedIndex });
    } catch (error) { problems.push(error.message); }
  }

  // ---- Market (Monday only; data is monthly and refreshed on send day) ----
  let market = existing.market && existing.automation?.marketCheckedFor === issueIso ? existing.market : null;
  if (!options.skipMarket) {
    try {
      market = await buildMarket({ issueIso, featuredCounty, usedIndex, report, csvText: options.csvText });
    } catch (error) {
      market = null;
      problems.push(`Market Snapshot could not be verified: ${C.nonSecretError(error)}`);
    }
  }

  if (tip && event && market) {
    const label = market.featuredCounty.includes(",") ? `Gwinnett and ${featuredCounty.replace(" County", "")}` : "Gwinnett";
    try { previewText = composePreview({ issueIso, tip, event, marketLabel: label, usedIndex }); } catch (error) { problems.push(error.message); }
  }

  const issue = {
    issueDate: C.formatIssueDateFromIso(issueIso),
    subjectLine: C.MASTER_SUBJECT_LINE,
    previewText,
    themeIndex: Number.isInteger(existing.themeIndex) && start.from !== "new" ? existing.themeIndex : nextIndex(last.themeIndex, 5),
    dannysNote,
    market,
    rotatingFeatures: [tip ? tipFeature(tip, tipValidation) : null, event ? eventFeature(event, eventVerification) : null].filter(Boolean),
    cartoon,
    referralShare,
    footerImageIndex: Number.isInteger(existing.footerImageIndex) && start.from !== "new" ? existing.footerImageIndex : nextIndex(last.footerImageIndex, C.FOOTER_IMAGES.length),
    footerImages: C.FOOTER_IMAGES,
    automation: {
      pipelineVersion: PIPELINE_VERSION,
      issueIsoDate: issueIso,
      tipId: tip?.id || null,
      eventId: event?.eventId || null,
      featuredCounty,
      marketRotationIndex: rotationIndex,
      marketCheckedFor: market && !options.skipMarket ? issueIso : existing.automation?.marketCheckedFor || null,
      preparedAt: new Date().toISOString(),
      preparedBy: options.mode || "monday"
    }
  };
  return { issue, problems, featuredCounty, rotationIndex };
}

function saveDraft(root, issueIso, issue) {
  C.writeJson(draftPath(root, issueIso), issue);
  return draftPath(root, issueIso);
}

module.exports = { buildIssue, saveDraft, draftPath, PIPELINE_VERSION };

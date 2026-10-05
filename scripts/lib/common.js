"use strict";
// Shared helpers for the Gwinnett & Beyond Weekly pipeline.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TIME_ZONE = "America/New_York";
const MASTER_SUBJECT_LINE = "A Short Weekly Update";
const NEWSLETTER_TITLE = "Gwinnett & Beyond Weekly";
const NEWSLETTER_SUBTITLE = "A short weekly update for homeowners, friends, and neighbors across Gwinnett and the surrounding counties.";
// The ONLY address this project may ever email. Do not make this configurable.
const APPROVED_RECIPIENT = "dannyemmett@kw.com";
const REQUIRED_URLS = [
  "tel:+14047718629",
  "sms:+14047718629",
  "mailto:dannyemmett@kw.com",
  "https://emmettrealtygroup.com/equity-report",
  "https://calendar.app.google/TkqULC8rNLSWrhjt5"
];
const FOOTER_IMAGES = [
  "https://res.cloudinary.com/agkgjldk/image/upload/v1782347670/gwinnett-newsletter/footers/around-gwinnett-1.jpg",
  "https://res.cloudinary.com/agkgjldk/image/upload/v1782347670/gwinnett-newsletter/footers/around-gwinnett-2.jpg",
  "https://res.cloudinary.com/agkgjldk/image/upload/v1782347671/gwinnett-newsletter/footers/around-gwinnett-3.jpg",
  "https://res.cloudinary.com/agkgjldk/image/upload/v1782347672/gwinnett-newsletter/footers/around-gwinnett-4.jpg",
  "https://res.cloudinary.com/agkgjldk/image/upload/v1782347673/gwinnett-newsletter/footers/around-gwinnett-5.jpg"
];

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    if (arguments.length > 1) return fallback;
    throw new Error(`Missing file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Normalized form used for every duplicate comparison.
function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, "")
    .replace(/[^a-z0-9$%]+/g, " ")
    .trim();
}

function isoToUtcNoon(iso) {
  const [year, month, day] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isValidIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return false;
  const date = isoToUtcNoon(iso);
  return date.toISOString().slice(0, 10) === iso;
}

function addDaysIso(iso, days) {
  const date = isoToUtcNoon(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso, toIso) {
  return Math.round((isoToUtcNoon(toIso) - isoToUtcNoon(fromIso)) / 86400000);
}

function formatIssueDateFromIso(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(isoToUtcNoon(iso));
}

function formatLongDate(iso, { weekday = true, year = false } = {}) {
  const options = { timeZone: "UTC", month: "long", day: "numeric" };
  if (weekday) options.weekday = "long";
  if (year) options.year = "numeric";
  return new Intl.DateTimeFormat("en-US", options).format(isoToUtcNoon(iso));
}

function monthName(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(isoToUtcNoon(iso));
}

function issueDateToIso(issueDate) {
  const parsed = new Date(`${issueDate} 12:00:00 UTC`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function todayIsoInEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

// Next Wednesday strictly after "today" in Eastern time (Monday -> Wednesday of the same week).
function upcomingWednesdayIso(now = new Date()) {
  const today = todayIsoInEastern(now);
  const weekday = isoToUtcNoon(today).getUTCDay();
  let offset = (3 - weekday + 7) % 7;
  if (offset === 0) offset = 7;
  return addDaysIso(today, offset);
}

function wednesdayPositionInMonth(iso) {
  const day = Number(iso.slice(8, 10));
  return Math.floor((day - 1) / 7) + 1;
}

// ---- Archive -------------------------------------------------------------

function loadArchive(root = ROOT, excludeIso = "") {
  const issuesDir = path.join(root, "issues");
  if (!fs.existsSync(issuesDir)) return [];
  return fs.readdirSync(issuesDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name !== `${excludeIso}.json`)
    .sort()
    .map((name) => {
      const issue = readJson(path.join(issuesDir, name));
      issue.__archiveIso = name.slice(0, 10);
      return issue;
    })
    // Failed drafts that were archived by older versions of the pipeline are not published history.
    .filter((issue) => !isIncompleteDraft(issue));
}

const PLACEHOLDER_MARKERS = [
  /This section needs verified details before publication/i,
  /Needs verification before publication/i,
  /Here is the local update I pulled together for/i
];

function isIncompleteDraft(issue) {
  const text = JSON.stringify(issue.rotatingFeatures || []) + JSON.stringify(issue.dannysNote || {});
  if (PLACEHOLDER_MARKERS.some((pattern) => pattern.test(text))) return true;
  const features = Array.isArray(issue.rotatingFeatures) ? issue.rotatingFeatures : [];
  const placeholderTitles = ["homeowner tip", "local community event", "local business spotlight"];
  return features.length > 0 && features.every((feature) => placeholderTitles.includes(cleanText(feature.title).toLowerCase()));
}

// Keys whose values are structural/factual metadata that legitimately repeat between issues.
const NON_EDITORIAL_KEYS = new Set([
  "issueDate", "subjectLine", "themeIndex", "footerImageIndex", "footerImages", "automation", "approval",
  "link", "source", "sourceVerified", "verification", "verificationNote", "reportingPeriod", "featuredCounty",
  "imageRights", "cityState", "availability", "driveTimeFromGwinnett", "label", "type", "key", "include",
  "greeting", "imageUrl", "imageAlt", "startDate", "endDate", "location", "author", "tipId", "eventId",
  "__archiveIso", "legalLine", "answers", "cta", "noteHook", "shortName", "topic", "shortTopic", "localFile",
  "fromQueue", "fromFeed", "verifiedAt", "verifiedBy", "verifyTerms", "months", "sourceKey", "id", "composedFrom"
]);
// Short values under these keys are still editorial and must be unique.
const ALWAYS_COMPARE_KEYS = new Set(["title", "caption", "closing", "question", "ps", "previewText", "copy"]);

// Every editorial string in an issue (current or legacy structure), with a label for error messages.
function editorialEntries(issue) {
  const entries = [];
  const walk = (value, keyPath, key) => {
    if (value == null) return;
    if (key && NON_EDITORIAL_KEYS.has(key)) return;
    if (typeof value === "string") {
      const text = cleanText(value);
      if (!text) return;
      if (text.length >= 25 || ALWAYS_COMPARE_KEYS.has(key)) entries.push([keyPath, text]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${keyPath}[${index}]`, key));
      return;
    }
    if (typeof value === "object") {
      if (value.include === false && key !== undefined && key !== "quiz") return;
      if (key === "quiz") return; // discontinued; never compared
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, keyPath ? `${keyPath}.${childKey}` : childKey, childKey);
      }
    }
  };
  walk(issue, "", undefined);
  return entries;
}

function archiveTextIndex(archive) {
  const index = new Map();
  for (const issue of archive) {
    for (const [field, text] of editorialEntries(issue)) {
      const normalized = normalizeText(text);
      if (normalized && !index.has(normalized)) index.set(normalized, `${field} (${issue.__archiveIso || issue.issueDate})`);
    }
  }
  return index;
}

// Titles of every homeowner tip ever used, from current and legacy fields.
function archivedTipKeys(archive) {
  const keys = new Set();
  for (const issue of archive) {
    for (const feature of issue.rotatingFeatures || []) {
      if (/homeowner/i.test(`${feature.key} ${feature.type}`)) {
        if (cleanText(feature.title)) keys.add(normalizeText(feature.title));
        if (cleanText(feature.tipId)) keys.add(`id:${feature.tipId}`);
      }
    }
    if (cleanText(issue.homeownerTip?.title)) keys.add(normalizeText(issue.homeownerTip.title));
    if (cleanText(issue.automation?.tipId)) keys.add(`id:${issue.automation.tipId}`);
    // Legacy field; older versions copied it forward incorrectly, but over-blocking is the safe direction.
    if (cleanText(issue.automation?.homeownerTipTitle)) keys.add(normalizeText(issue.automation.homeownerTipTitle));
  }
  return keys;
}

// Events ever featured (title and link), from current and legacy fields.
function archivedEventKeys(archive) {
  const keys = new Set();
  const add = (event) => {
    if (!event) return;
    if (cleanText(event.title)) keys.add(normalizeText(event.title));
    if (cleanText(event.eventId)) keys.add(`id:${event.eventId}`);
  };
  for (const issue of archive) {
    for (const feature of issue.rotatingFeatures || []) {
      if (/event|weekend|community/i.test(`${feature.key} ${feature.type}`)) add(feature);
    }
    add(issue.localEvent);
    add(issue.georgiaWeekendIdea);
  }
  return keys;
}

function archivedCartoonKeys(archive) {
  const keys = new Set();
  for (const issue of archive) {
    const cartoon = issue.cartoon || {};
    for (const field of ["imageUrl", "caption", "imagePrompt", "closing"]) {
      if (cleanText(cartoon[field])) keys.add(`${field}:${normalizeText(cartoon[field])}`);
    }
    if (cleanText(cartoon.imageUrl)) keys.add(`file:${path.basename(cartoon.imageUrl).toLowerCase()}`);
  }
  return keys;
}

function nonSecretError(error) {
  const message = String(error && error.message ? error.message : error);
  return message
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "[redacted]")
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/(password|api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function pickUnused(candidates, usedIndex) {
  return candidates.find((candidate) => !usedIndex.has(normalizeText(candidate)));
}

module.exports = {
  ROOT, TIME_ZONE, MASTER_SUBJECT_LINE, NEWSLETTER_TITLE, NEWSLETTER_SUBTITLE, APPROVED_RECIPIENT,
  REQUIRED_URLS, FOOTER_IMAGES,
  cleanText, readJson, writeJson, normalizeText,
  isoToUtcNoon, isValidIso, addDaysIso, daysBetweenIso, formatIssueDateFromIso, formatLongDate, monthName,
  issueDateToIso, todayIsoInEastern, upcomingWednesdayIso, wednesdayPositionInMonth,
  loadArchive, isIncompleteDraft, editorialEntries, archiveTextIndex,
  archivedTipKeys, archivedEventKeys, archivedCartoonKeys, nonSecretError, pickUnused
};

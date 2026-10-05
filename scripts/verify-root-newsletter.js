"use strict";
// Hard QA gate for the generated newsletter. Exits non-zero with a list of every failed check.
// Usage: node scripts/verify-root-newsletter.js [--data newsletter-data.json] [--html dist/newsletter.html] [--today YYYY-MM-DD]
const fs = require("fs");
const path = require("path");
const C = require("./lib/common");
const { isGenericLink } = require("./lib/events");

const DISCONTINUED_CONTENT = /\b(quiz|gift-card|gift card|amazon gift|giveaway|winner announcement|monthly winner|winner reminder|congratulations to our winner)\b/i;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const GENERIC_NOTE_PATTERNS = [
  /Here is the local update I pulled together/i,
  /two useful features from around Gwinnett/i,
  /\bplaceholder\b/i
];

function parseArgs(argv) {
  const args = { data: "newsletter-data.json", html: path.join("dist", "newsletter.html"), today: null, root: C.ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data") args.data = argv[++i];
    else if (argv[i] === "--html") args.html = argv[++i];
    else if (argv[i] === "--today") args.today = argv[++i];
    else if (argv[i] === "--root") args.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function verify({ root = C.ROOT, dataPath, htmlPath, todayIso = null }) {
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };

  if (!fs.existsSync(htmlPath)) return [`Missing generated HTML: ${htmlPath}`];
  if (!fs.existsSync(dataPath)) return [`Missing newsletter data: ${dataPath}`];
  const html = fs.readFileSync(htmlPath, "utf8");
  const data = C.readJson(dataPath);
  const issueIso = data.automation?.issueIsoDate || C.issueDateToIso(data.issueDate);
  const features = Array.isArray(data.rotatingFeatures) ? data.rotatingFeatures.filter((f) => f && f.include !== false) : [];
  const tip = features.find((f) => f.key === "homeowner-tip");
  const event = features.find((f) => f.key === "local-event");
  const note = data.dannysNote || {};
  const noteParagraphs = (note.paragraphs || []).map(C.cleanText).filter(Boolean);
  const noteText = noteParagraphs.join(" ");
  const visibleText = html.replace(/<[^>]+>/g, " ");

  // ---- Structure and permanent elements ----
  check(C.isValidIso(issueIso), "Issue date is missing or invalid.");
  check(C.isValidIso(issueIso) && C.isoToUtcNoon(issueIso).getUTCDay() === 3, "Issue date is not a Wednesday.");
  check(C.isValidIso(issueIso) && data.issueDate === C.formatIssueDateFromIso(issueIso), "issueDate text does not match the ISO issue date.");
  if (todayIso && C.isValidIso(issueIso)) check(C.daysBetweenIso(todayIso, issueIso) >= 0, "Issue date is in the past.");
  check(html.trim().length > 0, "Generated HTML is empty.");
  check(!/{{[^}]*}}/.test(html), "Generated HTML still contains unresolved template tokens.");
  check(!/<script\b/i.test(html), "Generated HTML contains a script tag.");
  check(!/javascript:/i.test(html), "Generated HTML contains a javascript: URL.");
  check(html.includes(`<title>${C.MASTER_SUBJECT_LINE}</title>`), `HTML title must be "${C.MASTER_SUBJECT_LINE}".`);
  check(data.subjectLine === C.MASTER_SUBJECT_LINE, `subjectLine must be "${C.MASTER_SUBJECT_LINE}".`);
  check(html.includes(data.issueDate), "Generated HTML does not show the issue date.");
  check(html.includes("Gwinnett &amp; Beyond Weekly"), "Newsletter title is missing.");
  check(html.includes(C.NEWSLETTER_SUBTITLE), "Newsletter subtitle is missing.");
  check(C.cleanText(data.previewText).length >= 20, "Preview text is missing.");
  check(C.cleanText(data.previewText) !== C.MASTER_SUBJECT_LINE, "Preview text must not repeat the subject line.");
  check(C.cleanText(data.previewText).length <= 160, "Preview text is too long (over 160 characters).");

  // ---- Danny's Note ----
  check(C.cleanText(note.greeting) && noteParagraphs.length > 0, "Danny's Note is missing.");
  check(html.includes("DANNY'S NOTE"), "Danny's Note section is missing from HTML.");
  check(!GENERIC_NOTE_PATTERNS.some((p) => p.test(noteText)), "Danny's Note is a generic fallback, not a note written for this issue.");
  const sentenceCount = (noteText.match(/[.!?](\s|$)/g) || []).length;
  check(sentenceCount >= 2 && sentenceCount <= 6, `Danny's Note should be about 2-4 short sentences (found ${sentenceCount}).`);
  if (C.isValidIso(issueIso)) {
    const monthIndex = Number(issueIso.slice(5, 7)) - 1;
    const allowed = new Set([MONTHS[monthIndex], MONTHS[(monthIndex + 1) % 12]]);
    const stale = new RegExp(`\\b(?:welcome to|happy|as we head into|before|heading into|here comes|it is|it's|we are in|we're in|closing out|wrapping up)\\s+(${MONTHS.join("|")})\\b|\\b(${MONTHS.join("|")})\\s+is\\s+(?:here|almost here|wrapping up|moving|right around|underway)`, "gi");
    for (const match of noteText.matchAll(stale)) {
      const month = match[1] || match[2];
      check(allowed.has(month), `Danny's Note has a stale month reference for a ${MONTHS[monthIndex]} issue: "${match[0]}".`);
    }
  }
  const mentionsEventSection = /\b(event|festival|fair|celebration|local calendar|this weekend|coming up)\b/i.test(noteText);
  const mentionsRecipe = /\b(recipe|what to cook|kitchen idea)\b/i.test(noteText);
  const mentionsHistory = /\b(local history|history corner)\b/i.test(noteText);
  const mentionsBusiness = /\b(business spotlight|coffee shop|restaurant spotlight)\b/i.test(noteText);
  check(!(mentionsEventSection && !event), "Danny's Note refers to an event that is not in this issue.");
  check(!(mentionsRecipe && !features.some((f) => /recipe/i.test(`${f.key} ${f.type}`))), "Danny's Note refers to a recipe that is not in this issue.");
  check(!(mentionsHistory && !features.some((f) => /history/i.test(`${f.key} ${f.type}`))), "Danny's Note refers to a history feature that is not in this issue.");
  check(!(mentionsBusiness && !features.some((f) => /business|restaurant|coffee/i.test(`${f.key} ${f.type}`))), "Danny's Note refers to a business spotlight that is not in this issue.");
  if (note.author !== "danny") {
    const eventName = C.normalizeText(event?.shortName || event?.title || "");
    check(!event || C.normalizeText(noteText).includes(eventName), "Automated Danny's Note does not mention this issue's event.");
    check(!tip || /homeowner (tip|idea)/i.test(noteText), "Automated Danny's Note does not mention this issue's homeowner tip.");
  }

  // ---- Market ----
  const market = data.market || {};
  check(C.cleanText(market.title) && Array.isArray(market.paragraphs) && market.paragraphs.length > 0, "Market Snapshot is missing.");
  check(html.includes("GWINNETT &amp; BEYOND MARKET SNAPSHOT"), "Market Snapshot section is missing from HTML.");
  check(C.cleanText(market.source) && C.cleanText(market.reportingPeriod), "Market Snapshot has no source or reporting period.");
  check(!/needs verification|not verified/i.test(JSON.stringify(market)), "Market Snapshot contains unverified data.");

  // ---- Required feature pair ----
  check(features.length === 2, `Exactly two feature sections are required (found ${features.length}).`);
  check(features.filter((f) => f.key === "homeowner-tip").length === 1, "Exactly one Homeowner / Seasonal Home Tip is required.");
  check(features.filter((f) => f.key === "local-event").length === 1, "Exactly one Local Community Event is required.");
  check((html.match(/<!--ROTATING_FEATURE_SECTION-->/g) || []).length === 2, "Generated HTML must contain exactly two feature sections.");
  for (const feature of features) {
    const label = feature.type || feature.key;
    check(C.cleanText(feature.title), `${label} is missing a title.`);
    check((feature.paragraphs || []).some(C.cleanText) || (feature.items || []).some(C.cleanText), `${label} is missing content.`);
    check(/^https:\/\//i.test(C.cleanText(feature.link)), `${label} is missing a direct https source link.`);
    check(C.cleanText(feature.source), `${label} is missing a source note.`);
    check(feature.sourceVerified === true, `${label} source was not verified live during preparation.`);
    check(html.includes(C.cleanText(feature.link).replace(/&/g, "&amp;")), `${label} link is not in the HTML.`);
  }
  if (event) {
    check(C.isValidIso(event.startDate) && C.isValidIso(event.endDate || event.startDate), "Local event is missing ISO startDate/endDate.");
    if (C.isValidIso(issueIso) && C.isValidIso(event.endDate || event.startDate)) {
      check(C.daysBetweenIso(issueIso, event.endDate || event.startDate) > 0, "Local event is not after the Wednesday issue date.");
    }
    check(!isGenericLink(event.link), "Local event link is a generic listing page, not the event's own page.");
    const v = event.verification || {};
    check(v.loaded === true && v.titleFound === true && (v.dateFound === true || v.humanVerified === true), "Local event page did not pass live verification (name and date on page, or recent human verification).");
    const writtenDates = extractWrittenDates([event.availability, ...(event.paragraphs || []), event.closing].join(" "), Number(String(issueIso).slice(0, 4)));
    check(writtenDates.length > 0, "Local event copy must show its calendar date.");
    if (writtenDates.length && C.isValidIso(issueIso)) {
      check(Math.max(...writtenDates) > C.isoToUtcNoon(issueIso).getTime(), "Local event dates in the copy are not after the issue date.");
    }
  }

  // ---- Cartoon ----
  const cartoon = data.cartoon || {};
  check(html.includes("CARTOON CORNER"), "Cartoon Corner section is missing from HTML.");
  check(/^https:\/\//i.test(C.cleanText(cartoon.imageUrl)), "Cartoon Corner requires a generated image at a public HTTPS URL.");
  check(C.cleanText(cartoon.imageUrl) && html.includes(C.cleanText(cartoon.imageUrl)), "The Cartoon Corner image is not rendered in the HTML.");
  check(!/placeholder|pending|example\.com/i.test(C.cleanText(cartoon.imageUrl)), "Cartoon image URL looks like a placeholder.");
  check(C.cleanText(cartoon.caption), "Cartoon caption is missing.");
  check(C.cleanText(cartoon.imageAlt), "Cartoon alt text is missing.");

  // ---- Referral / contact / footer ----
  check(html.includes("REFERRAL / SHARE"), "Referral/Share section is missing.");
  check(C.cleanText(data.referralShare?.title) && C.cleanText(data.referralShare?.copy), "Referral/Share copy is missing.");
  check(C.cleanText(data.referralShare?.ps), "Fresh P.S. sharing copy is missing.");
  check(/<strong>P\.S\.<\/strong>/i.test(html), "The P.S. is missing from the HTML.");
  for (const url of C.REQUIRED_URLS) check(html.includes(`href="${url}"`), `Required contact/action link is missing: ${url}`);
  check(/Keller Williams Realty/i.test(html), "Brokerage footer is missing.");
  check(/Danny Emmett/i.test(html), "Agent identity is missing from the footer.");
  check(!/Command compliance placeholder|confirm brokerage footer|email preferences|unsubscribe link in Keller Williams Command|Stacy/i.test(visibleText), "Subscriber-visible HTML contains internal reminders or staff names.");
  for (const pattern of [/\[INSERT[^\]]*\]/i, /\bTODO\b/, /\bTBD\b/, /lorem ipsum/i, /Cartoon concept pending/i, /Needs verification/i, /needs verified details/i, /CLIENT_[A-Z0-9_]+/]) {
    check(!pattern.test(html), `Generated HTML contains a visible placeholder: ${pattern}`);
  }
  check(!DISCONTINUED_CONTENT.test(visibleText), "Generated HTML contains discontinued quiz, gift-card, or winner content.");
  check(!("quiz" in data) && !("winnerAnnouncement" in data), "Issue data still contains legacy quiz/winner fields.");
  check((html.match(/<table/g) || []).length === (html.match(/<\/table>/g) || []).length, "HTML table structure is unbalanced.");
  check(!/<img\b(?![^>]*\balt=)/i.test(html), "An image is missing alt text.");
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) check(/^https:\/\//i.test(match[1]), `Image is not hosted at an https URL: ${match[1]}`);
  for (const match of html.matchAll(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>/gi)) {
    const tag = match[0];
    const isButton = /display:block/i.test(tag);
    check(isButton || /color:\s*#(2563eb|f2b94f)/i.test(tag), `Web link is not visibly styled as a link: ${match[1]}`);
  }

  // ---- Freshness against every archived issue ----
  const archive = C.loadArchive(root, issueIso);
  const index = C.archiveTextIndex(archive);
  for (const [field, text] of C.editorialEntries(data)) {
    const previous = index.get(C.normalizeText(text));
    check(!previous, `${field} repeats ${previous}: "${text}"`);
  }
  const usedTips = C.archivedTipKeys(archive);
  if (tip) check(!usedTips.has(C.normalizeText(tip.title)) && !(tip.tipId && usedTips.has(`id:${tip.tipId}`)), `Homeowner tip was already used: ${tip.title}`);
  const usedEvents = C.archivedEventKeys(archive);
  if (event) check(!usedEvents.has(C.normalizeText(event.title)) && !(event.eventId && usedEvents.has(`id:${event.eventId}`)), `Event was already featured: ${event.title}`);
  const usedCartoons = C.archivedCartoonKeys(archive);
  for (const field of ["imageUrl", "caption", "imagePrompt", "closing"]) {
    if (C.cleanText(cartoon[field])) check(!usedCartoons.has(`${field}:${C.normalizeText(cartoon[field])}`), `Cartoon ${field} repeats an earlier issue.`);
  }
  if (C.cleanText(cartoon.imageUrl)) check(!usedCartoons.has(`file:${path.basename(cartoon.imageUrl).toLowerCase()}`), "Cartoon image file repeats an earlier issue.");

  return failures;
}

function extractWrittenDates(text, defaultYear) {
  const pattern = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, "gi");
  const dates = [];
  for (const match of String(text).matchAll(pattern)) {
    const date = new Date(`${match[1]} ${match[2]}, ${match[3] || defaultYear} 23:59:59 UTC`);
    if (!Number.isNaN(date.getTime())) dates.push(date.getTime());
  }
  return dates;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const dataPath = path.resolve(args.root, args.data);
    const htmlPath = path.resolve(args.root, args.html);
    const failures = verify({ root: args.root, dataPath, htmlPath, todayIso: args.today });
    if (failures.length) {
      console.error(`Verification FAILED (${failures.length}):`);
      for (const failure of failures) console.error(` - ${failure}`);
      process.exit(1);
    }
    console.log(`Verified ${htmlPath}`);
  } catch (error) {
    console.error(`Verification FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { verify };

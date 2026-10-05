"use strict";
// Event discovery + verification. An event is only usable when:
//   * it ends AFTER the Wednesday issue date and starts within the look-ahead window,
//   * it has never been featured before (title or eventId),
//   * its direct link loads today and the page mentions the event (and its date, unless recently human-verified).
const path = require("path");
const { ROOT, cleanText, readJson, normalizeText, isValidIso, daysBetweenIso, addDaysIso, isoToUtcNoon, formatLongDate } = require("./common");
const { fetchPageText, fetchText } = require("./web");

const LOOKAHEAD_DAYS = 31;
const HUMAN_VERIFICATION_MAX_AGE_DAYS = 30;
// Listing pages are not a "direct" source for a single event.
const GENERIC_LINK_PATTERNS = [/\/news-releases\/?$/i, /\/events\/?$/i, /\/calendar(\.aspx)?\/?$/i, /\/news\/?$/i];

function loadEventQueue(root = ROOT) {
  const queue = readJson(path.join(root, "content", "event-queue.json"), { events: [] });
  return Array.isArray(queue.events) ? queue.events : [];
}

function isGenericLink(link) {
  try {
    const url = new URL(link);
    return GENERIC_LINK_PATTERNS.some((pattern) => pattern.test(url.pathname)) && !url.search;
  } catch {
    return true;
  }
}

function squash(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function pageMentions(pageText, term) {
  return squash(pageText).includes(squash(term));
}

// Written date forms we accept as evidence the page shows the event date.
function dateTerms(iso) {
  const date = isoToUtcNoon(iso);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(date);
  const shortMonth = month.slice(0, 3);
  const day = date.getUTCDate();
  const mm = String(date.getUTCMonth() + 1);
  return [`${month} ${day}`, `${shortMonth} ${day}`, `${shortMonth}. ${day}`, `${mm}/${day}/${date.getUTCFullYear()}`, `${mm.padStart(2, "0")}/${String(day).padStart(2, "0")}/${date.getUTCFullYear()}`];
}

function structuralProblems(event, issueIso) {
  const problems = [];
  if (!cleanText(event.title)) problems.push("missing title");
  if (!isValidIso(event.startDate) || !isValidIso(event.endDate || event.startDate)) problems.push("missing ISO startDate/endDate");
  if (!/^https:\/\//i.test(cleanText(event.link))) problems.push("link must be https");
  else if (isGenericLink(event.link)) problems.push("link is a generic listing page, not the event itself");
  if (!Array.isArray(event.paragraphs) || event.paragraphs.filter(cleanText).length === 0) problems.push("missing description paragraphs");
  if (!cleanText(event.source)) problems.push("missing source note");
  if (!cleanText(event.availability)) problems.push("missing availability/date line");
  if (problems.length) return problems;
  const endDate = event.endDate || event.startDate;
  if (daysBetweenIso(issueIso, endDate) <= 0) problems.push(`event ends ${endDate}, not after the ${issueIso} issue`);
  if (daysBetweenIso(issueIso, event.startDate) > LOOKAHEAD_DAYS) problems.push(`event starts more than ${LOOKAHEAD_DAYS} days after the issue`);
  return problems;
}

async function verifyEventPage(event, todayIso, fetcher = fetchPageText) {
  const page = await fetcher(event.link);
  const result = { url: event.link, status: page.status || null, loaded: Boolean(page.ok), titleFound: false, dateFound: false, humanVerified: false, ok: false, reason: null };
  if (!page.ok) {
    result.reason = page.reason || `HTTP ${page.status}`;
    return result;
  }
  const terms = Array.isArray(event.verifyTerms) && event.verifyTerms.length ? event.verifyTerms : [event.shortName || event.title];
  const nameTerms = terms.filter((term) => !/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(term));
  result.titleFound = (nameTerms.length ? nameTerms : [event.title]).every((term) => pageMentions(page.text, term));
  result.dateFound = dateTerms(event.startDate).some((term) => pageMentions(page.text, term));
  const verifiedAt = cleanText(event.verifiedAt);
  result.humanVerified = Boolean(cleanText(event.verifiedBy)) && isValidIso(verifiedAt) && daysBetweenIso(verifiedAt, todayIso) <= HUMAN_VERIFICATION_MAX_AGE_DAYS && daysBetweenIso(verifiedAt, todayIso) >= 0;
  result.ok = result.titleFound && (result.dateFound || result.humanVerified);
  if (!result.ok) {
    result.reason = !result.titleFound
      ? "event page loaded but does not mention the event name"
      : "event page does not show the date and the event has no recent human verification";
  }
  return result;
}

// ---- Optional iCalendar feeds (content/event-feeds.json) ------------------

function unfoldIcs(text) {
  return String(text).replace(/\r?\n[ \t]/g, "");
}

function parseIcsDate(value) {
  const match = String(value || "").match(/(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function icsUnescape(value) {
  return String(value || "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function parseIcs(text) {
  const events = [];
  for (const block of unfoldIcs(text).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const field = (name) => {
      const match = body.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, "mi"));
      return match ? match[1].trim() : "";
    };
    events.push({
      summary: icsUnescape(field("SUMMARY")),
      startDate: parseIcsDate(field("DTSTART")),
      endDate: parseIcsDate(field("DTEND")) || parseIcsDate(field("DTSTART")),
      location: icsUnescape(field("LOCATION")),
      url: icsUnescape(field("URL"))
    });
  }
  return events;
}

async function loadFeedEvents(root, issueIso, report) {
  const config = readJson(path.join(root, "content", "event-feeds.json"), { feeds: [] });
  const results = [];
  for (const feed of (config.feeds || []).filter((item) => item.enabled)) {
    try {
      const parsed = parseIcs(await fetchText(feed.url));
      for (const item of parsed) {
        if (!item.summary || !item.startDate || !/^https:\/\//i.test(item.url)) continue;
        // iCalendar all-day DTEND is exclusive, so a one-day event ends the day before DTEND.
        const endDate = item.endDate && daysBetweenIso(item.startDate, item.endDate) >= 1 ? addDaysIso(item.endDate, -1) : item.startDate;
        const when = item.startDate === endDate
          ? formatLongDate(item.startDate, { year: true })
          : `${formatLongDate(item.startDate)} through ${formatLongDate(endDate, { year: true })}`;
        results.push({
          eventId: `feed:${normalizeText(item.summary).replace(/\s+/g, "-")}:${item.startDate}`,
          title: item.summary,
          shortName: item.summary,
          startDate: item.startDate,
          endDate,
          availability: when,
          cityState: feed.cityState || "",
          paragraphs: [`${feed.organizer || "The organizer"} lists ${item.summary}${item.location ? ` at ${item.location}` : ""} on ${when}.`],
          closing: "Check the official event page for times, parking, and any weather updates before heading out.",
          link: item.url,
          source: `Source: ${feed.organizer || "official"} event calendar.`,
          verifyTerms: [item.summary],
          fromFeed: feed.name
        });
      }
      report.eventFeeds = [...(report.eventFeeds || []), { feed: feed.name, ok: true, events: parsed.length }];
    } catch (error) {
      report.eventFeeds = [...(report.eventFeeds || []), { feed: feed.name, ok: false, reason: String(error.message || error) }];
    }
  }
  return results;
}

async function selectEvent({ root = ROOT, issueIso, todayIso, usedKeys, report, fetcher, includeFeeds = true }) {
  const queue = loadEventQueue(root).map((event) => ({ ...event, fromQueue: true }));
  const feedEvents = includeFeeds ? await loadFeedEvents(root, issueIso, report) : [];
  const candidates = [...queue, ...feedEvents]
    .filter((event) => {
      const problems = structuralProblems(event, issueIso);
      if (problems.length) {
        if (event.fromQueue) report.eventCandidates.push({ title: event.title, accepted: false, reason: problems.join("; ") });
        return false;
      }
      if (usedKeys.has(normalizeText(event.title)) || usedKeys.has(`id:${event.eventId}`)) {
        report.eventCandidates.push({ title: event.title, accepted: false, reason: "already featured in an earlier issue" });
        return false;
      }
      return true;
    })
    // Soonest after the issue date first: the most timely pick for readers.
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.fromQueue ? -1 : 1));

  for (const event of candidates) {
    const verification = await verifyEventPage(event, todayIso, fetcher);
    report.eventCandidates.push({ title: event.title, accepted: verification.ok, reason: verification.reason, verification });
    if (verification.ok) return { event, verification };
  }
  return null;
}

function remainingFutureQueueEvents(root, afterIso, usedKeys) {
  return loadEventQueue(root).filter((event) =>
    isValidIso(event.endDate || event.startDate) && daysBetweenIso(afterIso, event.endDate || event.startDate) > 0 &&
    !usedKeys.has(normalizeText(event.title)) && !usedKeys.has(`id:${event.eventId}`));
}

module.exports = { loadEventQueue, structuralProblems, verifyEventPage, selectEvent, parseIcs, isGenericLink, remainingFutureQueueEvents, dateTerms, LOOKAHEAD_DAYS };

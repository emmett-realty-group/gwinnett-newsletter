"use strict";
// Read-only helper: checks each configured iCalendar feed and lists the upcoming events it returns.
// Usage: node scripts/check-event-feeds.js
const path = require("path");
const { ROOT, readJson, todayIsoInEastern } = require("./lib/common");
const { fetchText } = require("./lib/web");
const { parseIcs } = require("./lib/events");

async function main() {
  const config = readJson(path.join(ROOT, "content", "event-feeds.json"), { feeds: [] });
  const today = todayIsoInEastern();
  for (const feed of config.feeds || []) {
    try {
      const text = await fetchText(feed.url);
      const isCalendar = /BEGIN:VCALENDAR/.test(text);
      const upcoming = isCalendar ? parseIcs(text).filter((event) => event.startDate >= today) : [];
      console.log(`${isCalendar ? "OK " : "NOT AN ICS FEED"} ${feed.name} (${feed.enabled ? "enabled" : "disabled"})`);
      for (const event of upcoming.slice(0, 8)) console.log(`   ${event.startDate}  ${event.summary}  ${event.url || "(no event URL - cannot be used)"}`);
    } catch (error) {
      console.log(`FAILED ${feed.name}: ${error.message}`);
    }
  }
}

main();

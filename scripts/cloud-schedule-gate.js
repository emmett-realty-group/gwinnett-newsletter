"use strict";
const fs = require("fs");

function shouldRunSchedule(expectedDay, expectedHour, schedule, now = new Date()) {
  const match = /^0 (\d{1,2}) \* \* ([0-6])$/.exec(schedule || "");
  if (!match || Number(match[1]) > 23 || !Number.isInteger(Number(expectedHour)) ||
      Number(expectedHour) < 0 || Number(expectedHour) > 23 || Number.isNaN(now.getTime())) {
    throw new Error("Invalid weekly schedule gate input.");
  }

  // GitHub can queue a cron run for hours. Evaluate its intended UTC occurrence.
  const scheduledAt = new Date(now);
  scheduledAt.setUTCHours(Number(match[1]), 0, 0, 0);
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() - (scheduledAt.getUTCDay() - Number(match[2]) + 7) % 7);
  if (scheduledAt > now) scheduledAt.setUTCDate(scheduledAt.getUTCDate() - 7);
  if (now - scheduledAt > 86400000) throw new Error("Scheduled run is more than one day late.");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(scheduledAt);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return values.weekday === expectedDay && Number(values.hour) === Number(expectedHour);
}

if (require.main === module) {
  const [expectedDay, expectedHour] = process.argv.slice(2);
  if (!process.env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH is required for the schedule gate.");
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const shouldRun = shouldRunSchedule(expectedDay, expectedHour, event.schedule);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `run=${shouldRun}\n`, "utf8");
  console.log(shouldRun ? `Schedule gate open: ${expectedDay} ${expectedHour}:00 Eastern (delayed starts allowed).` : "Schedule gate closed for this daylight-saving duplicate trigger.");
}

module.exports = { shouldRunSchedule };

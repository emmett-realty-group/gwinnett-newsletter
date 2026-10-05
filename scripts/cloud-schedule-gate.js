"use strict";
const fs = require("fs");

const [expectedDay, expectedHour] = process.argv.slice(2);
const parts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  hour: "2-digit",
  hourCycle: "h23"
}).formatToParts(new Date());
const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
const shouldRun = values.weekday === expectedDay && Number(values.hour) === Number(expectedHour);
const output = process.env.GITHUB_OUTPUT;
if (output) fs.appendFileSync(output, `run=${shouldRun}\n`, "utf8");
console.log(shouldRun ? `Schedule gate open: ${expectedDay} ${expectedHour}:00 Eastern.` : "Schedule gate closed for this daylight-saving duplicate trigger.");

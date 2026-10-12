"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldRunSchedule } = require("../scripts/cloud-schedule-gate");

test("Sunday's delayed October 11 trigger still prepares October 14", () => {
  assert.equal(shouldRunSchedule("Sunday", 18, "0 22 * * 0", new Date("2026-10-12T00:57:30Z")), true);
  assert.equal(shouldRunSchedule("Sunday", 18, "0 23 * * 0", new Date("2026-10-12T02:09:41Z")), false);
});

test("Monday runs after hours of queueing or across Eastern midnight", () => {
  for (const time of ["2026-10-12T12:00:00Z", "2026-10-12T16:30:00Z", "2026-10-13T05:00:00Z"]) {
    assert.equal(shouldRunSchedule("Monday", 8, "0 12 * * 1", new Date(time)), true);
  }
  assert.equal(shouldRunSchedule("Monday", 8, "0 13 * * 1", new Date("2026-10-12T16:30:00Z")), false);
});

test("winter schedules accept the standard-time offset and reject the duplicate", () => {
  const sunday = new Date("2026-11-02T02:00:00Z");
  assert.equal(shouldRunSchedule("Sunday", 18, "0 22 * * 0", sunday), false);
  assert.equal(shouldRunSchedule("Sunday", 18, "0 23 * * 0", sunday), true);
  const monday = new Date("2026-11-02T17:00:00Z");
  assert.equal(shouldRunSchedule("Monday", 8, "0 12 * * 1", monday), false);
  assert.equal(shouldRunSchedule("Monday", 8, "0 13 * * 1", monday), true);
});

test("spring daylight-saving transition chooses the daylight-time offset", () => {
  const sunday = new Date("2027-03-15T01:00:00Z");
  assert.equal(shouldRunSchedule("Sunday", 18, "0 22 * * 0", sunday), true);
  assert.equal(shouldRunSchedule("Sunday", 18, "0 23 * * 0", sunday), false);
});

test("missing, malformed, future, and stale triggers fail instead of silently skipping", () => {
  const now = new Date("2026-10-12T14:00:00Z");
  for (const schedule of [undefined, "", "0 24 * * 1", "0 12 * * 7", "* * * * *", "0 15 * * 1"]) {
    assert.throws(() => shouldRunSchedule("Monday", 8, schedule, now));
  }
  assert.throws(() => shouldRunSchedule("Monday", 8, "0 12 * * 1", new Date("2026-10-13T13:00:00Z")), /one day late/);
});

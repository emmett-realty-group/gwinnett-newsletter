"use strict";
// Composes Danny's Note, referral/share copy, P.S., and preview text from ONLY the content included in the issue.
// Every sentence that names a feature is built from that issue's actual tip and event, so the copy is always
// topical and never claims something the issue does not contain. Nothing here invents facts.
const { cleanText, normalizeText, isoToUtcNoon, daysBetweenIso, monthName, formatLongDate } = require("./common");

function hashIndex(seed, length) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return length ? hash % length : 0;
}

function rotateFrom(items, seed) {
  const start = hashIndex(seed, items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

function capitalize(text) {
  const value = cleanText(text);
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function weekdayName(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(isoToUtcNoon(iso));
}

// Plain-English timing relative to the Wednesday issue, computed from the verified ISO dates.
function relativeWhen(issueIso, startIso, endIso) {
  const days = daysBetweenIso(issueIso, startIso);
  const weekday = weekdayName(startIso);
  const multiDay = endIso && endIso !== startIso;
  if (days >= 1 && days <= 4 && ["Saturday", "Sunday"].includes(weekday)) return "this weekend";
  if (days >= 1 && days <= 4 && weekday === "Friday" && multiDay) return "this weekend";
  if (days >= 1 && days <= 4) return `this ${weekday}`;
  return `on ${formatLongDate(startIso)}`;
}

function seasonalOpeners(issueIso) {
  const month = monthName(issueIso);
  const [year, monthNumber] = issueIso.split("-").map(Number);
  const nextMonth = monthName(`${monthNumber === 12 ? year + 1 : year}-${String((monthNumber % 12) + 1).padStart(2, "0")}-01`);
  const day = Number(issueIso.slice(8, 10));
  const late = day >= 22;
  const early = day <= 8;
  const openers = [];
  if (late) {
    openers.push(`${month} is wrapping up, and ${nextMonth} is right around the corner.`);
    openers.push(`It is hard to believe ${nextMonth} is almost here.`);
    openers.push(`We are closing out ${month}, and the calendar is already filling up for ${nextMonth}.`);
  } else if (early) {
    openers.push(`${month} is here, and the new month always feels like a good reset.`);
    openers.push(`Happy ${month}, friends.`);
    openers.push(`A new month is underway, and ${month} has a way of filling up fast.`);
  } else {
    openers.push(`We are in the thick of ${month} now.`);
    openers.push(`${month} is moving right along.`);
    openers.push(`Here we are in the middle of ${month}.`);
  }
  openers.push("I hope your week is off to a good start.");
  openers.push("Thanks for opening this week's update.");
  return openers;
}

function tipSentences(topic) {
  return [
    `This week's homeowner tip is ${topic}, and it only takes a few minutes.`,
    `I picked ${topic} for this week's homeowner tip because it is easy to put off.`,
    `This week's homeowner idea is ${topic}. It is quick, and it is easy to forget.`
  ];
}

function eventSentences(name, when) {
  return [
    `If you are looking for something local, ${name} is ${when}.`,
    `And if you want a reason to get out and about, ${name} is coming up ${when}.`,
    `For something fun close to home, ${name} is ${when}.`
  ];
}

const CLOSERS = [
  "I hope something here makes your week a little easier.",
  "As always, I am glad you are here.",
  "Hope you enjoy this one.",
  "Thanks for letting me land in your inbox each week.",
  "I hope you and your family have a great week.",
  "If anything here sparks a question, just hit reply."
];

// Returns { greeting, paragraphs, author } or throws if every variant would repeat archived wording.
function composeNote({ issueIso, tip, event, usedIndex }) {
  const topic = cleanText(tip.topic) || cleanText(tip.title).toLowerCase();
  const name = cleanText(event.shortName) || cleanText(event.title);
  const when = relativeWhen(issueIso, event.startDate, event.endDate || event.startDate);
  const first = [];
  for (const opener of rotateFrom(seasonalOpeners(issueIso), `${issueIso}-open`)) {
    for (const sentence of rotateFrom(tipSentences(topic), `${issueIso}-tip`)) first.push(`${opener} ${sentence}`);
  }
  const second = [];
  for (const sentence of rotateFrom(eventSentences(name, when), `${issueIso}-event`)) {
    for (const closer of rotateFrom(CLOSERS, `${issueIso}-close`)) second.push(`${sentence} ${closer}`);
  }
  const p1 = first.find((text) => !usedIndex.has(normalizeText(text)));
  const p2 = second.find((text) => !usedIndex.has(normalizeText(text)));
  if (!p1 || !p2) throw new Error("Could not compose a Danny's Note that does not repeat an earlier issue.");
  return { greeting: "Hey friends,", paragraphs: [p1, p2], author: "automated", composedFrom: { tipId: tip.id, eventId: event.eventId || null } };
}

function composeReferral({ issueIso, tip, event, usedIndex }) {
  const shortTopic = cleanText(tip.shortTopic) || "homeowner";
  const name = cleanText(event.shortName) || cleanText(event.title);
  const titles = rotateFrom([
    `Know someone who would like the ${shortTopic} tip?`,
    `Who in your circle could use this week's ${shortTopic} idea?`,
    `Know a neighbor who would enjoy ${name}?`
  ], `${issueIso}-ref-title`);
  const copies = rotateFrom([
    `If a friend or neighbor is thinking about a move, or just has a real estate question, I would be glad to help. Forwarding this issue is an easy way to share the ${name} details, too.`,
    `Feel free to pass this along to anyone who might enjoy ${name} or could use the ${shortTopic} tip. And if someone you know has a real estate question, I am always happy to help.`,
    `Some of my favorite conversations start with a forwarded email. If someone you know would enjoy ${name}, or is quietly thinking about buying or selling, I would be honored to help.`
  ], `${issueIso}-ref-copy`);
  const pss = rotateFrom([
    `If ${name} sounds like someone's kind of outing, feel free to forward this along.`,
    `Know someone who would put the ${shortTopic} tip to good use? Feel free to forward this email.`,
    `Forwarding this is an easy way to share ${name} with a friend who would enjoy it.`
  ], `${issueIso}-ref-ps`);
  const pick = (items, label) => {
    const choice = items.find((text) => !usedIndex.has(normalizeText(text)));
    if (!choice) throw new Error(`Could not compose fresh ${label} copy.`);
    return choice;
  };
  return { title: pick(titles, "referral title"), copy: pick(copies, "referral"), ps: pick(pss, "P.S.") };
}

function composePreview({ issueIso, tip, event, marketLabel, usedIndex }) {
  const name = capitalize(cleanText(event.shortName) || cleanText(event.title));
  const when = relativeWhen(issueIso, event.startDate, event.endDate || event.startDate);
  const options = [
    `${cleanText(tip.title)}, ${name} ${when}, and a quick ${marketLabel} market check.`,
    `A quick ${marketLabel} market check, ${name} ${when}, and a simple ${cleanText(tip.shortTopic) || "homeowner"} tip.`
  ];
  const choice = options.find((text) => !usedIndex.has(normalizeText(text)));
  if (!choice) throw new Error("Could not compose fresh preview text.");
  return choice;
}

module.exports = { composeNote, composeReferral, composePreview, relativeWhen, hashIndex, rotateFrom, capitalize };

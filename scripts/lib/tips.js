"use strict";
// Homeowner tip selection from content/homeowner-tips.json. Tips are never reused.
const path = require("path");
const { ROOT, cleanText, readJson, normalizeText } = require("./common");
const { validateUrl } = require("./web");

function loadTipPool(root = ROOT) {
  const pool = readJson(path.join(root, "content", "homeowner-tips.json"), { sources: {}, tips: [] });
  return (pool.tips || []).map((tip) => {
    const source = pool.sources?.[tip.sourceKey] || {};
    return { ...tip, source: cleanText(tip.source) || source.source, link: cleanText(tip.link) || source.link };
  });
}

function isTipUsed(tip, usedKeys) {
  return usedKeys.has(`id:${tip.id}`) || usedKeys.has(normalizeText(tip.title));
}

function unusedInSeason(pool, month, usedKeys) {
  return pool
    .map((tip, order) => ({ tip, order }))
    .filter(({ tip }) => Array.isArray(tip.months) && tip.months.includes(month) && !isTipUsed(tip, usedKeys))
    // Narrow-season tips first so they are not missed; year-round tips fill the gaps.
    .sort((a, b) => a.tip.months.length - b.tip.months.length || a.order - b.order)
    .map(({ tip }) => tip);
}

async function selectTip({ root = ROOT, issueIso, usedKeys, usedCartoonKeys, report, validator = validateUrl }) {
  const month = Number(issueIso.slice(5, 7));
  const candidates = unusedInSeason(loadTipPool(root), month, usedKeys);
  for (const tip of candidates) {
    const problems = [];
    if (!cleanText(tip.title) || !Array.isArray(tip.paragraphs) || !tip.paragraphs.length) problems.push("incomplete tip");
    if (!cleanText(tip.source) || !/^https:\/\//i.test(cleanText(tip.link))) problems.push("missing source/link");
    const cartoon = tip.cartoon || {};
    if (!cleanText(cartoon.prompt) || !cleanText(cartoon.caption)) problems.push("missing cartoon concept");
    if (usedCartoonKeys && (usedCartoonKeys.has(`caption:${normalizeText(cartoon.caption)}`) || usedCartoonKeys.has(`imagePrompt:${normalizeText(cartoon.prompt)}`))) problems.push("cartoon concept already used");
    if (problems.length) {
      report.tipCandidates.push({ id: tip.id, accepted: false, reason: problems.join("; ") });
      continue;
    }
    const validation = await validator(tip.link);
    report.tipCandidates.push({ id: tip.id, accepted: validation.ok, reason: validation.reason || null, status: validation.status || null });
    if (validation.ok) return { tip, validation };
  }
  return null;
}

function remainingTipCount(root, fromMonth, usedKeys) {
  const pool = loadTipPool(root);
  const next = (fromMonth % 12) + 1;
  return {
    thisMonth: unusedInSeason(pool, fromMonth, usedKeys).length,
    nextMonth: unusedInSeason(pool, next, usedKeys).length,
    total: pool.filter((tip) => !isTipUsed(tip, usedKeys)).length
  };
}

module.exports = { loadTipPool, selectTip, remainingTipCount, unusedInSeason };

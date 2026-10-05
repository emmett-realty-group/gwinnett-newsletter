"use strict";
// Market Snapshot from Realtor.com Economic Research county inventory data. Every number is copied from the
// downloaded CSV row; if a county is missing it is omitted from the reader-facing copy and noted in the report.
const { cleanText, normalizeText, wednesdayPositionInMonth } = require("./common");
const { fetchText } = require("./web");

const REALTOR_COUNTY_CSV_URL = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_County.csv";
const MARKET_SOURCE = "Realtor.com Economic Research county inventory data";
const COUNTY_ROTATION = ["Gwinnett County", "Walton County", "Jackson County", "Barrow County", "Gwinnett County", "Rockdale County", "DeKalb County", "Forsyth County"];
const MARKET_COUNTIES = ["Gwinnett County", "Barrow County", "Walton County", "Rockdale County", "DeKalb County", "Jackson County", "Forsyth County"];

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted && char === '"' && next === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(value); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""])));
}

const num = (value) => (cleanText(value) === "" ? NaN : Number(value));
const int = (value) => Math.round(num(value)).toLocaleString("en-US");
const money = (value) => num(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (value) => `${Math.abs(num(value) * 100).toFixed(1)}%`;
const share = (value) => `${(num(value) * 100).toFixed(0)}%`;

function monthLabel(yyyymm) {
  const year = Number(String(yyyymm).slice(0, 4));
  const month = Number(String(yyyymm).slice(4, 6));
  if (!year || !month) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function change(value, noun) {
  const n = num(value);
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) < 0.005) return `about the same as a year earlier`;
  return `${pct(value)} ${n > 0 ? "more" : "fewer"} ${noun} than a year earlier`;
}

function direction(value, higher, lower) {
  const n = num(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return "about flat from a year earlier";
  return `${pct(value)} ${n > 0 ? higher : lower} than a year earlier`;
}

const has = (row, ...fields) => fields.every((field) => Number.isFinite(num(row[field])));

// Four "angles" on the same verified row, rotated by the issue's week of the month so weekly issues that share
// one monthly data release still read differently. Each returns null if the needed fields are missing.
const ANGLES = [
  (county, row, period) => has(row, "active_listing_count", "active_listing_count_yy", "median_listing_price")
    ? `In ${period}, Realtor.com counted ${int(row.active_listing_count)} active listings in ${county}, ${change(row.active_listing_count_yy, "listings")}. The median listing price was ${money(row.median_listing_price)}.`
    : null,
  (county, row, period) => has(row, "median_days_on_market", "median_days_on_market_yy", "price_reduced_share")
    ? `Homes in ${county} spent a median of ${int(row.median_days_on_market)} days on the market in ${period}, ${direction(row.median_days_on_market_yy, "longer", "shorter")}. About ${share(row.price_reduced_share)} of active listings had a price reduction.`
    : null,
  (county, row, period) => has(row, "new_listing_count", "new_listing_count_yy", "pending_listing_count")
    ? `Sellers in ${county} added ${int(row.new_listing_count)} new listings in ${period}, ${change(row.new_listing_count_yy, "new listings")}, while ${int(row.pending_listing_count)} homes were pending.`
    : null,
  (county, row, period) => has(row, "median_listing_price", "median_listing_price_yy", "median_listing_price_per_square_foot")
    ? `The median listing price in ${county} was ${money(row.median_listing_price)} in ${period}, ${direction(row.median_listing_price_yy, "higher", "lower")}, or about ${money(row.median_listing_price_per_square_foot)} per square foot.`
    : null,
  (county, row, period) => has(row, "total_listing_count", "pending_ratio", "median_square_feet")
    ? `Counting pending sales, ${county} had ${int(row.total_listing_count)} total listings in ${period}, with a pending ratio of about ${num(row.pending_ratio).toFixed(2)}. The median listed home was about ${int(row.median_square_feet)} square feet.`
    : null
];

// First angle (starting from this week's) that has data and has not been used in an earlier issue.
function describeRow(county, row, angleIndex, usedIndex) {
  const period = monthLabel(row.month_date_yyyymm);
  for (let offset = 0; offset < ANGLES.length; offset += 1) {
    const text = ANGLES[(angleIndex + offset) % ANGLES.length](county, row, period);
    if (text && !usedIndex.has(normalizeText(text))) return text;
  }
  return null;
}

function takeaways(gwinnettRow, featured, period) {
  const inventoryUp = num(gwinnettRow.active_listing_count_yy) > 0.005;
  const inventoryDown = num(gwinnettRow.active_listing_count_yy) < -0.005;
  const area = featured && featured !== "Gwinnett County" ? `Gwinnett and ${featured}` : "Gwinnett";
  if (inventoryUp) {
    return [
      `The simple version for ${area}: buyers have more homes to compare than they did a year ago, so pricing and condition matter more than ever.`,
      `With more homes on the market across ${area}, the listings that are priced right and show well are still the ones getting attention.`,
      `For sellers in ${area}, more competition means first impressions and realistic pricing carry extra weight right now.`,
      `What the ${period} numbers mean for ${area}: buyers can afford to be a little more selective, so presentation matters.`,
      `Reading the ${period} figures for ${area}, the takeaway is patience for buyers and preparation for sellers.`
    ];
  }
  if (inventoryDown) {
    return [
      `The simple version for ${area}: there are fewer homes to choose from than a year ago, so well-prepared listings can stand out quickly.`,
      `With fewer homes on the market across ${area}, buyers may need to be ready to act when the right one comes along.`,
      `For buyers in ${area}, fewer choices means having financing and priorities lined up ahead of time really helps.`,
      `What the ${period} numbers mean for ${area}: good homes are not sitting long, so being prepared pays off.`,
      `Reading the ${period} figures for ${area}, sellers with a well-prepared home are in a solid spot.`
    ];
  }
  return [
    `The simple version for ${area}: the market looks a lot like it did a year ago, and neighborhood-level details still drive each result.`,
    `Across ${area}, conditions are fairly steady, so the specific street, price point, and condition matter more than the headline numbers.`,
    `What the ${period} numbers mean for ${area}: a steady market rewards good pricing and good preparation.`,
    `Reading the ${period} figures for ${area}, there is no big swing either way, which makes local comparisons the key.`
  ];
}

async function buildMarket({ issueIso, featuredCounty, usedIndex, report, csvText }) {
  const csv = csvText || await fetchText(REALTOR_COUNTY_CSV_URL);
  const rows = parseCsv(csv);
  const found = [];
  const omitted = [];
  for (const county of MARKET_COUNTIES) {
    const row = rows.find((item) => cleanText(item.county_name).toLowerCase() === `${county.replace(" County", "")}, ga`.toLowerCase());
    if (row && monthLabel(row.month_date_yyyymm)) found.push({ county, row });
    else omitted.push({ county, reason: "County row not found in Realtor.com CSV." });
  }
  report.verifiedMarketCounties = found.map(({ county, row }) => ({ county, reportingPeriod: monthLabel(row.month_date_yyyymm), source: MARKET_SOURCE }));
  report.omittedMarketCounties = omitted;

  const gwinnett = found.find((item) => item.county === "Gwinnett County");
  if (!gwinnett) throw new Error("Realtor.com data for Gwinnett County was not available, so the Market Snapshot cannot be verified.");
  const featured = found.find((item) => item.county === featuredCounty && featuredCounty !== "Gwinnett County");
  if (featuredCounty !== "Gwinnett County" && !featured) {
    report.warnings.push(`${featuredCounty} was not in the Realtor.com data this week, so the snapshot covers Gwinnett only.`);
  }
  const angle = (wednesdayPositionInMonth(issueIso) - 1) % 4; // the 5th angle is a fallback only
  const paragraphs = [describeRow("Gwinnett County", gwinnett.row, angle, usedIndex)];
  if (featured) paragraphs.push(describeRow(featured.county, featured.row, angle + 1, usedIndex));
  if (paragraphs.some((text) => !text)) throw new Error("Every Market Snapshot angle for this data month has been used or data fields are missing; wait for the next Realtor.com monthly release or add a new angle in scripts/lib/market.js.");

  const period = monthLabel(gwinnett.row.month_date_yyyymm);
  const takeaway = takeaways(gwinnett.row, featured?.county, period).find((text) => !usedIndex.has(normalizeText(text)));
  if (!takeaway) throw new Error("Every market takeaway variant has already been used; add new wording in scripts/lib/market.js.");
  paragraphs.push(takeaway);
  for (const text of paragraphs) {
    if (usedIndex.has(normalizeText(text))) throw new Error(`Market Snapshot copy would repeat an earlier issue: ${text}`);
  }
  const counties = [gwinnett.county, featured?.county].filter(Boolean);
  report.marketSource = MARKET_SOURCE;
  report.marketReportingPeriod = period;
  const area = featured ? `Gwinnett and ${featured.county}` : "Gwinnett County";
  const title = [`${area}: ${period} at a glance`, `What ${period} looked like in ${area}`, `${area} market check for ${period}`, `${area} by the numbers: ${period}`, `A quick look at ${period} in ${area}`]
    .find((text) => !usedIndex.has(normalizeText(text)));
  if (!title) throw new Error("Every Market Snapshot title variant has already been used for this period.");
  return {
    title,
    featuredCounty: counties.join(", "),
    reportingPeriod: period,
    source: MARKET_SOURCE,
    paragraphs,
    verificationNote: `Source: ${MARKET_SOURCE}, ${period} (latest monthly release). Figures are countywide listing data, not closed sales.`
  };
}

module.exports = { buildMarket, parseCsv, COUNTY_ROTATION, MARKET_COUNTIES, REALTOR_COUNTY_CSV_URL, monthLabel };

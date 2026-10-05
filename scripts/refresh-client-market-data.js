const fs = require("fs");
const https = require("https");
const path = require("path");

const DEFAULT_TIME_ZONE = "America/New_York";
const REALTOR_COUNTY_CSV_URL = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_County.csv";

async function main() {
  const clientSlug = process.argv[2];
  if (!clientSlug) {
    throw new Error("Usage: node scripts/refresh-client-market-data.js <client-slug>");
  }

  const root = path.resolve(__dirname, "..");
  const clientRoot = path.join(root, "clients", clientSlug);
  const clientPath = path.join(clientRoot, "client.json");
  const newsletterPath = path.join(clientRoot, "newsletter-data.json");

  if (!fs.existsSync(clientPath)) {
    throw new Error(`Client config not found: ${clientPath}`);
  }

  if (!fs.existsSync(newsletterPath)) {
    throw new Error(`Newsletter data not found: ${newsletterPath}`);
  }

  const client = JSON.parse(fs.readFileSync(clientPath, "utf8"));
  const newsletter = JSON.parse(fs.readFileSync(newsletterPath, "utf8"));
  const automation = client.automation || {};
  const marketConfig = automation.market || {};

  if (!marketConfig.realtorCountyName) {
    throw new Error(`clients/${clientSlug}/client.json is missing automation.market.realtorCountyName`);
  }

  const csvText = await fetchText(REALTOR_COUNTY_CSV_URL);
  const rows = parseCsv(csvText);
  const countyName = String(marketConfig.realtorCountyName).trim().toLowerCase();
  const row = rows.find((item) => String(item.county_name || "").trim().toLowerCase() === countyName);

  if (!row) {
    throw new Error(`County row not found for ${marketConfig.realtorCountyName}`);
  }

  const issueDate = getNextScheduledDateString({
    dayOfWeek: automation.schedule?.dayOfWeek || "Monday",
    timeZone: automation.schedule?.timeZone || DEFAULT_TIME_ZONE
  });
  const issueIsoDate = getNextScheduledIsoDate({
    dayOfWeek: automation.schedule?.dayOfWeek || "Monday",
    timeZone: automation.schedule?.timeZone || DEFAULT_TIME_ZONE
  });

  newsletter.issueDate = issueDate;
  newsletter.market = buildMarketSection(row, marketConfig);
  newsletter.automation = {
    ...(newsletter.automation || {}),
    latestMarketData: {
      source: "Realtor.com Economic Research",
      countyName: row.county_name,
      monthDateYyyymm: row.month_date_yyyymm,
      refreshedAt: new Date().toISOString()
    }
  };

  fs.writeFileSync(newsletterPath, `${JSON.stringify(newsletter, null, 2)}\n`, "utf8");

  const issuesDir = path.join(clientRoot, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  const issueArchivePath = path.join(issuesDir, `${issueIsoDate}.json`);
  fs.writeFileSync(issueArchivePath, `${JSON.stringify(newsletter, null, 2)}\n`, "utf8");

  console.log(`Updated ${newsletterPath}`);
  console.log(`Archived ${issueArchivePath}`);
  console.log(`Latest market month: ${formatMonthLabel(row.month_date_yyyymm)}`);
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 30000 }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchText(response.headers.location).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to fetch ${url}: ${response.statusCode}`));
        return;
      }

      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
      response.on("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Timed out fetching ${url}`));
    });
    request.on("error", reject);
  });
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = splitCsvLine(lines.shift());
  return lines.map((line) => {
    const values = splitCsvLine(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    return record;
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function buildMarketSection(row, marketConfig) {
  const countyDisplayName = marketConfig.displayName || toTitleCase(String(row.county_name || "").replace(/,\s*[a-z]{2}$/i, ""));
  const monthLabel = formatMonthLabel(row.month_date_yyyymm);
  const releaseLabel = marketConfig.sourceReleaseLabel || `latest available Realtor.com county data for ${monthLabel}`;

  const activeListings = toNumber(row.active_listing_count);
  const activeListingsYy = toPercent(row.active_listing_count_yy);
  const newListings = toNumber(row.new_listing_count);
  const newListingsYy = toPercent(row.new_listing_count_yy);
  const pendingListings = toNumber(row.pending_listing_count);
  const pendingListingsYy = toPercent(row.pending_listing_count_yy);
  const medianListingPrice = toCurrency(row.median_listing_price);
  const medianListingPriceYy = toPercent(row.median_listing_price_yy);
  const medianDays = toNumber(row.median_days_on_market);
  const medianDaysYy = toPercent(row.median_days_on_market_yy);

  return {
    title: `${countyDisplayName} market update for ${monthLabel}`,
    paragraphs: [
      `Realtor.com reported ${activeListings} active listings in ${countyDisplayName} during ${monthLabel}, ${describeChange(activeListingsYy, "from one year earlier")}. New listings were ${newListings}, ${describeChange(newListingsYy, "year over year")}, and pending listings were ${pendingListings}, ${describeChange(pendingListingsYy, "year over year")}.`,
      `The median listing price was ${medianListingPrice}, ${describeChange(medianListingPriceYy, "from one year earlier")}. Median days on market came in at ${medianDays} days, ${describeChange(medianDaysYy, "year over year")}.`,
      `In plain English: buyers and sellers should read this as the latest public county snapshot, then compare it with the specific neighborhood, price range, and condition of the homes that matter most.`
    ],
    source: `Source: Realtor.com Economic Research county inventory data for ${monthLabel}; ${releaseLabel}.`
  };
}

function getNextScheduledDateString({ dayOfWeek, timeZone }) {
  return formatIssueDate(getNextScheduledDate({ dayOfWeek, timeZone }), timeZone);
}

function getNextScheduledIsoDate({ dayOfWeek, timeZone }) {
  const parts = getDateParts(getNextScheduledDate({ dayOfWeek, timeZone }), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getNextScheduledDate({ dayOfWeek, timeZone }) {
  const targetDay = normalizeDayOfWeek(dayOfWeek);
  const now = new Date();
  const currentDay = normalizeDayOfWeek(
    new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(now)
  );
  const currentParts = getDateParts(now, timeZone);
  const utcCandidate = new Date(`${currentParts.year}-${currentParts.month}-${currentParts.day}T12:00:00Z`);
  let delta = (targetDay - currentDay + 7) % 7;
  if (delta === 0) {
    return utcCandidate;
  }
  utcCandidate.setUTCDate(utcCandidate.getUTCDate() + delta);
  return utcCandidate;
}

function getDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year").value,
    month: parts.find((part) => part.type === "month").value,
    day: parts.find((part) => part.type === "day").value
  };
}

function formatIssueDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatMonthLabel(value) {
  const text = String(value || "");
  if (!/^\d{6}$/.test(text)) {
    return text;
  }
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function normalizeDayOfWeek(value) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = days.indexOf(String(value).trim().toLowerCase());
  if (index === -1) {
    throw new Error(`Unsupported day of week: ${value}`);
  }
  return index;
}

function toNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function toPercent(value) {
  return Number(value || 0) * 100;
}

function describeChange(percentValue, baselineLabel) {
  const rounded = Math.abs(percentValue).toFixed(1);
  if (Math.abs(percentValue) < 0.05) {
    return `essentially flat ${baselineLabel}`;
  }
  if (percentValue > 0) {
    return `up about ${rounded}% ${baselineLabel}`;
  }
  return `down about ${rounded}% ${baselineLabel}`;
}

function toTitleCase(value) {
  return String(value)
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

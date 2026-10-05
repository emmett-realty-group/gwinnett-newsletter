"use strict";
// Network helpers. Every source used in the newsletter is checked live on the day it is prepared.
const { cleanText, nonSecretError } = require("./common");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GwinnettBeyondWeekly/2.0 (source verification)";

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  if (typeof fetch !== "function") throw new Error("This Node.js version does not provide fetch (Node 18+ required).");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...options,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*", ...(options.headers || {}) },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function validateUrl(url) {
  if (!/^https:\/\//i.test(cleanText(url))) return { ok: false, reason: "Not an https URL." };
  try {
    let response = await fetchWithTimeout(url, { method: "HEAD" });
    if (response.status >= 400) response = await fetchWithTimeout(url, { method: "GET" });
    const ok = response.status >= 200 && response.status < 400;
    return { ok, status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type") || "", reason: ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, reason: nonSecretError(error) };
  }
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/gi, "-")
    .replace(/&#8217;|&rsquo;|&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET" }, 20000);
    const body = await response.text();
    return { ok: response.status >= 200 && response.status < 400, status: response.status, finalUrl: response.url, text: htmlToText(body), raw: body };
  } catch (error) {
    return { ok: false, status: null, text: "", raw: "", reason: nonSecretError(error) };
  }
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url, { method: "GET", headers: { Accept: "*/*" } }, 60000);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.text();
}

module.exports = { fetchWithTimeout, validateUrl, fetchPageText, fetchText, htmlToText };

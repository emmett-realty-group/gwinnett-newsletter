import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE = "newsletter-approvals";
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};
const escapeHtml = value => String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const page = (status, title, body) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#eef4f7;font-family:Arial,Helvetica,sans-serif;color:#17324d;"><main style="max-width:560px;margin:48px auto;padding:32px 24px;background:#fff;border-top:6px solid #f3c44e;box-shadow:0 4px 20px rgba(23,50,77,.12);"><h1 style="margin:0 0 18px;font-size:30px;">${escapeHtml(title)}</h1>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } });
const errorPage = (code, message) => page(code, "Approval Not Completed", `<p style="font-size:17px;line-height:1.6;">${escapeHtml(message)}</p>`);
const issueLabel = iso => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

export default async request => {
  if (request.method !== "GET") return errorPage(405, "This approval link must be opened from the approval email.");
  const requestUrl = new URL(request.url);
  const issue = requestUrl.searchParams.get("issue");
  const token = requestUrl.searchParams.get("token");
  if (!process.env.APPROVAL_RECIPIENT) return errorPage(500, "Approval configuration is missing. Please contact the newsletter administrator.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issue || "") || !token) return errorPage(400, "The approval link is incomplete or has an invalid issue date.");
  try {
    const store = getStore({ name: STORE, consistency: "strong" });
    const record = await store.get(issue, { type: "json", consistency: "strong" });
    if (!record) return errorPage(404, "No approval record was found for this issue.");
    if (record.issueDate !== issue) return errorPage(400, "This approval link does not match the requested issue.");
    if (record.approvalRecipient !== process.env.APPROVAL_RECIPIENT) return errorPage(400, "This approval link does not match the configured approver.");
    if (record.status !== "SENT_FOR_APPROVAL") return errorPage(409, record.status === "APPROVED" ? "This approval token has already been used." : "This issue is not awaiting approval.");
    if (!record.expiresAt || Date.now() >= Date.parse(record.expiresAt)) return errorPage(410, "This approval token has expired. Please generate a fresh approval email.");
    if (!safeEqual(sha256(token), record.tokenHash)) return errorPage(403, "The approval token is invalid.");
    const htmlResponse = await fetch(new URL(`/gwinnett-and-beyond-${encodeURIComponent(issue)}.html`, requestUrl.origin), { headers: { "cache-control": "no-cache" } });
    if (!htmlResponse.ok) return errorPage(404, "The newsletter HTML for this issue is missing.");
    const deployedHash = sha256(Buffer.from(await htmlResponse.arrayBuffer()));
    if (!safeEqual(deployedHash, record.htmlHash)) return errorPage(409, "The newsletter HTML changed after the approval email was generated. Please generate a fresh approval email.");
    const approvedAt = new Date().toISOString();
    await store.setJSON(issue, { ...record, status: "APPROVED", approvedAt });
    const persisted = await store.get(issue, { type: "json", consistency: "strong" });
    if (!persisted || persisted.status !== "APPROVED" || persisted.approvedAt !== approvedAt) return errorPage(500, "Approval could not be persisted. Please try again or contact the newsletter administrator.");
    return page(200, "Newsletter Approved", `<p style="font-size:18px;line-height:1.6;"><strong>Issue date:</strong> ${escapeHtml(issueLabel(issue))}<br><strong>Status:</strong> APPROVED<br><strong>Approved:</strong> ${escapeHtml(new Date(approvedAt).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }))}</p><p style="font-size:17px;line-height:1.6;">This issue is approved and ready for handoff when you choose.</p>`);
  } catch (error) {
    console.error("Newsletter approval storage failure", { name: error.name });
    return errorPage(500, "Approval storage is temporarily unavailable. No approval was recorded; please try again later.");
  }
};

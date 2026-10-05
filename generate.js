const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataFile = process.argv[2] || "newsletter-data.json";
const dataPath = path.resolve(root, dataFile);
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const template = fs.readFileSync(path.join(root, "newsletter-template.html"), "utf8");
const MASTER_SUBJECT_LINE = "A Short Weekly Update";

const themes = [
  { name: "Warm Morning", outer: "#f7efe4", headerAccent: "#d69b4c" },
  { name: "Lake Blue", outer: "#e7f3f7", headerAccent: "#3a96c2" },
  { name: "Garden Green", outer: "#edf6ec", headerAccent: "#6aa35f" },
  { name: "Porch Light", outer: "#fff7df", headerAccent: "#d8a328" },
  { name: "Soft Clay", outer: "#f8ebe3", headerAccent: "#c97b53" }
];

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeUrl = (value = "") => {
  const url = String(value || "").trim();
  return /^(https?:|mailto:|tel:|sms:)/i.test(url) || /^assets\/[a-z0-9._/-]+$/i.test(url)
    ? escapeHtml(url)
    : "";
};

const rotate = (items, index) => items[((Number(index) || 0) % items.length + items.length) % items.length];
const cleanText = (value) => String(value || "").trim();
const paragraphList = (items = []) => items.map((text) => `<p style="margin:12px 0 0;">${escapeHtml(text)}</p>`).join("");
const bulletList = (items = []) => items.length
  ? `<ul style="margin:10px 0 0; padding-left:22px;">${items.map((item) => `<li style="margin:5px 0;">${escapeHtml(item)}</li>`).join("")}</ul>`
  : "";

const theme = rotate(themes, data.themeIndex);
const note = data.dannysNote || data.quickNote || {};
const noteParagraphs = Array.isArray(note.paragraphs) ? note.paragraphs.filter(cleanText) : [];
const dannysNote = `<p style="margin:10px 0 0;">${escapeHtml(note.greeting || "Hey friends,")}</p>${paragraphList(noteParagraphs)}`;

const marketNote = data.market?.verificationNote
  ? `<div style="margin-top:14px; font-size:11px; line-height:17px; color:#5f6b76;">${escapeHtml(data.market.verificationNote)}</div>`
  : data.market?.source
    ? `<div style="margin-top:14px; font-size:11px; line-height:17px; color:#5f6b76;">Source: ${escapeHtml(data.market.source)}</div>`
    : "";
const marketContent = `
  <div style="padding-top:8px; font-family:Georgia,'Times New Roman',serif; font-size:22px; line-height:28px; font-weight:bold; color:#17324d;">${escapeHtml(data.market?.title || "Market snapshot")}</div>
  ${paragraphList(data.market?.paragraphs || [])}
  ${marketNote}
`;

const featurePalette = [
  { bg: "#fff7ed", border: "#f97316", label: "#c9560d" },
  { bg: "#f0fff4", border: "#16a34a", label: "#16823d" },
  { bg: "#f5f0ff", border: "#7c3aed", label: "#6b2bd1" },
  { bg: "#fffdf8", border: "#c8a24a", label: "#9a6b00" }
];

function renderFeature(feature, index) {
  const palette = featurePalette[index % featurePalette.length];
  const paragraphs = Array.isArray(feature.paragraphs) ? feature.paragraphs.filter(cleanText) : [];
  const bullets = Array.isArray(feature.items) ? feature.items.filter(cleanText) : [];
  const href = safeUrl(feature.link);
  const imageUrl = safeUrl(feature.imageUrl);
  const image = imageUrl
    ? `<img src="${imageUrl}" width="500" alt="${escapeHtml(feature.imageAlt || feature.title)}" style="display:block; width:100%; max-width:500px; height:auto; margin:14px auto 0; border:0;">`
    : "";
  const link = href
    ? `<p style="margin:13px 0 0;"><a href="${href}" style="color:#2563eb; text-decoration:underline; font-weight:bold;">Read more</a></p>`
    : "";
  const source = cleanText(feature.source)
    ? `<div style="margin-top:14px; font-size:11px; line-height:17px; color:#5f6b76;">${escapeHtml(feature.source)}</div>`
    : "";
  const meta = [feature.cityState, feature.availability, feature.driveTimeFromGwinnett].filter(cleanText).join(" | ");
  return `
                <!--ROTATING_FEATURE_SECTION-->
                <tr>
                  <td style="padding:12px 26px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%; background-color:${palette.bg}; border-left:5px solid ${palette.border};">
                      <tr>
                        <td style="padding:22px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; color:#26384a;">
                          <div style="font-size:12px; line-height:16px; font-weight:bold; letter-spacing:1.2px; color:${palette.label};">${escapeHtml(feature.label || feature.type || "LOCAL FEATURE")}</div>
                          <div style="padding-top:8px; font-family:Georgia,'Times New Roman',serif; font-size:21px; line-height:27px; font-weight:bold; color:#17324d;">${escapeHtml(feature.title || "Local feature")}</div>
                          ${meta ? `<div style="padding-top:5px; font-size:13px; line-height:19px; color:#687076;">${escapeHtml(meta)}</div>` : ""}
                          ${paragraphList(paragraphs)}
                          ${bulletList(bullets)}
                          ${feature.closing ? `<p style="margin:12px 0 0;">${escapeHtml(feature.closing)}</p>` : ""}
                          ${image}
                          ${link}
                          ${source}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

const rotatingFeatures = Array.isArray(data.rotatingFeatures)
  ? data.rotatingFeatures.filter((feature) => feature && feature.include !== false)
  : [];
const rotatingFeatureSections = rotatingFeatures.map(renderFeature).join("");

const cartoonUrl = safeUrl(data.cartoon?.imageUrl);
if (!/^https:\/\//i.test(cartoonUrl)) {
  throw new Error("Cartoon Corner requires a generated image with a public HTTPS imageUrl before HTML can be generated.");
}
const cartoonImage = `<img src="${cartoonUrl}" width="500" alt="${escapeHtml(data.cartoon.imageAlt)}" style="display:block; width:100%; max-width:500px; height:auto; margin:14px auto 0; border:0;">`;
const cartoonContent = `
  ${cartoonImage}
  <div style="padding-top:15px; text-align:center; font-family:Georgia,'Times New Roman',serif; font-size:20px; line-height:27px; font-weight:bold; color:#5f4b00;">${escapeHtml(data.cartoon?.caption || "")}</div>
  ${data.cartoon?.closing ? `<p style="margin:10px 0 0; text-align:center;">${escapeHtml(data.cartoon.closing)}</p>` : ""}
`;

const actionButtons = `
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:100%; max-width:470px;">
                            <tr>
                              <td align="center" width="50%" style="width:50%; padding:4px 4px 5px 0;">
                                <a href="tel:+14047718629" style="display:block; padding:13px 10px; border-radius:4px; background-color:#f2b94f; color:#17324d; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:18px; font-weight:bold; text-decoration:none;">Call Danny</a>
                              </td>
                              <td align="center" width="50%" style="width:50%; padding:4px 0 5px 4px;">
                                <a href="sms:+14047718629" style="display:block; padding:13px 10px; border-radius:4px; background-color:#f2b94f; color:#17324d; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:18px; font-weight:bold; text-decoration:none;">Text Danny</a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" colspan="2" style="padding:5px 0;">
                                <a href="https://emmettrealtygroup.com/equity-report" style="display:block; padding:13px 16px; border-radius:4px; background-color:#ffffff; color:#17324d; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:18px; font-weight:bold; text-decoration:none;">Request Free Equity Report</a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" colspan="2" style="padding:5px 0;">
                                <a href="https://calendar.app.google/TkqULC8rNLSWrhjt5" style="display:block; padding:13px 16px; border-radius:4px; background-color:#ffffff; color:#17324d; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:18px; font-weight:bold; text-decoration:none;">Book a 15-Minute Call</a>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" colspan="2" style="padding:7px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:19px; color:#d8e3ee;">
                                Prefer email? <a href="mailto:dannyemmett@kw.com" style="color:#f2b94f; text-decoration:underline; font-weight:bold;">Email Danny</a>
                              </td>
                            </tr>
                          </table>`;

const selectedFooterImage = data.footerImages?.length ? rotate(data.footerImages, data.footerImageIndex) : "";
const footerUrl = safeUrl(selectedFooterImage);
const footerImageSection = footerUrl
  ? `<tr><td style="padding:0 26px 22px;"><img src="${footerUrl}" width="548" alt="Around Gwinnett" style="display:block; width:100%; max-width:548px; height:auto; margin:0; border:0;"></td></tr>`
  : "";

const replacements = {
  SUBJECT_LINE: escapeHtml(MASTER_SUBJECT_LINE),
  PREVIEW_TEXT: escapeHtml(data.previewText),
  ISSUE_DATE: escapeHtml(data.issueDate),
  OUTER_BACKGROUND: theme.outer,
  HEADER_ACCENT: theme.headerAccent,
  DANNYS_NOTE: dannysNote,
  MARKET_CONTENT: marketContent,
  ROTATING_FEATURE_SECTIONS: rotatingFeatureSections,
  CARTOON_CONTENT: cartoonContent,
  REFERRAL_TITLE: escapeHtml(data.referralShare?.title || "Know someone who may find this helpful?"),
  REFERRAL_COPY: escapeHtml(data.referralShare?.copy || "Feel free to forward this along. I am always glad to be a local resource for your friends, family, and neighbors."),
  REFERRAL_PS: escapeHtml(data.referralShare?.ps || "If this was useful, feel free to forward it to a neighbor or friend."),
  ACTION_BUTTONS: actionButtons,
  FOOTER_IMAGE_SECTION: footerImageSection,
  COMPLIANCE_REMINDER: ""
};

let output = template;
for (const [key, value] of Object.entries(replacements)) {
  output = output.replaceAll(`{{${key}}}`, value);
}

const unresolved = output.match(/{{[A-Z0-9_]+}}/g);
if (unresolved) throw new Error(`Unresolved template fields: ${unresolved.join(", ")}`);

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const issueSlug = String(data.issueDate)
  .toLowerCase()
  .replace(/,/g, "")
  .replace(/\s+/g, "-")
  .replace(/[^a-z0-9-]/g, "");
const datedFileName = `gwinnett-and-beyond-${issueSlug}.html`;
data.subjectLine = MASTER_SUBJECT_LINE;
fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(dist, "newsletter.html"), output, "utf8");
fs.writeFileSync(path.join(dist, datedFileName), output, "utf8");
fs.writeFileSync(path.join(root, "index.html"), output, "utf8");

console.log(`Generated issue dated ${data.issueDate} with theme ${Number(data.themeIndex) + 1}: ${theme.name}`);
console.log(`Subject line rule applied: ${MASTER_SUBJECT_LINE}`);
console.log(`Rotating features rendered: ${rotatingFeatures.length}`);
console.log(path.join(dist, "newsletter.html"));
console.log(path.join(dist, datedFileName));

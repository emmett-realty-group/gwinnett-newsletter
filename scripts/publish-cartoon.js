"use strict";
// Manual cartoon path, for when an image was made outside the unattended pipeline (Canva, ChatGPT, Codex ImageGen).
// Uploads the image to Cloudinary, confirms it is publicly reachable, and saves it into drafts/YYYY-MM-DD.json.
// Caption/alt default to the cartoon concept that belongs to the draft's homeowner tip.
//
//   node scripts/publish-cartoon.js --issue-date YYYY-MM-DD --file C:\path\to\image.png [--caption "..."] [--alt "..."] [--closing "..."]
const fs = require("fs");
const path = require("path");
const C = require("./lib/common");
const { loadTipPool } = require("./lib/tips");
const { uploadAndCheck, buildPrompt } = require("./lib/cartoon");
const { draftPath } = require("./lib/build-issue");

function parseArgs(argv) {
  const args = { root: C.ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (["issue-date", "file", "caption", "alt", "closing", "root"].includes(key)) args[key] = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!C.isValidIso(args["issue-date"])) throw new Error("--issue-date YYYY-MM-DD is required.");
  if (!args.file || !fs.existsSync(args.file)) throw new Error("--file must point to an existing .png, .jpg, or .webp image.");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const issueIso = args["issue-date"];
  const draftFile = draftPath(root, issueIso);
  const draft = C.readJson(draftFile, null);
  if (!draft) throw new Error(`No draft found at ${draftFile}. Run scripts/prestage-newsletter.js --issue-date ${issueIso} first.`);
  const tipFeature = (draft.rotatingFeatures || []).find((f) => f.key === "homeowner-tip");
  const concept = loadTipPool(root).find((tip) => tip.id === tipFeature?.tipId)?.cartoon || {};
  const caption = C.cleanText(args.caption) || C.cleanText(concept.caption);
  const alt = C.cleanText(args.alt) || C.cleanText(concept.alt);
  if (!caption || !alt) throw new Error("Provide --caption and --alt (no tip concept was found in the draft).");

  const ext = path.extname(args.file).toLowerCase();
  const slug = tipFeature?.tipId || "cartoon";
  const local = path.join(root, "assets", "cartoons", `${issueIso}-${slug}${ext}`);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  if (path.resolve(args.file) !== local) fs.copyFileSync(args.file, local);
  const imageUrl = await uploadAndCheck({ root, filePath: local, publicId: `cartoons/${issueIso}-${slug}` });

  draft.cartoon = {
    imageUrl,
    imageAlt: alt,
    caption,
    closing: C.cleanText(args.closing) || C.cleanText(concept.closing),
    imagePrompt: concept.prompt ? buildPrompt(concept.prompt) : "Image supplied manually; see localFile.",
    localFile: path.relative(root, local).replace(/\\/g, "/"),
    tipId: tipFeature?.tipId || null,
    suppliedManually: true
  };
  C.writeJson(draftFile, draft);
  console.log(`Cartoon hosted at ${imageUrl}`);
  console.log(`Saved to ${path.relative(root, draftFile)}. Run the Monday script (with -DryRun first) to build and verify.`);
}

main().catch((error) => {
  console.error(C.nonSecretError(error));
  process.exit(1);
});

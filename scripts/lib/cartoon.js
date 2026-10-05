"use strict";
// Cartoon Corner image pipeline: OpenAI image generation -> local PNG in assets/cartoons -> Cloudinary (unsigned
// preset) -> live HTTPS check. The API key is read from the environment only and is never written or logged.
const fs = require("fs");
const path = require("path");
const { ROOT, cleanText, readJson, nonSecretError } = require("./common");
const { validateUrl } = require("./web");

const STYLE_SUFFIX = " Style: bright, warm, family-friendly editorial newspaper cartoon for a neighborhood newsletter, clean linework, friendly expressions, soft colors, uncluttered composition, wide 16:9 landscape framing. Absolutely no words, letters, numbers, captions, signs, logos, or brand names anywhere in the image. Nobody looks embarrassed, unsafe, or ridiculed.";

function cartoonSettings(root = ROOT) {
  const automation = readJson(path.join(root, "automation.local.json"), {});
  const settings = {
    provider: "openai",
    model: "gpt-image-2.5-flare",
    size: "1536x1024",
    quality: "medium",
    ...(automation.cartoon || {})
  };
  if (process.env.NEWSLETTER_CARTOON_PROVIDER) settings.provider = process.env.NEWSLETTER_CARTOON_PROVIDER;
  if (process.env.OPENAI_IMAGE_MODEL) settings.model = process.env.OPENAI_IMAGE_MODEL;
  return settings;
}

function buildPrompt(concept) {
  return `${cleanText(concept)}${STYLE_SUFFIX}`;
}

async function generateImageFile({ root = ROOT, prompt, outputPath, settings = cartoonSettings(root) }) {
  if (settings.provider !== "openai") throw new Error(`Unsupported cartoon provider: ${settings.provider}`);
  if (!cleanText(process.env.OPENAI_API_KEY)) {
    throw new Error("OPENAI_API_KEY is not set, so the Cartoon Corner image cannot be generated unattended.");
  }
  const { generateImage, saveBase64Image } = require(path.join(root, "scripts", "openai-api.js"));
  const payload = { model: settings.model, prompt, size: settings.size, n: 1 };
  if (settings.quality) payload.quality = settings.quality;
  let response;
  try {
    response = await generateImage(payload);
  } catch (error) {
    throw new Error(`Image generation failed: ${nonSecretError(error)}`);
  }
  const b64 = response?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image data.");
  saveBase64Image(b64, outputPath);
  const size = fs.statSync(outputPath).size;
  if (size < 20000) throw new Error(`Generated image looks too small (${size} bytes).`);
  return outputPath;
}

async function uploadAndCheck({ root = ROOT, filePath, publicId }) {
  const { uploadImage } = require(path.join(root, "scripts", "cloudinary-upload.js"));
  const url = await uploadImage({ filePath, publicId, configPath: path.join(root, "cloudinary-config.json") });
  if (!/^https:\/\/res\.cloudinary\.com\//i.test(cleanText(url))) throw new Error(`Unexpected image URL from Cloudinary: ${url}`);
  const check = await validateUrl(url);
  if (!check.ok || !/^image\//i.test(check.contentType || "")) throw new Error(`Uploaded cartoon is not publicly reachable as an image (${check.reason || check.contentType}).`);
  return url;
}

// Creates, hosts, and returns a complete cartoon block for the issue.
async function produceCartoon({ root = ROOT, issueIso, slug, concept, report }) {
  const outputPath = path.join(root, "assets", "cartoons", `${issueIso}-${slug}.png`);
  const prompt = buildPrompt(concept.prompt);
  if (!fs.existsSync(outputPath)) {
    await generateImageFile({ root, prompt, outputPath });
    report.cartoonActions.push(`Generated ${path.relative(root, outputPath)}`);
  } else {
    report.cartoonActions.push(`Reused this issue's already-generated ${path.relative(root, outputPath)}`);
  }
  const imageUrl = await uploadAndCheck({ root, filePath: outputPath, publicId: `cartoons/${issueIso}-${slug}` });
  report.cartoonActions.push(`Hosted at ${imageUrl}`);
  return {
    imageUrl,
    imageAlt: cleanText(concept.alt) || "Family-friendly newsletter cartoon",
    caption: cleanText(concept.caption),
    closing: cleanText(concept.closing),
    imagePrompt: prompt,
    localFile: path.relative(root, outputPath).replace(/\\/g, "/")
  };
}

module.exports = { produceCartoon, uploadAndCheck, buildPrompt, cartoonSettings, STYLE_SUFFIX };

const fs = require("fs");
const path = require("path");
const { createResponse, extractOutputText, generateImage, saveBase64Image } = require("./openai-api");
const { uploadImage } = require("./cloudinary-upload");

async function main() {
  const clientSlug = process.argv[2];
  if (!clientSlug) {
    throw new Error("Usage: node scripts/generate-client-issue.js <client-slug>");
  }

  const root = path.resolve(__dirname, "..");
  const clientRoot = path.join(root, "clients", clientSlug);
  const clientPath = path.join(clientRoot, "client.json");
  const newsletterPath = path.join(clientRoot, "newsletter-data.json");
  const cloudinaryConfigPath = path.join(root, "cloudinary-config.json");

  const client = JSON.parse(fs.readFileSync(clientPath, "utf8"));
  const newsletter = JSON.parse(fs.readFileSync(newsletterPath, "utf8"));
  const automationPath = path.join(clientRoot, "automation.local.json");
  const automation = fs.existsSync(automationPath)
    ? JSON.parse(fs.readFileSync(automationPath, "utf8"))
    : {};
  const openaiConfig = automation.openai || {};

  if (openaiConfig.apiKeyEnv && !process.env.OPENAI_API_KEY) {
    const configuredKey = process.env[openaiConfig.apiKeyEnv];
    if (configuredKey) {
      process.env.OPENAI_API_KEY = configuredKey;
    }
  }

  const issueDate = newsletter.issueDate;
  const marketContext = newsletter.market;
  const prompt = buildPrompt({
    client,
    newsletter,
    issueDate,
    marketContext
  });

  const response = await createResponse({
    model: process.env.OPENAI_NEWSLETTER_MODEL || openaiConfig.newsletterModel || "gpt-5",
    tools: [{ type: "web_search_preview" }],
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "newsletter_issue",
        schema: getIssueSchema()
      }
    }
  });

  const generated = JSON.parse(extractOutputText(response));
  mergeGeneratedIssue(newsletter, generated);

  const issueIsoDate = issueDateToIsoDate(issueDate);
  const imageDir = path.join(clientRoot, "assets", "generated");
  const imagePath = path.join(imageDir, `${issueIsoDate}-cartoon.png`);

  const imageResponse = await generateImage({
    model: process.env.OPENAI_IMAGE_MODEL || openaiConfig.imageModel || "gpt-image-1",
    prompt: generated.cartoon.imagePrompt,
    size: "1536x1024"
  });

  const base64Image = imageResponse.data?.[0]?.b64_json;
  if (!base64Image) {
    throw new Error("Image generation did not return image data.");
  }

  saveBase64Image(base64Image, imagePath);

  const publicId = `clients/${clientSlug}/cartoons/${issueIsoDate}-cartoon`;
  const imageUrl = await uploadImage({
    filePath: imagePath,
    publicId,
    configPath: cloudinaryConfigPath
  });

  newsletter.cartoon.imageUrl = imageUrl;
  delete newsletter.cartoon.imagePrompt;

  fs.writeFileSync(newsletterPath, `${JSON.stringify(newsletter, null, 2)}\n`, "utf8");

  const issuesDir = path.join(clientRoot, "issues");
  fs.mkdirSync(issuesDir, { recursive: true });
  fs.writeFileSync(path.join(issuesDir, `${issueIsoDate}.json`), `${JSON.stringify(newsletter, null, 2)}\n`, "utf8");

  console.log(`Generated full issue for ${clientSlug}`);
  console.log(`Saved cartoon asset: ${imagePath}`);
}

function buildPrompt({ client, newsletter, issueDate, marketContext }) {
  return [
    "Create a complete weekly real-estate newsletter issue as strict JSON.",
    "You are writing for a real estate newsletter in Gwinnett County, Georgia.",
    `Issue date: ${issueDate}.`,
    `Brand voice: ${client.brand.voice}.`,
    `Newsletter name: ${client.brand.newsletterName}.`,
    `Tagline: ${client.brand.tagline}.`,
    `Audience: ${client.audience.primary}.`,
    `Market focus: ${client.audience.market}.`,
    `Send schedule: ${client.audience.sendSchedule}.`,
    "",
    "Use the supplied market section as the authoritative market data context. Do not invent different market numbers.",
    JSON.stringify(marketContext, null, 2),
    "",
    "Research with web search to find one current, real local event near the issue date in Gwinnett County or an immediately nearby city relevant to the audience.",
    "Also create a practical homeowner tip suitable for the current season and a light cartoon concept that is safe for email marketing.",
    "",
    "Requirements:",
    "- Keep claims concrete and non-political.",
    "- Subject line should sound natural, local, and useful.",
    "- Preview text should be under 120 characters.",
    "- Quick note should be 3 short paragraphs.",
    "- Homeowner tip should include 4 bullet items.",
    "- Local event must include an official or primary link.",
    "- Cartoon imageAlt, caption, and closing should match the cartoon scene.",
    "- Provide cartoon.imagePrompt as a concise image-generation prompt for a friendly editorial cartoon illustration.",
    "",
    "Return only JSON matching the schema."
  ].join("\n");
}

function getIssueSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      subjectLine: { type: "string" },
      previewText: { type: "string" },
      quickNote: {
        type: "object",
        additionalProperties: false,
        properties: {
          greeting: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 }
        },
        required: ["greeting", "paragraphs"]
      },
      homeownerTip: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          intro: { type: "string" },
          items: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
          closing: { type: "string" }
        },
        required: ["title", "intro", "items", "closing"]
      },
      localEvent: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          link: { type: "string" },
          intro: { type: "string" },
          copy: { type: "string" },
          tip: { type: "string" }
        },
        required: ["title", "link", "intro", "copy", "tip"]
      },
      cartoon: {
        type: "object",
        additionalProperties: false,
        properties: {
          imageAlt: { type: "string" },
          caption: { type: "string" },
          closing: { type: "string" },
          imagePrompt: { type: "string" }
        },
        required: ["imageAlt", "caption", "closing", "imagePrompt"]
      },
      callToAction: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          copy: { type: "string" },
          label: { type: "string" }
        },
        required: ["heading", "copy", "label"]
      }
    },
    required: ["subjectLine", "previewText", "quickNote", "homeownerTip", "localEvent", "cartoon", "callToAction"]
  };
}

function mergeGeneratedIssue(newsletter, generated) {
  newsletter.subjectLine = generated.subjectLine;
  newsletter.previewText = generated.previewText;
  newsletter.quickNote = generated.quickNote;
  newsletter.homeownerTip = generated.homeownerTip;
  newsletter.localEvent = generated.localEvent;
  newsletter.cartoon = {
    ...newsletter.cartoon,
    ...generated.cartoon
  };
  newsletter.callToAction = {
    ...newsletter.callToAction,
    ...generated.callToAction,
    url: newsletter.callToAction.url
  };
}

function issueDateToIsoDate(issueDate) {
  const parsed = new Date(`${issueDate} 12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Could not parse issue date: ${issueDate}`);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

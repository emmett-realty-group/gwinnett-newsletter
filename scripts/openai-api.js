const fs = require("fs");
const https = require("https");
const path = require("path");

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

function getOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  return apiKey;
}

async function createResponse(payload) {
  return requestJson("/responses", payload);
}

async function generateImage(payload) {
  return requestJson("/images/generations", payload, 300000);
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block.type === "output_text" && typeof block.text === "string") {
        return block.text;
      }
    }
  }

  throw new Error("OpenAI response did not include output text.");
}

function saveBase64Image(base64Data, outputPath) {
  const buffer = Buffer.from(base64Data, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function requestJson(pathname, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(pathname, OPENAI_BASE_URL);
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${getOpenAiApiKey()}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          const parsed = raw ? JSON.parse(raw) : {};
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed);
            return;
          }
          reject(new Error(parsed.error?.message || `OpenAI request failed: ${response.statusCode}`));
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("OpenAI request timed out."));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

module.exports = {
  createResponse,
  extractOutputText,
  generateImage,
  saveBase64Image
};

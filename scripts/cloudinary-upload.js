const fs = require("fs");
const path = require("path");

const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

async function uploadImage({ filePath, publicId, configPath }) {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[extension];
  if (!mimeType) {
    throw new Error(`Unsupported image type: ${extension}`);
  }

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(filePath)], { type: mimeType }), path.basename(filePath));
  form.append("upload_preset", config.uploadPreset);
  form.append("folder", config.folder);
  form.append("public_id", publicId);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    { method: "POST", body: form }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error?.message || `Cloudinary upload failed: ${response.status}`);
  }

  return result.secure_url;
}

module.exports = {
  uploadImage
};

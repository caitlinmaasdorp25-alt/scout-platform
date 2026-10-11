const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// v0.9 keeps a provider-neutral storage boundary. Local storage is the default;
// a future S3-compatible adapter can implement the same saveImage contract.
async function saveImage({ filename, buffer }) {
  const safe = path.basename(filename);
  const target = path.join(UPLOAD_DIR, safe);
  await fs.promises.writeFile(target, buffer);
  return `/uploads/${safe}`;
}

function resolveUpload(file) {
  return path.join(UPLOAD_DIR, path.basename(file));
}

module.exports = { saveImage, resolveUpload, UPLOAD_DIR };

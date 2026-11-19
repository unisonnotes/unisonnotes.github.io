// Pictures in notes. The free Firebase plan has no file storage, so images are
// shrunk in the browser (≤1400px, WebP or JPEG) and stored as data URLs in the
// database at images/{docId}/{imageId}, outside the doc so the doc listener stays
// light. Notes reference them as ![alt](img:<id>) and load them lazily.
import { saveImage, getImage } from "./store.js";

const MAX_SIDE = 1400;
const MAX_CHARS = 1_900_000; // rules cap the data URL at 2,000,000 characters

let currentDoc = null;
/** The doc whose images notes refer to (set by the open doc page). */
export const setImageDoc = (docId) => {
  currentDoc = docId;
};
export const imageDoc = () => currentDoc;

const cache = new Map(); // `${docId}/${id}` → Promise<{data, w, h} | null>

/** Load an image of the current doc (cached). Resolves null when missing or unreadable. */
export function loadImage(id, docId = currentDoc) {
  const key = `${docId}/${id}`;
  if (!cache.has(key)) cache.set(key, getImage(docId, id).catch(() => null));
  return cache.get(key);
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

/** Shrink and re-encode an image Blob/File. Returns {data, w, h}. */
export async function compressImage(blob) {
  const bitmap = await createImageBitmap(blob);
  let side = MAX_SIDE;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // JPEG has no transparency; keep diagrams readable
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      const quality = 0.82 - attempt * 0.1;
      let out = await new Promise((r) => canvas.toBlob(r, "image/webp", quality));
      if (!out || out.type !== "image/webp") out = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
      const data = await blobToDataUrl(out);
      if (data.length <= MAX_CHARS) return { data, w, h };
      side = Math.round(side * 0.75);
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error("That image is too large to add.");
}

/** Compress and store an image for `docId`. Returns the image id. */
export async function addImage(docId, user, blob) {
  const img = await compressImage(blob);
  const id = await saveImage(docId, user, img);
  cache.set(`${docId}/${id}`, Promise.resolve(img));
  return id;
}

/**
 * Store every picture an import brought along. Returns Map(importKey → image id);
 * pictures that can't be read or shrunk enough are skipped.
 */
export async function addImages(docId, user, images, onProgress) {
  const ids = new Map();
  let done = 0;
  onProgress?.(0, images.size);
  for (const [key, blob] of images) {
    try {
      ids.set(key, await addImage(docId, user, blob));
    } catch {
      // skipped: the note keeps its text, the picture is left out
    }
    onProgress?.(++done, images.size);
  }
  return ids;
}

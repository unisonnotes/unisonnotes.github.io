// Import straight from Google Docs, tabs and all. A .docx download loses tab names
// and nesting; the Docs API keeps them. The person picks a doc in Google's own file
// picker, which grants this app access to that one file only (drive.file scope).
import { firebaseConfig } from "./config.js";
import { gdocToOutline } from "./importer.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const PROJECT_NUMBER = firebaseConfig.appId.split(":")[1];

let backend = null;
export const initGoogle = (b) => {
  backend = b;
};
/** Google Docs import needs real Google sign-in (not Local mode). */
export const googleDocsAvailable = () => !!backend?.auth.googleToken;

const scripts = new Map();
const loadScript = (src) => {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          scripts.delete(src);
          reject(new Error("Couldn't load Google's file picker. Check your connection."));
        };
        document.head.append(s);
      }),
    );
  return scripts.get(src);
};

/**
 * Ask for access (popup), then show Google's picker. Resolves {id, name, token}, or
 * null when the person cancels. Must start from a click (popups).
 */
export async function pickGoogleDoc() {
  const token = await backend.auth.googleToken([SCOPE]);
  if (!token) return null;
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((resolve) => window.gapi.load("picker", resolve));
  const P = window.google.picker;
  return new Promise((resolve) => {
    const view = new P.DocsView(P.ViewId.DOCUMENTS).setMimeTypes("application/vnd.google-apps.document").setMode(P.DocsViewMode.LIST);
    new P.PickerBuilder()
      .setTitle("Pick a Google Doc to import")
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(firebaseConfig.apiKey)
      .setAppId(PROJECT_NUMBER)
      .setOrigin(location.origin)
      .setCallback((data) => {
        if (data.action === P.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name, token });
        else if (data.action === P.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

const explain = async (res) => {
  let msg = "";
  try {
    const body = await res.json();
    msg = body.error?.message || "";
    if (body.error?.details?.some((d) => d.reason === "SERVICE_DISABLED") || /has not been used|is disabled/i.test(msg))
      return "The Google Docs API isn't turned on for this app yet (Google Cloud console → APIs & Services → enable “Google Docs API”).";
  } catch {
    // not JSON
  }
  if (res.status === 403 || res.status === 404) return "Google didn't share that doc with Unison. Pick it again from the list.";
  return msg || `Google Docs said ${res.status}.`;
};

/**
 * Read a picked Google Doc: tabs (with real names and nesting), formatting and
 * pictures. Returns the same shape as readImport plus `skipped` (pictures that
 * couldn't be downloaded).
 */
export async function readGoogleDoc({ id, token }, onProgress) {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}?includeTabsContent=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await explain(res));
  const out = gdocToOutline(await res.json());
  const images = new Map();
  let done = 0;
  let skipped = 0;
  for (const [key, uri] of out.imageUris) {
    onProgress?.(done, out.imageUris.size);
    try {
      const r = await fetch(uri);
      if (!r.ok) throw new Error(String(r.status));
      images.set(key, await r.blob());
    } catch {
      skipped++;
    }
    done++;
  }
  return { title: out.title, items: out.items, style: out.style, images, skipped };
}

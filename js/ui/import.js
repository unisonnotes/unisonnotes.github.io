// Import dialog: drop a Word / Google Docs / Markdown / text file (or paste), see how
// it maps onto tabs, topics and notes, then bring it in with its pictures.
import { html, useState, useEffect, useRef, useMemo } from "./h.js";
import { Icon } from "./icons.js";
import { Modal, toast } from "./kit.js";
import { readImport, htmlToOutline, textToOutline } from "../importer.js";
import { planOutline } from "../weave.js";
import { importOutline } from "../store.js";
import { addImages } from "../images.js";

/** Store an import's pictures, then its tabs, topics and notes. `opts` go to importOutline. */
export async function importInto(docId, user, { items, images, progress }, opts = {}) {
  const imageIds = images?.size ? await addImages(docId, user, images, (d, t) => progress?.("Saving pictures", d, t)) : null;
  return importOutline(docId, user, items, { ...opts, imageIds, onProgress: (d, t) => progress?.("Adding notes", d, t) });
}

const ACCEPT = ".docx,.md,.markdown,.txt,.html,.htm";
const SHOW = 160;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const plainPreview = (t) =>
  t
    .replace(/!\[[^\]]*\]\(img:[\w-]+\)/g, "▣ picture")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(\*\*|\+\+|~~|==)/g, "");

function Preview({ items, images }) {
  const plan = useMemo(() => planOutline(items), [items]);
  const tabs = plan.filter((i) => i.kind === "tab").length;
  const topics = plan.filter((i) => i.kind === "section").length;
  const notes = plan.length - topics - tabs;
  return html`<div class="import-preview">
    <div class="kicker">
      Preview · ${[tabs && plural(tabs, "tab"), plural(topics, "topic"), plural(notes, "note"), images && plural(images, "picture")].filter(Boolean).join(" · ")}
    </div>
    <ol class="import-outline">
      ${plan.slice(0, SHOW).map((it, i) => {
        if (it.kind === "tab") return html`<li key=${i} class="io-tab"><${Icon} name="file-text" size=${13} /> ${it.text}</li>`;
        if (it.kind === "section")
          return html`<li key=${i} class=${"io-h io-h--" + Math.min(it.depth, 2)}><span class="mono">${"#".repeat(it.depth + 1)}</span> ${it.text}</li>`;
        const t = plainPreview(it.text);
        return html`<li key=${i} class="io-n" style=${{ "--d": it.depth }}>${t.length > 140 ? t.slice(0, 139) + "…" : t}</li>`;
      })}
      ${plan.length > SHOW && html`<li class="io-more mono">…and ${(plan.length - SHOW).toLocaleString()} more</li>`}
    </ol>
  </div>`;
}

/**
 * `onImport({title, items, images, style, progress})` does the writing and calls
 * `progress(label, done, total)` so the dialog can show how far along it is.
 */
export function ImportModal({ open, onClose, onImport, mode = "new" }) {
  const [result, setResult] = useState(null); // {title, items, images, style, source}
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {label, done, total}
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setTitle("");
      setError("");
      setProgress(null);
    }
  }, [open]);

  const take = (r, source) => {
    if (!r.items.length) {
      setError("Nothing to import in that.");
      return;
    }
    setError("");
    setResult({ ...r, images: r.images || new Map(), source });
    setTitle((t) => t || r.title || "");
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      take(await readImport(file), file.name);
    } catch (e) {
      setError(e.message || "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e) => {
    const rich = e.clipboardData?.getData("text/html");
    const plain = e.clipboardData?.getData("text/plain") || "";
    if (!rich && !plain.trim()) return;
    e.preventDefault();
    take(rich ? htmlToOutline(rich) : textToOutline(plain), "pasted text");
  };

  const go = async () => {
    setBusy(true);
    try {
      await onImport({
        title: title.trim() || "Imported notes",
        items: result.items,
        images: result.images,
        style: result.style,
        progress: (label, done, total) => setProgress({ label, done, total }),
      });
    } catch (e) {
      toast(e.message || "Import failed", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };
  const notes = result ? result.items.filter((i) => i.kind === "note").length : 0;

  return html`<${Modal}
    open=${open}
    onClose=${busy ? () => {} : onClose}
    title=${mode === "new" ? "Import a document" : "Import into this doc"}
    subtitle="Tabs stay tabs, headings become topics, lists and paragraphs become notes. Formatting and pictures come along."
    icon="file-up"
    width=${640}
    footer=${progress
      ? html`<div class="import-progress">
          <span class="mono">${progress.label} ${progress.total ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}` : ""}</span>
          <span class="import-bar"><i style=${{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }} /></span>
        </div>`
      : html`${result && html`<button class="btn btn--ghost" onClick=${() => setResult(null)}>Choose another</button>`}
          <span class="grow" />
          <button class="btn btn--ghost" onClick=${onClose}>Cancel</button>
          <button class="btn btn--primary" disabled=${!result || busy} onClick=${go}>
            ${busy ? "Importing…" : mode === "new" ? "Create doc" : `Add ${notes.toLocaleString()} notes`} <${Icon} name="arrow-right" />
          </button>`}
  >
    ${!result
      ? html`<div
            class=${"dropzone" + (drag ? " is-drag" : "")}
            onDragOver=${(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave=${() => setDrag(false)}
            onDrop=${(e) => {
              e.preventDefault();
              setDrag(false);
              onFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span class="dropzone-icon"><${Icon} name="file-up" size=${26} stroke=${1.5} /></span>
            <b>${busy ? "Reading…" : "Drop a file here"}</b>
            <span class="muted">Word (.docx), Google Docs, Markdown (.md), web page (.html) or plain text</span>
            <button class="btn" onClick=${() => fileRef.current.click()} disabled=${busy}><${Icon} name="file-text" /> Choose a file</button>
            <input ref=${fileRef} type="file" accept=${ACCEPT} hidden onChange=${(e) => onFile(e.target.files?.[0])} />
          </div>
          <div class="paste-zone">
            <textarea class="field field--area" rows="3" placeholder="…or click here and paste (Ctrl+V). Copying straight out of Google Docs or Word keeps headings, lists and formatting." onPaste=${onPaste} />
          </div>
          <p class="import-tip"><${Icon} name="circle-help" size=${14} /> From Google Docs: <b>File → Download → Microsoft Word (.docx)</b>. Tabs, pictures and formatting come along.</p>
          ${error && html`<p class="import-error"><${Icon} name="triangle-alert" size=${14} /> ${error}</p>`}`
      : html`<div class="import-source mono"><${Icon} name="check" size=${14} /> ${result.source}</div>
          ${mode === "new" &&
          html`<label class="field-label">
            <span>Doc title</span>
            <input class="field" value=${title} onInput=${(e) => setTitle(e.target.value)} disabled=${busy} />
          </label>`}
          <${Preview} items=${result.items} images=${result.images.size} />`}
  <//>`;
}

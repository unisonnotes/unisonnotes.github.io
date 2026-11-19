// Import dialog: drop a Word / Google Docs / Markdown / text file (or paste), see how
// it maps onto topics and notes, then bring it in.
import { html, useState, useEffect, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Modal, toast } from "./kit.js";
import { readImport, htmlToOutline, textToOutline } from "../importer.js";

const ACCEPT = ".docx,.md,.markdown,.txt,.html,.htm";

function Preview({ items }) {
  const topics = items.filter((i) => i.kind === "section").length;
  const notes = items.length - topics;
  return html`<div class="import-preview">
    <div class="kicker">Preview · ${topics} topic${topics === 1 ? "" : "s"} · ${notes} note${notes === 1 ? "" : "s"}</div>
    <ol class="import-outline">
      ${items.slice(0, 80).map((it, i) =>
        it.kind === "section"
          ? html`<li key=${i} class=${"io-h io-h--" + it.level}><span class="mono">${"#".repeat(it.level + 1)}</span> ${it.text}</li>`
          : html`<li key=${i} class="io-n" style=${{ "--d": it.depth }}>${it.text.length > 140 ? it.text.slice(0, 139) + "…" : it.text}</li>`,
      )}
      ${items.length > 80 && html`<li class="io-more mono">…and ${items.length - 80} more</li>`}
    </ol>
  </div>`;
}

export function ImportModal({ open, onClose, onImport, mode = "new" }) {
  const [result, setResult] = useState(null); // {title, items, source}
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setTitle("");
      setError("");
    }
  }, [open]);

  const take = (r, source) => {
    if (!r.items.length) {
      setError("Nothing to import in that.");
      return;
    }
    setError("");
    setResult({ ...r, source });
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
      await onImport({ title: title.trim() || "Imported notes", items: result.items });
    } catch (e) {
      toast(e.message || "Import failed", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title=${mode === "new" ? "Import a document" : "Import into this doc"}
    subtitle="Headings become topics, lists and paragraphs become notes."
    icon="file-up"
    width=${640}
    footer=${html`${result && html`<button class="btn btn--ghost" onClick=${() => setResult(null)}>Choose another</button>`}
      <span class="grow" />
      <button class="btn btn--ghost" onClick=${onClose}>Cancel</button>
      <button class="btn btn--primary" disabled=${!result || busy} onClick=${go}>
        ${busy ? "Importing…" : mode === "new" ? "Create doc" : `Add ${result ? result.items.length : ""} items`} <${Icon} name="arrow-right" />
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
            <textarea class="field field--area" rows="3" placeholder="…or click here and paste (Ctrl+V). Copying straight out of Google Docs or Word keeps headings, lists and bold." onPaste=${onPaste} />
          </div>
          <p class="import-tip"><${Icon} name="circle-help" size=${14} /> From Google Docs: <b>File → Download → Microsoft Word (.docx)</b>, or select all and copy.</p>
          ${error && html`<p class="import-error"><${Icon} name="triangle-alert" size=${14} /> ${error}</p>`}`
      : html`<div class="import-source mono"><${Icon} name="check" size=${14} /> ${result.source}</div>
          ${mode === "new" &&
          html`<label class="field-label">
            <span>Doc title</span>
            <input class="field" value=${title} onInput=${(e) => setTitle(e.target.value)} />
          </label>`}
          <${Preview} items=${result.items} />`}
  <//>`;
}

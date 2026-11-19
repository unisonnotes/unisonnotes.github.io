// Edit mode: the woven notes turned into an ordinary document anyone with edit access
// can rewrite freely, with a word-processor toolbar. It's a separate "final copy";
// streams and the woven doc stay untouched. One person types at a time: a soft lock
// shows who is editing, and everyone else sees their changes as they save.
import { html, useState, useEffect, useRef, useMemo, useCallback } from "./h.js";
import { Icon } from "./icons.js";
import { Menu, toast, ask, timeAgo, Kbd } from "./kit.js";
import { FONTS } from "./format.js";
import { weaveToHtml, inlineHtml } from "../weave.js";
import * as store from "../store.js";

const LOCK_MS = 45_000;
const SAVE_MS = 700;

// ───────────── Sanitizing (draft HTML is shared between members) ─────────────

const TAGS = new Set("P H1 H2 H3 H4 UL OL LI B STRONG I EM U S STRIKE DEL MARK SPAN A BR BLOCKQUOTE CODE PRE SUB SUP DIV HR FONT".split(" "));
const DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED TEMPLATE SVG MATH LINK META NOSCRIPT FORM INPUT BUTTON TEXTAREA SELECT IMG VIDEO AUDIO".split(" "));
const STYLES = ["font-family", "font-size", "font-weight", "font-style", "text-decoration-line", "text-decoration", "color", "background-color", "text-align", "margin-left", "padding-left"];

export function sanitize(dirty) {
  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, "text/html");
  const walk = (node) => {
    for (const el of [...node.childNodes]) {
      if (el.nodeType === Node.TEXT_NODE) continue;
      if (el.nodeType !== Node.ELEMENT_NODE) {
        el.remove();
        continue;
      }
      if (DROP.has(el.tagName)) {
        el.remove();
        continue;
      }
      walk(el);
      if (!TAGS.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const keep = [];
      for (const prop of STYLES) {
        const v = el.style.getPropertyValue(prop);
        if (v && !/url\(|expression|javascript:/i.test(v)) keep.push(`${prop}: ${v}`);
      }
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      const cls = el.getAttribute("class") === "doc-byline" ? "doc-byline" : null;
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      if (keep.length) el.setAttribute("style", keep.join("; "));
      if (cls) el.setAttribute("class", cls);
      if (href && /^(https?:|mailto:)/i.test(href.trim())) {
        el.setAttribute("href", href.trim());
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

// ───────────── Toolbar bits ─────────────

const BLOCKS = [
  ["p", "Normal text"],
  ["h1", "Title"],
  ["h2", "Heading 1"],
  ["h3", "Heading 2"],
  ["h4", "Heading 3"],
  ["blockquote", "Quote"],
];
const COLORS = ["#16181d", "#5f6672", "#d23f31", "#d9822b", "#b8860b", "#1a8f4c", "#0b85b0", "#3461f2", "#8b5cf6", "#c2257a"];
const HILITES = ["transparent", "#fff3a3", "#ffd6a5", "#ffc9de", "#d7f5c4", "#c9e7ff", "#e4d7ff"];

function Tb({ icon, label, on, onDo, disabled }) {
  return html`<button
    class=${"tb-btn" + (on ? " is-on" : "")}
    title=${label}
    aria-label=${label}
    aria-pressed=${!!on}
    disabled=${disabled}
    onMouseDown=${(e) => e.preventDefault()}
    onClick=${onDo}
  ><${Icon} name=${icon} size=${16} /></button>`;
}

const Sep = () => html`<span class="tb-sep" />`;

function Swatches({ colors, onPick, label }) {
  return html`<div class="swatches" onMouseDown=${(e) => e.preventDefault()}>
    <div class="menu-heading">${label}</div>
    <div class="swatch-row">
      ${colors.map(
        (c) => html`<button key=${c} class=${"sw" + (c === "transparent" ? " sw--none" : "")} style=${{ background: c }} title=${c === "transparent" ? "None" : c} onClick=${() => onPick(c)} />`,
      )}
    </div>
  </div>`;
}

// ───────────── Editor ─────────────

export function EditMode({ ctx }) {
  const { doc, docId, user, canEdit, woven, nameOf, now } = ctx;
  const draft = doc.draft;
  const editorRef = useRef(null);
  const rangeRef = useRef(null);
  const lastSaved = useRef(null);
  const saveTimer = useRef(null);
  const lastInput = useRef(0);
  const [state, setState] = useState({});
  const [saving, setSaving] = useState(false);

  const lock = draft?.lock;
  const lockedByOther = lock && lock.uid !== user.uid && now - (lock.at || 0) < LOCK_MS;
  const canType = canEdit && !!draft && !lockedByOther;
  const newest = useMemo(() => Math.max(0, ...Object.values(doc.notes || {}).map((n) => n.createdAt || 0)), [doc.notes]);
  const newCount = useMemo(
    () => (draft ? Object.values(doc.notes || {}).filter((n) => (n.createdAt || 0) > (draft.basedOn || 0)).length : 0),
    [doc.notes, draft?.basedOn],
  );

  // Pull remote changes in unless they're our own echo or we're mid-sentence.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !draft) return;
    const incoming = draft.html || "";
    if (incoming === lastSaved.current) return;
    const typing = document.activeElement === el && Date.now() - lastInput.current < 4000;
    if (typing && !lockedByOther) return;
    el.innerHTML = sanitize(incoming);
    lastSaved.current = incoming;
  }, [draft?.html]);

  const save = useCallback(
    (extra) => {
      const el = editorRef.current;
      if (!el) return;
      const clean = sanitize(el.innerHTML);
      lastSaved.current = clean;
      setSaving(true);
      store.saveDraft(docId, user, clean, extra).finally(() => setSaving(false));
    },
    [docId],
  );

  const onInput = () => {
    lastInput.current = Date.now();
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), SAVE_MS);
  };

  // Hold the lock while active; let it go when leaving.
  useEffect(() => {
    if (!canType) return;
    const beat = setInterval(() => {
      if (Date.now() - lastInput.current < LOCK_MS) store.lockDraft(docId, user);
    }, 15_000);
    return () => clearInterval(beat);
  }, [canType]);
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (editorRef.current && lastInput.current && sanitize(editorRef.current.innerHTML) !== lastSaved.current) save();
      if (doc.draft?.lock?.uid === user.uid) store.unlockDraft(docId);
    },
    [],
  );

  // Track the selection so toolbar clicks (and selects that steal focus) act on it.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const el = editorRef.current;
      if (!el || !sel.rangeCount || !el.contains(sel.anchorNode)) return;
      rangeRef.current = sel.getRangeAt(0).cloneRange();
      const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const cs = getComputedStyle(node);
      const q = (c) => {
        try {
          return document.queryCommandState(c);
        } catch {
          return false;
        }
      };
      let block = "p";
      try {
        block = (document.queryCommandValue("formatBlock") || "p").toLowerCase();
      } catch {}
      setState({
        bold: q("bold"),
        italic: q("italic"),
        underline: q("underline"),
        strike: q("strikeThrough"),
        ul: q("insertUnorderedList"),
        ol: q("insertOrderedList"),
        left: q("justifyLeft"),
        center: q("justifyCenter"),
        right: q("justifyRight"),
        justify: q("justifyFull"),
        block: BLOCKS.some(([b]) => b === block) ? block : "p",
        size: Math.round(parseFloat(cs.fontSize)),
        font: FONTS.find((f) => cs.fontFamily.toLowerCase().includes(f.css.split(",")[0].replace(/"/g, "").toLowerCase()))?.id,
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const restore = () => {
    const el = editorRef.current;
    el.focus();
    if (rangeRef.current) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(rangeRef.current);
    }
  };
  const exec = (cmd, value = null) => {
    if (!canType) return;
    restore();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(cmd, false, value);
    onInput();
    document.dispatchEvent(new Event("selectionchange"));
  };
  const setSize = (px) => {
    if (!canType) return;
    px = Math.max(8, Math.min(72, px));
    restore();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("fontSize", false, "7");
    for (const n of editorRef.current.querySelectorAll('[style*="xxx-large"], font[size="7"]')) {
      n.removeAttribute("size");
      n.style.fontSize = px + "px";
    }
    onInput();
    document.dispatchEvent(new Event("selectionchange"));
  };
  const link = async () => {
    const saved = rangeRef.current;
    const url = await ask({ title: "Add a link", input: { placeholder: "https://…" }, confirm: "Add link", icon: "link" });
    rangeRef.current = saved;
    if (url) exec("createLink", /^(https?:|mailto:)/i.test(url) ? url : "https://" + url);
  };

  const onKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      exec(e.shiftKey ? "outdent" : "indent");
    }
  };

  const create = () => {
    const el = editorRef.current;
    const body = weaveToHtml(doc, woven, nameOf);
    store.saveDraft(docId, user, sanitize(body), { basedOn: newest }).then(() => toast("Final doc created from the woven notes", { icon: "file-pen-line" }));
    if (el) el.innerHTML = body;
  };
  const rebuild = async () => {
    if (!(await ask({ title: "Rebuild from the notes?", body: "This replaces the final doc with a fresh copy of the woven notes. Edits made here will be lost.", confirm: "Rebuild", danger: true, icon: "rotate-ccw" })))
      return;
    const body = sanitize(weaveToHtml(doc, woven, nameOf));
    editorRef.current.innerHTML = body;
    lastSaved.current = body;
    store.saveDraft(docId, user, body, { basedOn: newest });
  };
  const appendNew = () => {
    const since = draft.basedOn || 0;
    const fresh = Object.entries(doc.notes || {})
      .filter(([, n]) => (n.createdAt || 0) > since)
      .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const bySection = new Map();
    for (const [id, n] of fresh) {
      const sid = woven.sectionOfNote.get(id) ?? null;
      if (!bySection.has(sid)) bySection.set(sid, []);
      bySection.get(sid).push(n);
    }
    let block = `<h2>Added ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</h2>`;
    for (const [sid, notes] of bySection) {
      block += `<h3>${sid ? inlineHtml(doc.sections[sid]?.title || "") : "Other notes"}</h3><ul>${notes.map((n) => `<li>${inlineHtml(n.text)}</li>`).join("")}</ul>`;
    }
    editorRef.current.insertAdjacentHTML("beforeend", sanitize(block));
    save({ basedOn: newest });
    toast(`Added ${fresh.length} new notes at the end`, { icon: "plus" });
  };

  if (!draft)
    return html`<div class="edit-empty">
      <div class="edit-empty-art" aria-hidden="true"><span /><span /><span /><i /></div>
      <h3>Turn the notes into a regular document</h3>
      <p>
        Edit mode makes a final copy of the woven notes that works like a normal word processor: rewrite anything, reorder, change fonts and sizes.
        Everyone's streams and the woven doc stay as they are.
      </p>
      ${canEdit
        ? html`<button class="btn btn--primary btn--lg" onClick=${create}><${Icon} name="file-pen-line" /> Create the final doc</button>`
        : html`<p class="mono muted">No final doc yet. An editor can create one.</p>`}
    </div>`;

  const font = FONTS.find((f) => f.id === state.font);
  return html`<div class="editor-wrap">
    <div class=${"editor-bar" + (canType ? "" : " is-disabled")} role="toolbar" aria-label="Formatting">
      <${Tb} icon="undo-2" label="Undo (Ctrl+Z)" onDo=${() => exec("undo")} />
      <${Tb} icon="redo-2" label="Redo (Ctrl+Y)" onDo=${() => exec("redo")} />
      <${Sep} />
      <${Menu}
        width=${200}
        trigger=${(open, toggle) => html`<button class=${"tb-select" + (open ? " is-open" : "")} onMouseDown=${(e) => e.preventDefault()} onClick=${toggle} title="Text style">
          <span>${BLOCKS.find(([b]) => b === state.block)?.[1] || "Normal text"}</span><${Icon} name="chevron-down" size=${13} />
        </button>`}
        items=${BLOCKS.map(([b, label]) => ({ label: html`<span class=${"block-preview block-preview--" + b}>${label}</span>`, checked: state.block === b, onSelect: () => exec("formatBlock", b === "p" ? "P" : b.toUpperCase()) }))}
      />
      <${Menu}
        width=${210}
        trigger=${(open, toggle) => html`<button class=${"tb-select tb-select--font" + (open ? " is-open" : "")} onMouseDown=${(e) => e.preventDefault()} onClick=${toggle} title="Font">
          <span style=${{ fontFamily: font?.css }}>${font?.name || "Font"}</span><${Icon} name="chevron-down" size=${13} />
        </button>`}
        items=${FONTS.map((f) => ({ label: html`<span style=${{ fontFamily: f.css }}>${f.name}</span>`, checked: f.id === state.font, onSelect: () => exec("fontName", f.css) }))}
      />
      <span class="tb-size" title="Font size">
        <button class="tb-btn tb-btn--sm" onMouseDown=${(e) => e.preventDefault()} onClick=${() => setSize((state.size || 15) - 1)} aria-label="Smaller"><${Icon} name="minus" size=${14} /></button>
        <input
          class="mono"
          value=${state.size || ""}
          onKeyDown=${(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setSize(parseInt(e.target.value, 10) || 15);
            }
          }}
          aria-label="Font size"
        />
        <button class="tb-btn tb-btn--sm" onMouseDown=${(e) => e.preventDefault()} onClick=${() => setSize((state.size || 15) + 1)} aria-label="Larger"><${Icon} name="plus" size=${14} /></button>
      </span>
      <${Sep} />
      <${Tb} icon="bold" label="Bold (Ctrl+B)" on=${state.bold} onDo=${() => exec("bold")} />
      <${Tb} icon="italic" label="Italic (Ctrl+I)" on=${state.italic} onDo=${() => exec("italic")} />
      <${Tb} icon="underline" label="Underline (Ctrl+U)" on=${state.underline} onDo=${() => exec("underline")} />
      <${Tb} icon="strikethrough" label="Strikethrough" on=${state.strike} onDo=${() => exec("strikeThrough")} />
      <${Menu}
        width=${206}
        trigger=${(open, toggle) => html`<button class=${"tb-btn" + (open ? " is-open" : "")} onMouseDown=${(e) => e.preventDefault()} onClick=${toggle} title="Text color" aria-label="Text color"><${Icon} name="baseline" size=${16} /></button>`}
        items=${[{ heading: html`<${Swatches} label="Text color" colors=${COLORS} onPick=${(c) => exec("foreColor", c)} />` }]}
      />
      <${Menu}
        width=${206}
        trigger=${(open, toggle) => html`<button class=${"tb-btn" + (open ? " is-open" : "")} onMouseDown=${(e) => e.preventDefault()} onClick=${toggle} title="Highlight" aria-label="Highlight"><${Icon} name="highlighter" size=${16} /></button>`}
        items=${[{ heading: html`<${Swatches} label="Highlight" colors=${HILITES} onPick=${(c) => exec("hiliteColor", c)} />` }]}
      />
      <${Tb} icon="link" label="Link" onDo=${link} />
      <${Sep} />
      <${Tb} icon="align-left" label="Align left" on=${state.left} onDo=${() => exec("justifyLeft")} />
      <${Tb} icon="align-center" label="Center" on=${state.center} onDo=${() => exec("justifyCenter")} />
      <${Tb} icon="align-right" label="Align right" on=${state.right} onDo=${() => exec("justifyRight")} />
      <${Tb} icon="align-justify" label="Justify" on=${state.justify} onDo=${() => exec("justifyFull")} />
      <${Sep} />
      <${Tb} icon="list" label="Bulleted list" on=${state.ul} onDo=${() => exec("insertUnorderedList")} />
      <${Tb} icon="list-ordered" label="Numbered list" on=${state.ol} onDo=${() => exec("insertOrderedList")} />
      <${Tb} icon="indent-decrease" label="Decrease indent (Shift+Tab)" onDo=${() => exec("outdent")} />
      <${Tb} icon="indent-increase" label="Increase indent (Tab)" onDo=${() => exec("indent")} />
      <${Tb} icon="remove-formatting" label="Clear formatting" onDo=${() => exec("removeFormat")} />
      <span class="grow" />
      <span class="tb-status mono">
        ${lockedByOther
          ? html`<span class="dot-live dot-live--warn" /> ${lock.name} is editing`
          : saving
            ? "saving…"
            : draft.updatedAt
              ? `saved ${timeAgo(draft.updatedAt, now)}`
              : ""}
      </span>
    </div>

    ${lockedByOther &&
    html`<div class="edit-banner">
      <${Icon} name="users" size=${15} />
      <span><b>${lock.name}</b> is editing the final doc right now. You'll see their changes as they save, and can type once they've been idle for a bit.</span>
    </div>`}
    ${canEdit &&
    !lockedByOther &&
    newCount > 0 &&
    html`<div class="edit-banner edit-banner--new">
      <${Icon} name="sparkle" size=${15} />
      <span><b>${newCount} new note${newCount === 1 ? "" : "s"}</b> since this doc was made.</span>
      <button class="btn btn--sm" onClick=${appendNew}><${Icon} name="plus" size=${14} /> Add them at the end</button>
      <button class="btn btn--ghost btn--sm" onClick=${rebuild}><${Icon} name="rotate-ccw" size=${14} /> Rebuild</button>
    </div>`}

    <article class="page editor-page">
      <div
        class="editor"
        ref=${editorRef}
        contenteditable=${canType ? "true" : "false"}
        spellcheck="true"
        onInput=${onInput}
        onKeyDown=${onKeyDown}
        onFocus=${() => canType && store.lockDraft(docId, user)}
        data-placeholder="Start writing…"
      />
    </article>
    <div class="edit-foot mono">
      ${draft.updatedByName && html`<span>Last edited by ${draft.updatedBy === user.uid ? "you" : draft.updatedByName} · ${timeAgo(draft.updatedAt, now)}</span>`}
      ${canEdit && html`<button class="link-btn" onClick=${rebuild}>Rebuild from notes</button>`}
      <span><${Kbd}>Tab<//> indent · <${Kbd}>Ctrl<//> <${Kbd}>Z<//> undo</span>
    </div>
  </div>`;
}

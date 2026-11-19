// Streams: your own column (side panel + composer) and everyone's columns side by side.
// The composer works like a bulleted list: Enter sends a bullet, Tab nests the next one
// under it, Shift+Tab steps back out. A message starting with # / ## / ### is a topic,
// subtopic or sub-subtopic for everyone.
import { html, useState, useEffect, useRef, useMemo, useLayoutEffect } from "./h.js";
import { Icon } from "./icons.js";
import { Avatar, Menu, Kbd, toast, ask, clock, colorFor } from "./kit.js";
import { NoteText } from "./text.js";
import { NoteActions, Suggestions, sectionLabel } from "./woven.js";
import { EditBox } from "./editbox.js";
import { parseInput, parseOutline, extractTags, nextOrder, headingParent, streamOutline, slug, MAX_DEPTH } from "../weave.js";
import * as store from "../store.js";
import { htmlToOutline } from "../importer.js";
import { addImage } from "../images.js";

const HEADING_RE = /^(#{1,3})(?!#)/;
// [label, Markdown wrapper, shortcut, icon]
const FORMATS = [
  ["Bold", "**", "Ctrl B", "bold"],
  ["Italic", "*", "Ctrl I", "italic"],
  ["Strikethrough", "~~", "Ctrl Shift X", "strikethrough"],
  ["Highlight", "==", "Ctrl Shift H", "highlighter"],
  ["Code", "`", "Ctrl E", "code"],
];
const clip = (s, n = 42) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function SectionChip({ ctx, sid }) {
  const s = sid && ctx.doc.sections?.[sid];
  return html`<button class=${"sec-chip mono" + (s ? "" : " sec-chip--none")} onClick=${(e) => (e.stopPropagation(), ctx.scrollToSection(sid || null))} title="Go to this topic">${s ? s.title : "Unsorted"}</button>`;
}


function MyNote({ ctx, entry, prevSibling, fresh }) {
  const { note, depth, foreignParent } = entry;
  const [editing, setEditing] = useState(false);
  const placed = ctx.woven.sectionOfNote.get(note.id) ?? null;
  const item = ctx.woven.groupOfNote.get(note.id);
  const dup = item && item.authors.length > 1;
  const conflict = item && item.conflicts.some((c) => c.note === note.id);
  const under = foreignParent && ctx.doc.notes?.[foreignParent];
  const extra = [];
  if (prevSibling && depth < MAX_DEPTH)
    extra.push({
      label: "Indent",
      hint: `sub-point of “${clip(prevSibling.text, 28)}”`,
      icon: "arrow-right",
      onSelect: () => store.setNoteParent(ctx.docId, note.id, prevSibling.id, ctx.woven.sectionOfNote.get(prevSibling.id)),
    });
  if (note.parentId && ctx.doc.notes?.[note.parentId]) {
    const grand = ctx.doc.notes[note.parentId].parentId || null;
    extra.push({
      label: "Outdent",
      hint: grand ? "one level up" : "make it a main point",
      icon: "arrow-left",
      onSelect: () => store.setNoteParent(ctx.docId, note.id, grand, placed),
    });
  }
  const pending = Object.keys(ctx.doc.suggestions?.[note.id] || {}).length;
  const locate = (e) => {
    if (editing || e.target.closest("button, a, textarea, .menu") || window.getSelection()?.toString()) return;
    ctx.showInWeave(note.id);
  };
  return html`<li
    id=${"my-" + note.id}
    class=${"my-note" + (depth ? " is-sub" : "") + (fresh ? " is-new" : "") + (editing ? " is-editing" : "") + (ctx.mergeFrom === note.id ? " is-merging" : "") + (pending ? " has-suggestions" : "")}
    style=${{ "--depth": depth }}
    onClick=${locate}
    title="Click to find it in the woven doc"
  >
    <div class="my-note-head">
      ${depth === 0 ? html`<${SectionChip} ctx=${ctx} sid=${placed} />` : html`<span class="sub-mark mono">↳ sub-point</span>`}
      ${dup && html`<span class="badge badge--dup mono" title="Others wrote this too">×${item.authors.length}</span>`}
      ${conflict && html`<span class="badge badge--conflict mono" title="Differs from a similar note"><${Icon} name="triangle-alert" size=${11} /></span>`}
      ${pending > 0 && html`<span class="badge badge--suggest mono" title="Someone suggested a change">${pending} suggestion${pending === 1 ? "" : "s"}</span>`}
      <time class="mono" title=${new Date(note.createdAt || Date.now()).toLocaleString()}>${clock(note.createdAt)}</time>
      ${!editing && html`<${NoteActions} ctx=${ctx} note=${note} compact onEdit=${() => setEditing(true)} extra=${extra} />`}
    </div>
    ${under && html`<div class="under-line mono">↳ under ${ctx.nameOf(under.author)}'s “${clip(under.text, 36)}”</div>`}
    ${editing
      ? html`<${EditBox}
          initial=${note.text}
          onCancel=${() => setEditing(false)}
          onSave=${(text) => {
            store.editNote(ctx.docId, note.id, text, extractTags(text));
            setEditing(false);
          }}
        />`
      : html`<p class="my-note-text" onDblClick=${() => setEditing(true)}><${NoteText} text=${note.text} /></p>`}
    <${Suggestions} ctx=${ctx} note=${note} />
  </li>`;
}

function TargetPicker({ ctx }) {
  const { woven, target, setTarget, latest, resolvedTarget, doc } = ctx;
  const label = target === "auto" ? (latest ? latest.title : "Unsorted") : resolvedTarget ? doc.sections[resolvedTarget]?.title : "Unsorted";
  return html`<${Menu}
    align="left"
    width=${270}
    class="target-menu"
    trigger=${(open, toggle) => html`<button class=${"target-btn" + (open ? " is-open" : "")} onClick=${toggle} title="Topic your notes go to">
      <span class="target-ring" />
      <span class="target-label">${label}</span>
      ${target === "auto" && latest && html`<span class="target-auto mono">latest</span>`}
      <${Icon} name="chevron-down" size=${13} />
    </button>`}
    items=${() => [
      { heading: "New notes go to" },
      { label: "Latest topic", hint: latest ? latest.title : "none yet", icon: "zap", checked: target === "auto", onSelect: () => setTarget("auto") },
      { sep: true },
      ...woven.sections.map((s) => ({ label: sectionLabel(s), icon: "hash", checked: target === s.id, onSelect: () => setTarget(s.id) })),
      { label: "Unsorted", icon: "inbox", checked: target === "unsorted", onSelect: () => setTarget("unsorted") },
    ]}
  />`;
}

function Composer({ ctx }) {
  const { doc, docId, user, resolvedTarget, composerRef, woven } = ctx;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  // Outline position: chain[d] is the last note sent at depth d; depth > 0 nests under chain[depth - 1].
  const [chain, setChain] = useState([]);
  const [depth, setDepth] = useState(0);
  const parentId = depth > 0 ? chain[depth - 1] : null;
  const parentNote = parentId ? doc.notes?.[parentId] : null;

  const resetOutline = () => {
    setChain([]);
    setDepth(0);
  };
  useEffect(() => {
    if (depth > 0 && !parentNote) resetOutline();
  }, [depth, parentNote]);
  // Switching topics starts a fresh list.
  const lastTarget = useRef(resolvedTarget);
  useEffect(() => {
    if (lastTarget.current === resolvedTarget) return;
    lastTarget.current = resolvedTarget;
    if (chain.length && (woven.sectionOfNote.get(chain[0]) ?? null) !== resolvedTarget) resetOutline();
  }, [resolvedTarget]);

  const focusEnd = (value) =>
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      const pos = value ?? el.value.length;
      el.setSelectionRange(pos, pos);
    });

  // Lets the page and the tour drive the composer.
  useEffect(() => {
    ctx.composerApi.current = {
      nestUnder(noteId) {
        const path = [];
        const seen = new Set();
        for (let id = noteId; id && doc.notes?.[id] && !seen.has(id); id = doc.notes[id].parentId) {
          seen.add(id);
          path.unshift(id);
        }
        const p = path.slice(-MAX_DEPTH);
        setChain(p);
        setDepth(p.length);
        focusEnd();
      },
      startTopic(level = 0) {
        const next = "#".repeat(level + 1) + text.replace(/^#+\s*/, "");
        setText(next);
        focusEnd(next.length);
      },
      fill(value) {
        setText(value);
        focusEnd(value.length);
      },
    };
  });

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [text]);

  const headingHashes = HEADING_RE.exec(text)?.[1].length || 0;
  const isHeading = headingHashes > 0;
  const level = headingHashes - 1;
  const parsed = text.trim() ? parseInput(text) : null;
  const headingUnder = isHeading && level > 0 ? headingParent(doc.sections, level, resolvedTarget) : null;
  const headingUnderTitle = headingUnder && doc.sections[headingUnder]?.title;

  // #tag completion for the word under the caret (not for headings).
  const tagQuery = useMemo(() => {
    if (isHeading) return null;
    const before = text.slice(0, caret);
    const m = /(^|\s)#([\p{L}\p{N}_-]*)$/u.exec(before);
    if (!m || m[1] === "") return null;
    return { q: slug(m[2] || ""), start: before.length - m[2].length - 1 };
  }, [text, caret, isHeading]);
  const suggestions = useMemo(() => {
    if (!tagQuery) return [];
    const pool = new Map();
    for (const s of woven.sections) {
      const t = s.tag || slug(s.title);
      if (t) pool.set(t, s.title);
    }
    for (const n of Object.values(doc.notes || {})) for (const t of n.tags || []) if (!pool.has(t)) pool.set(t, null);
    return [...pool].filter(([t]) => t.startsWith(tagQuery.q) && t !== tagQuery.q).slice(0, 5);
  }, [tagQuery, doc.notes, woven.sections]);
  useEffect(() => setPick(0), [tagQuery?.q]);

  const complete = (tag) => {
    const next = text.slice(0, tagQuery.start) + "#" + tag + " " + text.slice(caret);
    setText(next);
    const pos = tagQuery.start + tag.length + 2;
    setCaret(pos);
    focusEnd(pos);
  };

  const createHeading = async (title, lvl, contextId, sections) => {
    const parent = headingParent(sections, lvl, contextId);
    const id = await store.addSection(docId, user, title, nextOrder(sections, parent), { parentId: parent, tabId: ctx.activeTab });
    return { id, parent };
  };

  const send = async () => {
    if (!parsed || sending) return;
    setSending(true);
    try {
      if (parsed.kind === "section") {
        const { parent } = await createHeading(parsed.title, parsed.level, resolvedTarget, doc.sections);
        ctx.setTarget("auto");
        resetOutline();
        toast(parent ? html`<b>${parsed.title}</b> added under ${doc.sections[parent]?.title}` : html`<b>${parsed.title}</b> added for everyone`, { icon: "hash" });
      } else {
        let sectionId = parentId ? woven.sectionOfNote.get(parentId) ?? null : resolvedTarget;
        // A note in an empty tab would land in Unsorted, outside the tab: start a topic named after the tab.
        const tab = ctx.tabs.find((t) => t.id === ctx.activeTab);
        if (!sectionId && !parentId && tab && ctx.target !== "unsorted") sectionId = await store.addSection(docId, user, tab.title, nextOrder(doc.sections), { tabId: tab.id });
        const id = await store.addNote(docId, user, { text: parsed.text, sectionId, tags: parsed.tags, parentId });
        setChain((c) => [...c.slice(0, depth), id]);
      }
      setText("");
      setPulse((p) => p + 1);
    } catch (e) {
      toast(e.message || "Couldn't send", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setSending(false);
      focusEnd(0);
    }
  };

  const insertAt = (s, end, piece) => {
    const next = text.slice(0, s) + piece + text.slice(end);
    setText(next);
    focusEnd(s + piece.length);
  };

  /** A picture pasted or dropped into the composer: shrink, store, insert ![](img:id). */
  const addPicture = async (file, s, end) => {
    setSending(true);
    try {
      const id = await addImage(docId, user, file);
      insertAt(s, end, `${s > 0 && !/\s$/.test(text.slice(0, s)) ? " " : ""}![](img:${id}) `);
    } catch (err) {
      toast(err.message || "Couldn't add that picture", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setSending(false);
    }
  };
  const onDrop = (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (!file) return;
    e.preventDefault();
    addPicture(file, text.length, text.length);
  };

  // Paste a whole outline: lines become bullets, indentation becomes sub-points, #/## lines become topics.
  const onPaste = async (e) => {
    const el = e.target;
    const [s, end] = [el.selectionStart, el.selectionEnd];
    const picture = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    const raw = e.clipboardData?.getData("text/plain") || "";
    const rich = e.clipboardData?.getData("text/html") || "";
    if (picture && !raw.trim()) {
      e.preventDefault();
      addPicture(picture, s, end);
      return;
    }
    if (raw.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
    e.preventDefault();
    // Copied out of Google Docs / Word / a web page: keep headings, lists, formatting.
    const fromRich = rich ? htmlToOutline(rich) : null;
    if (fromRich?.items.length) {
      const items = fromRich.title ? [{ kind: "section", text: fromRich.title, rank: -1 }, ...fromRich.items] : fromRich.items;
      const ok = await ask({
        title: `Add ${items.length} lines as separate notes?`,
        body: "Each paragraph or bullet becomes its own note, nested like the original. Headings become topics.",
        confirm: `Add ${items.length}`,
        cancel: "Paste as one note",
        icon: "list-tree",
      });
      if (!ok) return insertAt(s, end, raw);
      setSending(true);
      try {
        const imageIds = new Map();
        for (const [key, blob] of fromRich.images) imageIds.set(key, await addImage(docId, user, blob));
        const res = await store.importOutline(docId, user, items, { sections: doc.sections, tabs: doc.tabs, contextSection: resolvedTarget, tabId: ctx.activeTab, imageIds });
        if (res.sections) ctx.setTarget("auto");
        setPulse((p) => p + 1);
        toast(`Added ${items.length} lines`, { icon: "list-tree" });
      } catch (err) {
        toast(err.message || "Couldn't add everything", { icon: "triangle-alert", tone: "danger" });
      } finally {
        setSending(false);
        focusEnd(0);
      }
      return;
    }
    const items = parseOutline(raw);
    const ok = await ask({
      title: `Add ${items.length} lines as separate notes?`,
      body: "Each line becomes its own bullet. Indented lines become sub-points, and lines starting with # or ## become topics.",
      confirm: `Add ${items.length}`,
      cancel: "Paste as one note",
      icon: "list-tree",
    });
    if (!ok) return insertAt(s, end, raw);
    setSending(true);
    try {
      const sections = { ...doc.sections };
      let sectionCtx = resolvedTarget;
      let base = depth;
      let local = chain.slice(0, depth);
      const sectionOf = new Map(local.map((id) => [id, woven.sectionOfNote.get(id) ?? null]));
      let topics = 0;
      let last = depth;
      for (const it of items) {
        if (it.kind === "section") {
          const { id, parent } = await createHeading(it.text, it.level, sectionCtx, sections);
          sections[id] = { title: it.text, order: nextOrder(sections, parent), createdAt: Date.now(), parentId: parent };
          sectionCtx = id;
          local = [];
          base = 0;
          topics++;
          continue;
        }
        const d = Math.min(base + it.depth, local.length, MAX_DEPTH);
        const parent = d > 0 ? local[d - 1] : null;
        const sectionId = parent ? sectionOf.get(parent) ?? sectionCtx : sectionCtx;
        const id = await store.addNote(docId, user, { text: it.text, sectionId, tags: extractTags(it.text), parentId: parent });
        sectionOf.set(id, sectionId);
        local = [...local.slice(0, d), id];
        last = d;
      }
      if (topics) ctx.setTarget("auto");
      setChain(local);
      setDepth(Math.min(last, local.length));
      setPulse((p) => p + 1);
      toast(`Added ${items.length} lines`, { icon: "list-tree" });
    } catch (err) {
      toast(err.message || "Couldn't add everything", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setSending(false);
      focusEnd(0);
    }
  };

  const wrap = (mark) => {
    const el = composerRef.current;
    const [s, e] = [el.selectionStart, el.selectionEnd];
    const next = text.slice(0, s) + mark + text.slice(s, e) + mark + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + mark.length, e + mark.length);
    });
  };

  const onKeyDown = (e) => {
    if (suggestions.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && tagQuery.q))) {
      e.preventDefault();
      complete(suggestions[pick][0]);
      return;
    }
    if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setPick((p) => (p + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
      return;
    }
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const fmt = mod && FORMATS.find(([, , kbd]) => kbd.toLowerCase() === (e.shiftKey ? `ctrl shift ${e.key}` : `ctrl ${e.key}`).toLowerCase());
    if (fmt) {
      e.preventDefault();
      wrap(fmt[1]);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (isHeading) {
        if (e.shiftKey && headingHashes > 1) setText(text.slice(1));
        else if (!e.shiftKey && headingHashes < 3) setText("#" + text);
      } else if (e.shiftKey) setDepth((d) => Math.max(0, d - 1));
      else if (depth < chain.length && depth < MAX_DEPTH) setDepth(depth + 1);
      else if (!chain.length) toast("Send a note first, then Tab nests the next one under it", { icon: "corner-down-left" });
      return;
    }
    if (e.key === "Backspace" && !text && depth > 0) {
      e.preventDefault();
      setDepth(depth - 1);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      composerRef.current.blur();
    }
  };

  let context;
  if (isHeading)
    context = html`<span class="accent">${headingUnderTitle ? html`new subtopic in “${headingUnderTitle}”` : "new topic for everyone"}</span>`;
  else if (parentNote)
    context = html`<span class="ctx-sub"><span class="ctx-text">↳ sub-point of “${clip(parentNote.text)}”</span>
      <button class="ctx-x" onClick=${() => (resetOutline(), focusEnd())} title="Back to a main point (Shift+Tab)" aria-label="Stop nesting"><${Icon} name="x" size=${11} /></button></span>`;
  else context = "your stream";

  const topicLabel = isHeading ? (level === 0 ? "Topic" : level === 1 ? "Subtopic" : "Sub-subtopic") : "Topic";

  return html`<div class=${"composer-wrap" + (isHeading ? " is-section" : "")}>
    <div class="composer-meta mono">
      <span class="composer-ctx">${context}</span>
      <span class="composer-keys">${isHeading ? html`<b>Tab</b> deeper · <b>⇧Tab</b> up` : html`<b>↵</b> send · <b>Tab</b> indent`}</span>
    </div>
    ${suggestions.length > 0 &&
    html`<div class="tag-suggest" role="listbox">
      ${suggestions.map(
        ([t, title], i) => html`<button key=${t} role="option" aria-selected=${i === pick} class=${i === pick ? "is-on" : ""} onMouseDown=${(e) => (e.preventDefault(), complete(t))}>
          <span class="mono">#${t}</span>${title && html`<small>topic · ${title}</small>`}
        </button>`,
      )}
      <span class="tag-suggest-hint mono"><${Kbd}>Tab<//></span>
    </div>`}
    <div class=${`composer composer--d${isHeading ? 0 : depth}`} style=${{ "--depth": isHeading ? 0 : depth }}>
      ${!isHeading && html`<span class="composer-bullet" aria-hidden="true" />`}
      ${!isHeading && depth > 0 && html`<span class="composer-guides" aria-hidden="true">${Array.from({ length: depth }, (_, i) => html`<i key=${i} style=${{ "--g": i }} />`)}</span>`}
      <textarea
        ref=${composerRef}
        rows="1"
        value=${text}
        placeholder=${depth > 0 ? "Sub-point… (Shift+Tab to go back)" : woven.sections.length ? "Take a note… (#Topic for a new topic)" : "Start with #Topic, or just take a note…"}
        onInput=${(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onKeyUp=${(e) => setCaret(e.target.selectionStart)}
        onClick=${(e) => setCaret(e.target.selectionStart)}
        onKeyDown=${onKeyDown}
        onPaste=${onPaste}
        onDrop=${onDrop}
        aria-label="Write a note"
        data-tour="composer-input"
      />
      <div class="composer-bar">
        ${isHeading
          ? html`<span class="target-btn target-btn--static"><${Icon} name="hash" size=${13} /><span class="target-label">${parsed?.kind === "section" ? parsed.title : "Name it…"}</span></span>`
          : html`<${TargetPicker} ctx=${ctx} />`}
        <button
          class=${"chip-btn" + (isHeading ? " is-on" : "")}
          onMouseDown=${(e) => e.preventDefault()}
          onClick=${() => {
            if (isHeading) {
              const next = text.replace(/^#+\s*/, "");
              setText(next);
              focusEnd(next.length);
            } else ctx.composerApi.current.startTopic(0);
          }}
          title="New topic for everyone (or start with #). Tab inside a topic makes it a subtopic."
        >
          <${Icon} name="hash" size=${13} /> ${topicLabel}
        </button>
        <${Menu}
          align="left"
          width=${220}
          class="format-menu"
          trigger=${(open, toggle) => html`<button class=${"chip-btn" + (open ? " is-open" : "")} onMouseDown=${(e) => e.preventDefault()} onClick=${toggle} title="Formatting" aria-label="Formatting"><span class="aa">Aa</span></button>`}
          items=${FORMATS.map(([label, mark, kbd, icon]) => ({ label, icon, kbd, onSelect: () => wrap(mark) }))}
        />
        <span class="grow" />
        <button class=${"send-btn" + (parsed ? " is-ready" : "")} onClick=${send} disabled=${!parsed || sending} aria-label="Send" title="Send (Enter)">
          <${Icon} name=${isHeading ? "plus" : "arrow-up"} size=${16} stroke=${2.2} />
        </button>
      </div>
    </div>
    <div class="composer-glow" key=${pulse} aria-hidden="true" />
  </div>`;
}

function useOutline(ctx, uid) {
  const { doc } = ctx;
  return useMemo(() => {
    const all = new Map(Object.entries(doc.notes || {}));
    const mine = [...all].filter(([, n]) => n.author === uid).map(([id, n]) => ({ id, ...n }));
    return streamOutline(mine, all);
  }, [doc.notes, uid]);
}

const PANEL_PAGE = 200;

export function StreamPanel({ ctx, onClose }) {
  const { user, canEdit, mergeFrom } = ctx;
  const outline = useOutline(ctx, user.uid);
  const seen = useRef(null);
  if (seen.current === null) seen.current = new Set(outline.map((e) => e.note.id));
  useEffect(() => outline.forEach((e) => seen.current.add(e.note.id)));
  const listRef = useRef(null);
  const count = useRef(outline.length);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (outline.length > count.current && el) {
      const fresh = el.querySelector(".my-note.is-new");
      if (fresh) fresh.scrollIntoView({ block: "nearest", behavior: "smooth" });
      else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    count.current = outline.length;
  }, [outline.length]);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, []);
  // Long streams (a big import) show their newest notes first; earlier ones load on request.
  const [limit, setLimit] = useState(PANEL_PAGE);
  const hidden = Math.max(0, outline.length - limit);

  // Closest earlier entry at the same depth, without crossing into a shallower branch.
  const prevSibling = (i) => {
    const d = outline[i].depth;
    for (let j = i - 1; j >= 0; j--) {
      if (outline[j].depth < d) return null;
      if (outline[j].depth === d) return outline[j].note;
    }
    return null;
  };

  return html`<aside class="panel" aria-label="Your stream" data-tour="panel">
    <div class="panel-head">
      <${Avatar} ...${user} size=${26} online />
      <div class="panel-titles">
        <b>Your stream</b>
        <span class="mono">${canEdit ? "only you write here" : "view only"}</span>
      </div>
      <button class="icon-btn icon-btn--sm" onClick=${onClose} aria-label="Close panel"><${Icon} name="x" size=${15} /></button>
    </div>
    <ol class="my-notes" ref=${listRef}>
      ${hidden > 0 &&
      html`<li class="panel-more"><button class="btn btn--ghost btn--sm" onClick=${() => setLimit((n) => n + PANEL_PAGE * 4)}>Show ${Math.min(hidden, PANEL_PAGE * 4).toLocaleString()} earlier notes <span class="mono">${hidden.toLocaleString()} hidden</span></button></li>`}
      ${outline.slice(hidden).map(
        (e, k) => html`<${MyNote} key=${e.note.id} ctx=${ctx} entry=${e} prevSibling=${prevSibling(hidden + k)} fresh=${!seen.current.has(e.note.id)} />`,
      )}
      ${!outline.length &&
      html`<li class="panel-empty">
        ${canEdit
          ? html`<div class="panel-empty-art" aria-hidden="true"><i /><i /><i /></div>
              <p>Your notes stay in your own column.</p>
              <p class="mono"><b>↵</b> sends a bullet · <b>Tab</b> nests the next one · <b>#Topic</b> starts a topic</p>`
          : html`<p>You're a viewer. You can read the woven notes but not add to them.</p>`}
      </li>`}
    </ol>
    ${mergeFrom && html`<div class="panel-merge mono"><${Icon} name="git-merge" size=${14} /> pick a point on the page</div>`}
    ${canEdit ? html`<${Composer} ctx=${ctx} />` : html`<div class="panel-viewer mono"><${Icon} name="eye" size=${14} /> Viewers read the woven doc only</div>`}
  </aside>`;
}

function StreamColumn({ ctx, p, col }) {
  const { doc, user, online, query, showTimes, woven } = ctx;
  const outline = useOutline(ctx, p.uid);
  const q = query.trim().toLowerCase();
  const shown = q ? outline.filter((e) => e.note.text.toLowerCase().includes(q)) : outline;
  const pres = online.get(p.uid);
  const here = pres?.section && doc.sections?.[pres.section]?.title;
  let lastSection;
  return html`<section id=${"col-" + p.uid} class=${"stream-col" + (p.uid === user.uid ? " is-me" : "")} style=${{ "--who": colorFor(p.uid), "--i": col }}>
    <header class="stream-head">
      <${Avatar} ...${p} size=${30} online=${!!pres} />
      <div>
        <b>${p.uid === user.uid ? "You" : p.name}</b>
        <span class="mono">${pres ? (here ? `writing in ${here}` : "online") : p.role === "former" ? "left the doc" : `${outline.length} notes`}</span>
      </div>
    </header>
    <ol class="stream-notes">
      ${shown.map(({ note: n, depth }) => {
        const sid = woven.sectionOfNote.get(n.id) ?? null;
        const divider = depth === 0 && sid !== lastSection;
        if (depth === 0) lastSection = sid;
        return html`${divider && html`<li class="stream-divider mono" key=${"d" + n.id}><button onClick=${() => ctx.scrollToSection(sid)} title="Go to this topic">${sid ? doc.sections[sid]?.title : "Unsorted"}</button></li>`}
          <li
            id=${"sn-" + n.id}
            class=${"stream-note" + (depth ? " is-sub" : "")}
            key=${n.id}
            style=${{ "--depth": depth }}
            onClick=${(e) => !window.getSelection()?.toString() && !e.target.closest("a") && ctx.showInWeave(n.id)}
            title="Show in the woven doc"
          >
            ${showTimes && html`<time class="mono">${clock(n.createdAt)}</time>`}
            <p><${NoteText} text=${n.text} query=${query} /></p>
          </li>`;
      })}
      ${!shown.length && html`<li class="stream-empty mono">${q ? "no matches" : "nothing yet"}</li>`}
    </ol>
  </section>`;
}

export function StreamsView({ ctx }) {
  const { doc, people } = ctx;
  const authors = useMemo(() => new Set(Object.values(doc.notes || {}).map((n) => n.author)), [doc.notes]);
  const writers = people.filter((p) => store.canWrite(p.role) || authors.has(p.uid));
  return html`<div class="streams">${writers.map((p, col) => html`<${StreamColumn} key=${p.uid} ctx=${ctx} p=${p} col=${col} />`)}</div>`;
}

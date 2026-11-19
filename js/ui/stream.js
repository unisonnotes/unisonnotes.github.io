// Streams: your own column (side panel + composer) and everyone's columns side by side.
import { html, useState, useEffect, useRef, useMemo, useLayoutEffect } from "./h.js";
import { Icon } from "./icons.js";
import { Avatar, Menu, Kbd, toast, clock, timeAgo, colorFor } from "./kit.js";
import { NoteText } from "./text.js";
import { NoteActions } from "./woven.js";
import { parseInput, extractTags, nextOrder, slug } from "../weave.js";
import * as store from "../store.js";

function SectionChip({ ctx, sid }) {
  const s = sid && ctx.doc.sections?.[sid];
  return html`<span class=${"sec-chip mono" + (s ? "" : " sec-chip--none")}>${s ? s.title : "Unsorted"}</span>`;
}

/** Where a note actually landed in the woven doc (hashtag sections can pull it). */
function placedSection(ctx, noteId) {
  const item = ctx.woven.groupOfNote.get(noteId);
  if (!item) return null;
  for (const s of ctx.woven.sections) if (s.items.includes(item)) return s.id;
  return null;
}

function EditBox({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return html`<div class="edit-box">
    <textarea
      ref=${ref}
      value=${value}
      rows="1"
      onInput=${(e) => setValue(e.target.value)}
      onKeyDown=${(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          value.trim() && onSave(value.trim());
        } else if (e.key === "Escape") onCancel();
      }}
    />
    <div class="edit-actions mono"><span><${Kbd}>↵<//> save · <${Kbd}>Esc<//> cancel</span></div>
  </div>`;
}

function MyNote({ ctx, note, fresh }) {
  const [editing, setEditing] = useState(false);
  const placed = placedSection(ctx, note.id);
  const item = ctx.woven.groupOfNote.get(note.id);
  const dup = item && item.authors.length > 1;
  const conflict = item && item.conflicts.some((c) => c.note === note.id);
  return html`<li class=${"my-note" + (fresh ? " is-new" : "") + (editing ? " is-editing" : "") + (ctx.mergeFrom === note.id ? " is-merging" : "")}>
    <div class="my-note-head">
      <${SectionChip} ctx=${ctx} sid=${placed} />
      ${dup && html`<span class="badge badge--dup mono" title="Others wrote this too">×${item.authors.length}</span>`}
      ${conflict && html`<span class="badge badge--conflict mono" title="Differs from a similar note"><${Icon} name="triangle-alert" size=${11} /></span>`}
      <time class="mono" title=${new Date(note.createdAt || Date.now()).toLocaleString()}>${clock(note.createdAt)}</time>
      ${!editing && html`<${NoteActions} ctx=${ctx} note=${note} compact onEdit=${() => setEditing(true)} />`}
    </div>
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
  </li>`;
}

function TargetPicker({ ctx }) {
  const { woven, target, setTarget, latest, resolvedTarget, doc } = ctx;
  const label = target === "auto" ? (latest ? latest.title : "Unsorted") : resolvedTarget ? doc.sections[resolvedTarget]?.title : "Unsorted";
  return html`<${Menu}
    align="left"
    width=${260}
    class="target-menu"
    trigger=${(open, toggle) => html`<button class=${"target-btn" + (open ? " is-open" : "")} onClick=${toggle} title="Where new notes go">
      <span class="target-ring" />
      <span class="target-label">${label}</span>
      ${target === "auto" && html`<span class="target-auto mono">latest</span>`}
      <${Icon} name="chevron-down" size=${13} />
    </button>`}
    items=${() => [
      { heading: "New notes go to" },
      { label: "Latest section", hint: latest ? latest.title : "none yet", icon: "zap", checked: target === "auto", onSelect: () => setTarget("auto") },
      { sep: true },
      ...woven.sections.map((s) => ({ label: s.title, icon: "hash", checked: target === s.id, onSelect: () => setTarget(s.id) })),
      { label: "Unsorted", icon: "inbox", checked: target === "unsorted", onSelect: () => setTarget("unsorted") },
    ]}
  />`;
}

function Composer({ ctx, myCount }) {
  const { doc, docId, user, resolvedTarget, composerRef, woven } = ctx;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [text]);

  const parsed = text.trim() ? parseInput(text) : null;
  const isSection = parsed?.kind === "section";

  // #tag completion for the word under the caret.
  const tagQuery = useMemo(() => {
    const before = text.slice(0, caret);
    const m = /(^|\s)#([\p{L}\p{N}_-]*)$/u.exec(before);
    if (!m || (m[1] === "" && /^#\s/.test(text))) return null;
    return { q: slug(m[2] || ""), start: before.length - m[2].length - 1 };
  }, [text, caret]);
  const suggestions = useMemo(() => {
    if (!tagQuery) return [];
    const pool = new Map();
    for (const s of woven.sections) {
      const t = s.tag || slug(s.title);
      if (t) pool.set(t, s.title);
    }
    for (const n of Object.values(doc.notes || {})) for (const t of n.tags || []) if (!pool.has(t)) pool.set(t, null);
    return [...pool]
      .filter(([t]) => t.startsWith(tagQuery.q) && t !== tagQuery.q)
      .slice(0, 5);
  }, [tagQuery, doc.notes, woven.sections]);
  useEffect(() => setPick(0), [tagQuery?.q]);

  const complete = (tag) => {
    const el = composerRef.current;
    const next = text.slice(0, tagQuery.start) + "#" + tag + " " + text.slice(caret);
    setText(next);
    const pos = tagQuery.start + tag.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const send = async () => {
    if (!parsed || sending) return;
    setSending(true);
    try {
      if (parsed.kind === "section") {
        await store.addSection(docId, user, parsed.title, nextOrder(doc.sections));
        ctx.setTarget("auto");
        toast(html`<b>${parsed.title}</b> added to the spine for everyone`, { icon: "hash" });
      } else {
        await store.addNote(docId, user, { text: parsed.text, sectionId: resolvedTarget, tags: parsed.tags });
      }
      setText("");
      setPulse((p) => p + 1);
    } catch (e) {
      toast(e.message || "Couldn't send", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setSending(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
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
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      composerRef.current.blur();
    }
  };

  return html`<div class=${"composer-wrap" + (isSection ? " is-section" : "")}>
    <div class="composer-meta mono">
      <span>${isSection ? html`<span class="accent">new section for everyone</span>` : "your stream"}</span>
      <span>${myCount} note${myCount === 1 ? "" : "s"}</span>
    </div>
    ${suggestions.length > 0 &&
    html`<div class="tag-suggest" role="listbox">
      ${suggestions.map(
        ([t, title], i) => html`<button key=${t} role="option" aria-selected=${i === pick} class=${i === pick ? "is-on" : ""} onMouseDown=${(e) => (e.preventDefault(), complete(t))}>
          <span class="mono">#${t}</span>${title && html`<small>section · ${title}</small>`}
        </button>`,
      )}
      <span class="tag-suggest-hint mono"><${Kbd}>Tab<//></span>
    </div>`}
    <div class="composer">
      <textarea
        ref=${composerRef}
        rows="1"
        value=${text}
        placeholder=${woven.sections.length ? "Take a note…" : "Start with # Topic, or just take a note…"}
        onInput=${(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onKeyUp=${(e) => setCaret(e.target.selectionStart)}
        onClick=${(e) => setCaret(e.target.selectionStart)}
        onKeyDown=${onKeyDown}
        aria-label="Write a note"
      />
      <div class="composer-bar">
        ${isSection
          ? html`<span class="target-btn target-btn--static"><${Icon} name="hash" size=${13} /><span class="target-label">${parsed.title}</span></span>`
          : html`<${TargetPicker} ctx=${ctx} />`}
        <span class="composer-hint mono" title="Start with “# ” to add a section · use #tags to group"><b>#</b> section</span>
        <button class=${"send-btn" + (parsed ? " is-ready" : "")} onClick=${send} disabled=${!parsed || sending} aria-label="Send" title="Send (Enter)">
          <${Icon} name=${isSection ? "plus" : "arrow-up"} size=${16} stroke=${2.2} />
        </button>
      </div>
    </div>
    <div class="composer-glow" key=${pulse} aria-hidden="true" />
  </div>`;
}

export function StreamPanel({ ctx, onClose }) {
  const { doc, user, canEdit, mergeFrom } = ctx;
  const mine = useMemo(
    () =>
      Object.entries(doc.notes || {})
        .filter(([, n]) => n.author === user.uid)
        .map(([id, n]) => ({ id, ...n }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [doc.notes],
  );
  const seen = useRef(null);
  if (seen.current === null) seen.current = new Set(mine.map((n) => n.id));
  useEffect(() => mine.forEach((n) => seen.current.add(n.id)));
  const listRef = useRef(null);
  const count = useRef(mine.length);
  useLayoutEffect(() => {
    if (mine.length > count.current && listRef.current) listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    count.current = mine.length;
  }, [mine.length]);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, []);

  return html`<aside class="panel" aria-label="Your stream">
    <div class="panel-head">
      <${Avatar} ...${user} size=${26} online />
      <div class="panel-titles">
        <b>Your stream</b>
        <span class="mono">${canEdit ? "only you write here" : "view only"}</span>
      </div>
      <button class="icon-btn icon-btn--sm" onClick=${onClose} aria-label="Close panel"><${Icon} name="x" size=${15} /></button>
    </div>
    <ol class="my-notes" ref=${listRef}>
      ${mine.map((n) => html`<${MyNote} key=${n.id} ctx=${ctx} note=${n} fresh=${!seen.current.has(n.id)} />`)}
      ${!mine.length &&
      html`<li class="panel-empty">
        ${canEdit
          ? html`<div class="panel-empty-art" aria-hidden="true"><i /><i /><i /></div>
              <p>Your notes stay in your own column.</p>
              <p class="mono">Press <b>↵</b> to send. Unison places each one on the spine.</p>`
          : html`<p>You're a viewer. You can read the woven notes but not add to them.</p>`}
      </li>`}
    </ol>
    ${mergeFrom && html`<div class="panel-merge mono"><${Icon} name="git-merge" size=${14} /> pick a point on the page</div>`}
    ${canEdit ? html`<${Composer} ctx=${ctx} myCount=${mine.length} />` : html`<div class="panel-viewer mono"><${Icon} name="eye" size=${14} /> Viewers read the woven doc only</div>`}
  </aside>`;
}

export function StreamsView({ ctx }) {
  const { doc, people, user, online, now, query, showTimes } = ctx;
  const byAuthor = useMemo(() => {
    const m = new Map();
    for (const [id, n] of Object.entries(doc.notes || {})) {
      if (!m.has(n.author)) m.set(n.author, []);
      m.get(n.author).push({ id, ...n });
    }
    for (const list of m.values()) list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return m;
  }, [doc.notes]);
  const writers = people.filter((p) => store.canWrite(p.role) || byAuthor.has(p.uid));
  const q = query.trim().toLowerCase();

  return html`<div class="streams">
    ${writers.map((p, col) => {
      const notes = (byAuthor.get(p.uid) || []).filter((n) => !q || n.text.toLowerCase().includes(q));
      const pres = online.get(p.uid);
      const here = pres?.section && doc.sections?.[pres.section]?.title;
      let lastSection;
      return html`<section class=${"stream-col" + (p.uid === user.uid ? " is-me" : "")} key=${p.uid} style=${{ "--who": colorFor(p.uid), "--i": col }}>
        <header class="stream-head">
          <${Avatar} ...${p} size=${30} online=${!!pres} />
          <div>
            <b>${p.uid === user.uid ? "You" : p.name}</b>
            <span class="mono">${pres ? (here ? `writing in ${here}` : "online") : p.role === "former" ? "left the doc" : `${(byAuthor.get(p.uid) || []).length} notes`}</span>
          </div>
        </header>
        <ol class="stream-notes">
          ${notes.map((n) => {
            const sid = placedSection(ctx, n.id);
            const divider = sid !== lastSection;
            lastSection = sid;
            return html`${divider && html`<li class="stream-divider mono" key=${"d" + n.id}>${sid ? doc.sections[sid]?.title : "Unsorted"}</li>`}
              <li class="stream-note" key=${n.id}>
                ${showTimes && html`<time class="mono">${clock(n.createdAt)}</time>`}
                <p><${NoteText} text=${n.text} query=${query} /></p>
              </li>`;
          })}
          ${!notes.length && html`<li class="stream-empty mono">${q ? "no matches" : "nothing yet"}</li>`}
        </ol>
      </section>`;
    })}
  </div>`;
}

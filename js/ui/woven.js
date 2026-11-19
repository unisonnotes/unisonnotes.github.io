// The woven doc: every stream collapsed onto the spine as one clean page.
import { html, useState, useEffect, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Avatar, Menu, toast, ask, clock, timeAgo, colorFor } from "./kit.js";
import { NoteText } from "./text.js";
import * as store from "../store.js";
import { MAX_DEPTH } from "../weave.js";

/** Remember which notes were already on screen so only fresh ones animate in. */
function useSeen(ids) {
  const seen = useRef(null);
  const first = seen.current === null;
  if (first) seen.current = new Set(ids);
  const fresh = first ? new Set() : new Set(ids.filter((id) => !seen.current.has(id)));
  useEffect(() => {
    for (const id of ids) seen.current.add(id);
  });
  return fresh;
}

/** Indented section label for menus. */
export const sectionLabel = (s) => html`<span style=${{ paddingLeft: (s.depth || 0) * 14 + "px" }}>${s.title}</span>`;

export function NoteActions({ ctx, note, compact = false, onEdit, extra = [] }) {
  const { docId, woven, doc } = ctx;
  const merged = doc.merges?.[note.id];
  const move = (sid) =>
    store.moveNote(docId, note.id, sid).then(() => toast(sid ? html`Moved to <b>${doc.sections[sid]?.title}</b>` : "Moved to Unsorted", { icon: "corner-down-left" }));
  const placed = woven.sectionOfNote.get(note.id) ?? null;
  return html`<${Menu}
    align="right"
    width=${248}
    trigger=${(open, toggle) => html`<button class=${"icon-btn icon-btn--sm note-kebab" + (open ? " is-open" : "")} onClick=${(e) => (e.stopPropagation(), toggle())} aria-label="Note actions">
      <${Icon} name=${compact ? "more-horizontal" : "more-vertical"} size=${15} />
    </button>`}
    items=${() => [
      ...(onEdit ? [{ label: "Edit", icon: "pencil", onSelect: onEdit }] : []),
      ...extra,
      { label: merged ? "Unmerge" : "Merge into another point…", icon: merged ? "split" : "git-merge", onSelect: () => (merged ? store.unmergeNote(docId, note.id) : ctx.setMergeFrom(note.id)) },
      { sep: true },
      { heading: "Move to" },
      ...woven.sections.map((s) => ({ label: sectionLabel(s), icon: "hash", checked: !note.parentId && placed === s.id, onSelect: () => move(s.id) })),
      { label: "Unsorted", icon: "inbox", checked: !note.parentId && placed === null, onSelect: () => move(null) },
      { sep: true },
      {
        label: "Delete note",
        icon: "trash-2",
        danger: true,
        onSelect: async () => {
          if (await ask({ title: "Delete this note?", body: `“${note.text.slice(0, 140)}”`, confirm: "Delete", danger: true, icon: "trash-2" })) store.deleteNote(docId, note.id);
        },
      },
    ]}
  />`;
}

function Point({ ctx, item, fresh, index }) {
  const { user, nameOf, showTimes, showConflicts, mergeFrom, doc, docId, query, now, canEdit } = ctx;
  const [open, setOpen] = useState(false);
  const many = item.authors.length > 1;
  const conflict = showConflicts && item.conflicts.length > 0;
  const pickable = mergeFrom && !item.notes.some((n) => n.id === mergeFrom);
  const isFresh = item.notes.some((n) => fresh.has(n.id));
  const kids = filterItems(item.children, query);

  const onClick = () => {
    if (mergeFrom) {
      if (!pickable) return;
      store.mergeNotes(docId, mergeFrom, item.rep.id).then(() => toast("Merged. Your note now counts toward this point.", { icon: "git-merge" }));
      ctx.setMergeFrom(null);
      return;
    }
    setOpen((v) => !v);
  };

  return html`<li
    id=${"pt-" + item.id}
    class=${`pt pt--d${Math.min(item.depth, 3)}` + (isFresh ? " is-new" : "") + (conflict ? " is-conflict" : "") + (open ? " is-open" : "") + (pickable ? " is-pickable" : "") + (item.authors.includes(user.uid) ? " is-mine" : "")}
    style=${{ "--i": index }}
  >
    <div class="pt-row" onClick=${onClick}>
      <span class="pt-bullet" style=${{ "--who": colorFor(item.authors[0]) }} aria-hidden="true" />
      <div class="pt-text">
        <${NoteText} text=${item.rep.text} clash=${showConflicts ? item.clashNums : null} query=${query} />
        ${many && html`<span class="badge badge--dup mono" title=${`${item.authors.length} people wrote this`}>×${item.authors.length}</span>`}
        ${item.solo && html`<span class="badge badge--solo mono" title="Only one person wrote this point">solo</span>`}
        ${conflict && html`<span class="badge badge--conflict mono" title="A similar note has different numbers or dates"><${Icon} name="triangle-alert" size=${11} /> check</span>`}
      </div>
      ${canEdit &&
      !mergeFrom &&
      item.depth < MAX_DEPTH &&
      html`<button class="pt-add" title="Add a sub-point under this" aria-label="Add a sub-point" onClick=${(e) => (e.stopPropagation(), ctx.nestUnder(item.rep.id))}>
        <${Icon} name="plus" size=${13} />
      </button>`}
      <span class="pt-credit" title=${item.authors.map(nameOf).join(", ")}>
        ${item.authors.slice(0, 3).map((uid) => html`<span key=${uid} class="pt-dot" style=${{ "--who": colorFor(uid) }}>${nameOf(uid)[0]}</span>`)}
        ${item.authors.length > 3 && html`<span class="pt-dot pt-dot--more">+${item.authors.length - 3}</span>`}
      </span>
      ${showTimes && html`<time class="pt-time mono">${clock(item.createdAt)}</time>`}
    </div>
    ${open &&
    html`<div class="pt-detail">
      ${item.notes.map(
        (n) => html`<div class="pt-note" key=${n.id}>
          <${Avatar} uid=${n.author} name=${nameOf(n.author)} size=${22} />
          <div class="pt-note-body">
            <div class="pt-note-head">
              <b>${n.author === user.uid ? "You" : nameOf(n.author)}</b>
              <span class="mono">${clock(n.createdAt)} · ${timeAgo(n.createdAt, now)}</span>
              ${doc.merges?.[n.id] && html`<span class="badge badge--manual mono">hand-merged</span>`}
              ${n.editedAt && html`<span class="mono muted">edited</span>`}
            </div>
            <p><${NoteText} text=${n.text} clash=${showConflicts ? item.clashNums : null} /></p>
          </div>
          ${n.author === user.uid && canEdit && html`<${NoteActions} ctx=${ctx} note=${n} compact />`}
        </div>`,
      )}
      ${item.conflicts.map((c) => {
        const other = doc.notes?.[c.other];
        if (!other) return null;
        return html`<button class="pt-conflict" key=${c.other} onClick=${() => {
          const el = document.getElementById("pt-" + c.otherGroup);
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          el?.classList.remove("is-flash");
          void el?.offsetWidth;
          el?.classList.add("is-flash");
        }}>
          <${Icon} name="triangle-alert" size=${14} />
          <span>Differs from <b>${nameOf(other.author)}</b>: “${other.text}”</span>
          <${Icon} name="arrow-right" size=${14} />
        </button>`;
      })}
    </div>`}
    ${kids.length > 0 &&
    html`<ul class="pts pts--sub">${kids.map((k, i) => html`<${Point} key=${k.id} ctx=${ctx} item=${k} index=${i} fresh=${fresh} />`)}</ul>`}
  </li>`;
}

function GapCallout({ ctx, s }) {
  const { user, canEdit, docId, isOwner } = ctx;
  const mine = s.claim?.uid === user.uid;
  return html`<div class="gap-callout">
    <span class="gap-ico"><${Icon} name="flame" size=${14} /></span>
    <span>${s.items.length ? `Thin coverage: ${s.items.length} point${s.items.length === 1 ? "" : "s"} so far.` : "Nobody has written here yet."}</span>
    ${s.claim
      ? html`<span class="claim-chip"><${Avatar} uid=${s.claim.uid} name=${s.claim.name} size=${18} />${mine ? "You claimed this" : `${s.claim.name} is on it`}
          ${(mine || isOwner) && html`<button class="link-btn" onClick=${() => store.claimSection(docId, s.id, null)}>${mine ? "Unclaim" : "Clear"}</button>`}</span>`
      : canEdit &&
        html`<button class="btn btn--heat btn--sm" onClick=${() => {
          store.claimSection(docId, s.id, user);
          ctx.focusComposer(s.id);
        }}><${Icon} name="hand" size=${14} /> Claim it</button>`}
  </div>`;
}

const HEADINGS = ["h2", "h3", "h4"];

function SectionBlock({ ctx, s, fresh }) {
  const { showHeat, showTimes, writersIn, canEdit, resolvedTarget, query, woven } = ctx;
  const writers = writersIn(s.id);
  const items = filterItems(s.items, query);
  const hasSubtopics = woven.sections.some((x) => x.parentId === s.id);
  if (query && !items.length) return null;
  const hot = showHeat && s.heat >= 0.5;
  const isTarget = canEdit && resolvedTarget === s.id;
  const H = HEADINGS[Math.min(s.depth, 2)];
  return html`<section id=${"sec-" + s.id} class=${`w-sec w-sec--d${Math.min(s.depth, 2)}` + (hot ? " is-hot" : "")} style=${{ "--heat-amt": showHeat ? s.heat : 0 }} data-sid=${s.id}>
    <header class="w-sec-head">
      <span class="w-sec-num mono">${s.number}</span>
      <${H}>${s.title}<//>
      ${isTarget && html`<span class="target-chip mono"><span class="dot-live" /> writing here</span>`}
      <span class="w-sec-meta mono">
        ${writers.length > 0 &&
        html`<span class="writers" title=${writers.map((w) => w.name).join(", ")}>
          ${writers.slice(0, 3).map((w) => html`<${Avatar} key=${w.uid} ...${w} size=${18} online />`)}
          <span class="typing"><i /><i /><i /></span>
        </span>`}
        ${showTimes && s.firstAt && html`<span>${clock(s.firstAt)}${s.lastAt - s.firstAt > 60_000 ? ` – ${clock(s.lastAt)}` : ""}</span>`}
      </span>
      ${!hot && s.claim && html`<span class="claim-mini mono" title=${`Claimed by ${s.claim.name}`}><${Icon} name="hand" size=${12} /> ${s.claim.name.split(" ")[0]}</span>`}
    </header>
    ${hot && html`<${GapCallout} ctx=${ctx} s=${s} />`}
    ${items.length
      ? html`<ul class="pts">${items.map((it, i) => html`<${Point} key=${it.id} ctx=${ctx} item=${it} index=${i} fresh=${fresh} />`)}</ul>`
      : !hot && !hasSubtopics && html`<p class="w-empty">${canEdit ? html`No notes yet. <button class="link-btn" onClick=${() => ctx.focusComposer(s.id)}>Write here</button>` : "No notes yet."}</p>`}
  </section>`;
}

/** Keep points whose text, or any sub-point's text, matches the filter. */
function filterItems(items, query) {
  const q = query?.trim().toLowerCase();
  if (!q) return items;
  const hit = (it) => it.notes.some((n) => n.text.toLowerCase().includes(q)) || it.children.some(hit);
  return items.filter(hit);
}

export function WovenPage({ ctx }) {
  const { doc, woven, people, nameOf, now, user, canEdit, query, setActiveSection } = ctx;
  const allIds = Object.keys(doc.notes || {});
  const fresh = useSeen(allIds);
  const pageRef = useRef(null);

  // Track which section is in view for the spine highlight.
  useEffect(() => {
    const root = pageRef.current?.closest(".canvas");
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActiveSection(vis[0].target.dataset.sid || null);
      },
      { root, rootMargin: "-10% 0px -70% 0px" },
    );
    pageRef.current.querySelectorAll(".w-sec").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [woven.sections.length]);

  const counts = new Map();
  for (const n of Object.values(doc.notes || {})) counts.set(n.author, (counts.get(n.author) || 0) + 1);
  const contributors = people.filter((p) => counts.has(p.uid)).sort((a, b) => counts.get(b.uid) - counts.get(a.uid));
  const lastAt = Math.max(0, ...Object.values(doc.notes || {}).map((n) => n.createdAt || 0));
  const empty = !woven.sections.length && !woven.unsorted.length;
  const targetSection = woven.sections.find((s) => s.id === ctx.resolvedTarget);

  return html`<article class="page" ref=${pageRef}>
    <div class="page-kicker mono">
      <span>Woven notes</span>
      <span>·</span>
      <span>${contributors.length} writer${contributors.length === 1 ? "" : "s"}</span>
      ${lastAt > 0 && html`<span>·</span><span>updated ${timeAgo(lastAt, now)}</span>`}
    </div>
    <h1 class="page-title">${doc.meta.title}</h1>
    ${contributors.length > 0 &&
    html`<div class="credits">
      ${contributors.map(
        (p) => html`<span class="credit" key=${p.uid} style=${{ "--who": colorFor(p.uid) }}>
          <${Avatar} ...${p} size=${20} />
          <span>${p.uid === user.uid ? "You" : p.name}</span>
          <span class="mono">${counts.get(p.uid)}</span>
        </span>`,
      )}
    </div>`}

    ${empty &&
    html`<div class="page-empty">
      <div class="weave-art" aria-hidden="true">
        <svg viewBox="0 0 120 80"><path pathLength="1" d="M20 6c0 30 40 26 40 60" style="--who:var(--a1)"/><path pathLength="1" d="M60 6v60" style="--who:var(--a2)"/><path pathLength="1" d="M100 6c0 30-40 26-40 60" style="--who:var(--a3)"/></svg>
      </div>
      <h3>The page is empty, for now</h3>
      <p>${canEdit
        ? html`Start a topic with <code>#Topic</code> in your composer, then write notes. Press <kbd class="kbd">Tab</kbd> to nest a bullet under the one before it. Everyone's notes weave in here as they press Enter.`
        : "Notes appear here as editors write them."}</p>
      ${canEdit && html`<button class="btn btn--primary" onClick=${() => ctx.focusComposer()}><${Icon} name="notebook-pen" /> Start writing <kbd class="kbd">/</kbd></button>`}
    </div>`}

    ${woven.sections.map((s) => html`<${SectionBlock} key=${s.id} ctx=${ctx} s=${s} fresh=${fresh} />`)}

    ${canEdit && woven.sections.length > 0 && html`<div class="add-topic-row">
      <button class="add-topic" onClick=${() => ctx.startTopic(0)}><${Icon} name="plus" size=${14} /> New topic</button>
      ${targetSection && targetSection.depth < 2 && html`<button class="add-topic" onClick=${() => ctx.startTopic(targetSection.depth + 1)}><${Icon} name="corner-down-left" size=${14} /> Subtopic in “${targetSection.title}”</button>`}
    </div>`}

    ${woven.unsorted.length > 0 &&
    html`<section id="sec-unsorted" class="w-sec w-sec--unsorted" data-sid="">
      <header class="w-sec-head">
        <span class="w-sec-num mono"><${Icon} name="inbox" size=${14} /></span>
        <h2>Unsorted</h2>
        <span class="w-sec-meta mono">${woven.unsorted.length} waiting</span>
      </header>
      <p class="w-hint">Notes that don't belong to a topic yet. Use <b>Move to</b> on your own notes, or start a topic with <code>#Topic</code>.</p>
      <ul class="pts">
        ${filterItems(woven.unsorted, query).map(
          (it, i) => html`<${Point} key=${it.id} ctx=${ctx} item=${it} index=${i} fresh=${fresh} />`,
        )}
      </ul>
    </section>`}

    ${!empty && html`<footer class="page-foot mono">
      <span>Woven by Unison Notes</span>
      <span>${woven.stats.notes} notes → ${woven.stats.points} points</span>
    </footer>`}
  </article>`;
}

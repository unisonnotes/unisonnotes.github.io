// Document tabs down the side of the spine, like Google Docs. Everything is direct:
// drag a tab to reorder it, or onto another tab to nest it; drop a topic on a tab to
// move it there. Ctrl/⌘-click or Shift-click selects several tabs to merge or delete.
// Hover between two tabs to add one right there. Double-click (or F2) renames;
// Tab / Shift+Tab nest and un-nest the focused tab; Alt+↑/↓ move it.
import { html, useState, useEffect, useMemo, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Menu, ask, toast } from "./kit.js";
import * as store from "../store.js";

const MAX_DEPTH = 2; // three levels, like Google Docs
export const TOPIC_MIME = "application/x-unison-topic";
/** `order` that puts a topic after every topic already in tab `tabId`. */
export const endOrder = (woven, tabId) => woven.sections.reduce((m, s) => (s.tab === tabId && !s.parentId ? Math.max(m, (s.order ?? 0) + 1) : m), 0);

function useCollapsed(docId) {
  const key = `unison.tabs.collapsed.${docId}`;
  const [set, setSet] = useState(() => new Set(JSON.parse(localStorage.getItem(key) || "[]")));
  const update = (fn) =>
    setSet((prev) => {
      const next = new Set(prev);
      fn(next);
      localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  return [set, update];
}

/** Inline name field for renaming or adding a tab. */
function NameField({ value = "", placeholder, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (v) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return html`<input
    ref=${ref}
    class="tab-input"
    value=${value}
    placeholder=${placeholder}
    maxlength="200"
    onKeyDown=${(e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(e.target.value.trim() || null);
      else if (e.key === "Escape") finish(null);
    }}
    onBlur=${(e) => finish(e.target.value.trim() || null)}
  />`;
}

export function TabTree({ ctx, onAddTab, topics }) {
  const { docId, user, isOwner, canEdit, tabs, activeTab, fullWoven } = ctx;
  const [collapsed, setCollapsed] = useCollapsed(docId);
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);
  const [drag, setDrag] = useState(null); // {kind: "tabs", ids} | {kind: "topic", id}
  const [drop, setDrop] = useState(null); // {id, pos: "before" | "after" | "inside"}
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState(null); // {parentId, beforeId}

  const byId = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const kids = useMemo(() => {
    const m = new Map();
    for (const t of tabs) {
      const p = t.parentId || null;
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(t);
    }
    return m;
  }, [tabs]);
  const childrenOf = (id) => kids.get(id || null) || [];
  const ancestors = (id) => {
    const out = [];
    for (let t = byId.get(id); t?.parentId; t = byId.get(t.parentId)) out.push(t.parentId);
    return out;
  };
  const height = (id) => Math.max(0, ...childrenOf(id).map((c) => 1 + height(c.id)));
  const notesIn = useMemo(() => {
    const m = new Map();
    for (const s of fullWoven.sections) m.set(s.tab, (m.get(s.tab) || 0) + s.noteCount);
    return m;
  }, [fullWoven]);
  const mine = (t) => isOwner || t.createdBy === user.uid;

  // The open tab is never hidden inside a collapsed parent.
  useEffect(() => {
    const up = ancestors(activeTab);
    if (up.some((id) => collapsed.has(id))) setCollapsed((s) => up.forEach((id) => s.delete(id)));
  }, [activeTab]);
  useEffect(() => {
    // Forget selections of tabs that are gone.
    if ([...selected].some((id) => !byId.has(id))) setSelected(new Set([...selected].filter((id) => byId.has(id))));
  }, [byId]);

  const visible = [];
  const walk = (parentId) => {
    for (const t of childrenOf(parentId)) {
      visible.push(t);
      if (!collapsed.has(t.id)) walk(t.id);
    }
  };
  walk(null);
  const inOrder = (ids) => tabs.filter((t) => ids.has(t.id));

  /** Move tabs (with their children) under `parentId` at `index` among the rest. */
  const moveTo = async (ids, parentId, index) => {
    const moving = new Set(ids);
    // A tab whose parent moves too just comes along.
    const roots = inOrder(moving).filter((t) => !ancestors(t.id).some((a) => moving.has(a)));
    if (parentId && [parentId, ...ancestors(parentId)].some((a) => moving.has(a))) return;
    const depth = parentId ? byId.get(parentId).depth + 1 : 0;
    if (depth + Math.max(...roots.map((t) => height(t.id))) > MAX_DEPTH) {
      toast("Tabs nest up to three levels", { icon: "triangle-alert" });
      return;
    }
    const rootIds = new Set(roots.map((t) => t.id));
    const siblings = childrenOf(parentId)
      .filter((t) => !rootIds.has(t.id))
      .map((t) => t.id);
    siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, ...roots.map((t) => t.id));
    const moves = siblings.map((id, order) => ({ id, parentId, order })).filter((m) => {
      const t = byId.get(m.id);
      return (t.parentId || null) !== m.parentId || t.order !== m.order;
    });
    if (!moves.length) return;
    try {
      await store.arrangeTabs(docId, moves);
    } catch (e) {
      toast(e.message || "Couldn't move that", { icon: "triangle-alert", tone: "danger" });
    }
  };
  const indexAmong = (t) => childrenOf(t.parentId).findIndex((x) => x.id === t.id);

  const indent = (t) => {
    const prev = childrenOf(t.parentId)[indexAmong(t) - 1];
    if (!prev) return;
    setCollapsed((s) => s.delete(prev.id));
    moveTo([t.id], prev.id, childrenOf(prev.id).length);
  };
  const outdent = (t) => {
    if (!t.parentId) return;
    const parent = byId.get(t.parentId);
    moveTo([t.id], parent.parentId || null, indexAmong(parent) + 1);
  };
  const shift = (t, dir) => moveTo([t.id], t.parentId || null, indexAmong(t) + dir);

  const familyOf = (ids) => {
    const fam = new Set(ids);
    for (const t of tabs) if (ancestors(t.id).some((a) => fam.has(a))) fam.add(t.id);
    return [...fam];
  };

  const remove = async (ids) => {
    const list = inOrder(new Set(ids));
    const fam = familyOf(list.map((t) => t.id));
    const sections = fullWoven.sections.filter((s) => fam.includes(s.tab));
    const notes = sections.reduce((n, s) => n + s.noteCount, 0);
    const extra = fam.length - list.length;
    const sure = await ask({
      title: list.length === 1 ? `Delete tab “${list[0].title}”?` : `Delete ${list.length} tabs?`,
      body: [
        sections.length ? `${sections.length} topic${sections.length === 1 ? " is" : "s are"} removed${notes ? ` and their ${notes} notes move to Unsorted` : ""}.` : "",
        extra ? `${extra} sub-tab${extra === 1 ? " goes" : "s go"} too.` : "",
        "Nobody's notes are deleted.",
      ]
        .filter(Boolean)
        .join(" "),
      confirm: list.length === 1 ? "Delete tab" : `Delete ${list.length} tabs`,
      danger: true,
      icon: "trash-2",
    });
    if (!sure) return;
    try {
      await store.deleteTab(docId, fam, sections.map((s) => s.id));
      setSelected(new Set());
      toast(list.length === 1 ? "Tab deleted" : `${list.length} tabs deleted`, { icon: "trash-2" });
    } catch (e) {
      toast(e.message || "Only the owner or the tab's creator can delete it", { icon: "triangle-alert", tone: "danger" });
    }
  };

  /** Merge tabs into the first of them (in tab order): topics and sub-tabs move over. */
  const merge = async (ids, intoId = null) => {
    const list = inOrder(new Set(ids));
    const into = intoId ? byId.get(intoId) : list[0];
    const others = list.filter((t) => t.id !== into.id && !ancestors(into.id).includes(t.id));
    if (!others.length) return;
    const sure = await ask({
      title: `Merge ${others.length === 1 ? `“${others[0].title}”` : `${others.length} tabs`} into “${into.title}”?`,
      body: "Their topics move to the end of it, in order, along with any sub-tabs. The merged tabs are removed. Nobody's notes are deleted.",
      confirm: "Merge",
      icon: "git-merge",
    });
    if (!sure) return;
    const merged = new Set(others.map((t) => t.id));
    let order = endOrder(fullWoven, into.id);
    const sectionMoves = [];
    for (const o of others) for (const s of fullWoven.sections) if (s.tab === o.id && !s.parentId) sectionMoves.push({ id: s.id, order: order++ });
    let next = childrenOf(into.id).filter((c) => !merged.has(c.id)).length;
    const childMoves = [];
    for (const o of others) for (const c of childrenOf(o.id)) if (!merged.has(c.id)) childMoves.push({ id: c.id, parentId: into.id, order: next++ });
    try {
      await store.mergeTabs(docId, into.id, [...merged], sectionMoves, childMoves);
      setSelected(new Set());
      ctx.setActiveTab(into.id);
      toast(`Merged into ${into.title}`, { icon: "git-merge" });
    } catch (e) {
      toast(e.message || "Only the owner or a tab's creator can merge it away", { icon: "triangle-alert", tone: "danger" });
    }
  };

  const addAt = async (title, { parentId, beforeId }) => {
    setAdding(null);
    if (!title) return;
    const id = await store.addTab(docId, user, title, childrenOf(parentId).length, parentId);
    if (beforeId) {
      const ids = childrenOf(parentId).map((t) => t.id);
      ids.splice(ids.indexOf(beforeId), 0, id);
      await store.arrangeTabs(docId, ids.map((x, order) => ({ id: x, parentId, order })));
    }
    ctx.setActiveTab(id);
  };

  // ── Pointer: click, select, drag ──
  const onClick = (e, t) => {
    if (e.metaKey || e.ctrlKey) {
      const seed = anchor.current || activeTab;
      setSelected((s) => {
        const next = new Set(s.size ? s : [seed]);
        next.has(t.id) ? next.delete(t.id) : next.add(t.id);
        return next;
      });
      anchor.current = t.id;
      return;
    }
    if (e.shiftKey && (anchor.current || activeTab)) {
      const a = visible.findIndex((x) => x.id === (anchor.current || activeTab));
      const b = visible.findIndex((x) => x.id === t.id);
      setSelected(new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id)));
      return;
    }
    setSelected(new Set());
    anchor.current = t.id;
    if (t.id === activeTab) ctx.scrollToSection(ctx.woven.sections[0]?.id);
    else ctx.setActiveTab(t.id);
  };

  const onKeyDown = (e, t) => {
    if (!canEdit) return;
    if (e.key === "Tab") {
      e.preventDefault();
      e.shiftKey ? outdent(t) : indent(t);
    } else if (e.key === "F2" && mine(t)) {
      e.preventDefault();
      setRenaming(t.id);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      shift(t, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "Delete") {
      e.preventDefault();
      remove(selected.size > 1 ? [...selected] : [t.id]);
    } else if (e.key === "Escape") setSelected(new Set());
  };

  /**
   * Where a drop on row `t` lands: top quarter before it, bottom quarter after it,
   * middle inside it. Dropping after the last tab of a group with the pointer further
   * left lands after the group instead (one level per indent step), like an outline.
   */
  const dropAt = (e, t) => {
    if (drag?.kind === "topic") return { id: t.id, pos: "inside", out: t.id, shift: 0 };
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const pos = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    let out = t;
    const isLast = (x) => {
      const sib = childrenOf(x.parentId).filter((s) => !drag.ids.includes(s.id));
      return sib[sib.length - 1]?.id === x.id;
    };
    if (pos === "after" && !(childrenOf(t.id).length && !collapsed.has(t.id)))
      while (out.parentId && isLast(out) && e.clientX < r.left - (t.depth - out.depth) * 16 + 14) out = byId.get(out.parentId);
    return { id: t.id, pos, out: out.id, shift: t.depth - out.depth };
  };
  const canDropOn = (t) => {
    if (!drag) return false;
    if (drag.kind === "topic") return true;
    return !drag.ids.some((id) => id === t.id || ancestors(t.id).includes(id));
  };
  const onDrop = (e, t) => {
    e.preventDefault();
    const where = drop;
    setDrop(null);
    if (!drag || !canDropOn(t) || !where) return setDrag(null);
    if (drag.kind === "topic") {
      const s = fullWoven.sections.find((x) => x.id === drag.id);
      setDrag(null);
      if (!s || s.tab === t.id) return;
      store
        .moveSectionToTab(docId, s.id, t.id, endOrder(fullWoven, t.id))
        .then(() => toast(html`<b>${s.title}</b> moved to ${t.title}`, { icon: "panel-top" }))
        .catch((err) => toast(err.message || "Couldn't move that topic", { icon: "triangle-alert", tone: "danger" }));
      return;
    }
    const ids = drag.ids;
    setDrag(null);
    const target = byId.get(where.out) || t;
    const at = childrenOf(target.parentId)
      .filter((x) => !ids.includes(x.id))
      .findIndex((x) => x.id === target.id);
    if (where.pos === "inside") {
      setCollapsed((s) => s.delete(t.id));
      moveTo(ids, t.id, childrenOf(t.id).length);
    } else if (where.pos === "before") moveTo(ids, t.parentId || null, at);
    else if (target === t && childrenOf(t.id).length && !collapsed.has(t.id)) moveTo(ids, t.id, 0);
    else moveTo(ids, target.parentId || null, at + 1);
  };
  /** The “Add tab” row at the bottom also takes drops: to the end, top level. */
  const endDrop = {
    onDragOver: (e) => {
      if (drag?.kind !== "tabs") return;
      e.preventDefault();
      if (drop?.id !== "end") setDrop({ id: "end" });
    },
    onDrop: (e) => {
      e.preventDefault();
      const ids = drag?.ids;
      setDrag(null);
      setDrop(null);
      if (ids) moveTo(ids, null, childrenOf(null).length);
    },
  };

  const sel = selected.size > 1 ? inOrder(selected) : [];

  return html`<div
    class="tab-tree"
    onKeyDown=${(e) => e.key === "Escape" && setSelected(new Set())}
    onDragLeave=${(e) => {
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setDrop(null);
      if (drag?.kind === "topic") setDrag(null);
    }}
  >
    ${sel.length > 0 &&
    html`<div class="tab-selbar">
      <span class="mono">${sel.length} selected</span>
      <span class="grow" />
      <button class="btn btn--ghost btn--sm" disabled=${!canEdit} onClick=${() => merge(sel.map((t) => t.id))} title=${`Merge into “${sel[0].title}”`}><${Icon} name="git-merge" size=${14} /> Merge</button>
      <button class="btn btn--ghost btn--sm is-danger" disabled=${!canEdit} onClick=${() => remove(sel.map((t) => t.id))}><${Icon} name="trash-2" size=${14} /> Delete</button>
      <button class="icon-btn icon-btn--sm" onClick=${() => setSelected(new Set())} aria-label="Clear selection"><${Icon} name="x" size=${14} /></button>
    </div>`}
    <ol class="tab-list" role="tree">
      ${visible.map((t) => {
        const hasKids = childrenOf(t.id).length > 0;
        const open = !collapsed.has(t.id);
        const isDrop = drop?.id === t.id;
        return html`<li key=${t.id} class=${"tab-item" + (t.id === activeTab ? " is-active" : "")} style=${{ "--depth": t.depth }} role="treeitem" aria-expanded=${hasKids ? open : undefined}>
          ${canEdit &&
          html`<button class="tab-gap" onClick=${() => setAdding({ parentId: t.parentId || null, beforeId: t.id })} title="Add a tab here" aria-label=${`Add a tab before ${t.title}`}><i /><span><${Icon} name="plus" size=${11} /></span></button>`}
          ${adding?.beforeId === t.id &&
          html`<div class="tab-row tab-row--new"><span class="tab-caret" /><${Icon} name="file" size=${14} /><${NameField} placeholder="New tab name" onDone=${(v) => addAt(v, adding)} /></div>`}
          <div
            class=${"tab-row" + (selected.has(t.id) && sel.length ? " is-selected" : "") + (isDrop ? ` is-drop-${drop.pos}` : "") + (drag?.ids?.includes(t.id) ? " is-dragging" : "")}
            style=${isDrop && drop.shift ? { "--drop-shift": `${drop.shift * 16}px` } : undefined}
            draggable=${canEdit && renaming !== t.id}
            onDragStart=${(e) => {
              const ids = selected.has(t.id) && sel.length ? sel.map((x) => x.id) : [t.id];
              setDrag({ kind: "tabs", ids });
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", ids.map((id) => byId.get(id).title).join(", "));
            }}
            onDragEnd=${() => (setDrag(null), setDrop(null))}
            onDragOver=${(e) => {
              if (!drag && e.dataTransfer.types.includes(TOPIC_MIME)) setDrag({ kind: "topic", id: null });
              if (!canDropOn(t)) return;
              e.preventDefault();
              const at = dropAt(e, t);
              if (drop?.id !== at.id || drop.pos !== at.pos || drop.out !== at.out) setDrop(at);
            }}
            onDragLeave=${(e) => !e.currentTarget.contains(e.relatedTarget) && drop?.id === t.id && setDrop(null)}
            onDrop=${(e) => {
              if (drag?.kind === "topic" && !drag.id) drag.id = e.dataTransfer.getData(TOPIC_MIME);
              onDrop(e, t);
            }}
          >
            ${hasKids
              ? html`<button class="tab-caret" onClick=${() => setCollapsed((s) => (open ? s.add(t.id) : s.delete(t.id)))} aria-label=${open ? "Collapse" : "Expand"}><${Icon} name=${open ? "chevron-down" : "chevron-right"} size=${14} /></button>`
              : html`<span class="tab-caret" />`}
            ${renaming === t.id
              ? html`<span class="tab-btn"><${Icon} name="file-text" size=${14} /><${NameField}
                  value=${t.title}
                  onDone=${(v) => {
                    setRenaming(null);
                    if (v && v !== t.title) store.renameTab(docId, t.id, v);
                  }}
                /></span>`
              : html`<button
                  class="tab-btn"
                  onClick=${(e) => onClick(e, t)}
                  onDblClick=${() => canEdit && mine(t) && setRenaming(t.id)}
                  onKeyDown=${(e) => onKeyDown(e, t)}
                  title=${`${t.title}\nDouble-click to rename · drag to move or nest · Ctrl/⌘-click to select`}
                >
                  <${Icon} name=${t.id === activeTab ? "file-text" : "file"} size=${14} />
                  <span class="tab-name">${t.title}</span>
                  ${notesIn.get(t.id) > 0 && html`<span class="tab-count mono">${notesIn.get(t.id)}</span>`}
                </button>`}
            <${TabMenu}
              ctx=${ctx}
              tab=${t}
              mine=${mine(t)}
              canIndent=${indexAmong(t) > 0 && t.depth + height(t.id) < MAX_DEPTH}
              onRename=${() => setRenaming(t.id)}
              onAddSub=${() => {
                setCollapsed((s) => s.delete(t.id));
                onAddTab(t.id);
              }}
              onIndent=${() => indent(t)}
              onOutdent=${() => outdent(t)}
              onShift=${(dir) => shift(t, dir)}
              onMerge=${(intoId) => merge([t.id, intoId], intoId)}
              onDelete=${() => remove([t.id])}
              first=${indexAmong(t) === 0}
              last=${indexAmong(t) === childrenOf(t.parentId).length - 1}
            />
          </div>
          ${t.id === activeTab && topics}
        </li>`;
      })}
      ${canEdit &&
      (adding && !adding.beforeId
        ? html`<li class="tab-item"><div class="tab-row tab-row--new"><span class="tab-caret" /><${Icon} name="file" size=${14} /><${NameField} placeholder="New tab name" onDone=${(v) => addAt(v, adding)} /></div></li>`
        : html`<li class="tab-item"><button class=${"tab-add" + (drop?.id === "end" ? " is-drop" : "")} onClick=${() => setAdding({ parentId: null, beforeId: null })} onDragOver=${endDrop.onDragOver} onDragLeave=${() => drop?.id === "end" && setDrop(null)} onDrop=${endDrop.onDrop}><${Icon} name="plus" size=${14} /> ${drag?.kind === "tabs" ? "Drop here to move to the end" : "Add tab"}</button></li>`)}
    </ol>
  </div>`;
}

function TabMenu({ ctx, tab, mine, canIndent, first, last, onRename, onAddSub, onIndent, onOutdent, onShift, onMerge, onDelete }) {
  const { canEdit, tabs } = ctx;
  return html`<${Menu}
    align="right"
    width=${240}
    trigger=${(open, toggle) => html`<button class=${"icon-btn icon-btn--sm spine-kebab" + (open ? " is-open" : "")} onClick=${(e) => (e.stopPropagation(), toggle())} aria-label="Tab actions"><${Icon} name="more-horizontal" size=${15} /></button>`}
    items=${() => [
      { label: "Rename", icon: "pencil", kbd: "F2", disabled: !mine, onSelect: onRename },
      { label: "Add sub-tab", icon: "corner-down-left", disabled: !canEdit || tab.depth >= MAX_DEPTH, onSelect: onAddSub },
      { sep: true },
      { label: "Nest under the tab above", icon: "arrow-right", kbd: "Tab", disabled: !canEdit || !canIndent, onSelect: onIndent },
      { label: "Move out a level", icon: "arrow-left", kbd: "⇧ Tab", disabled: !canEdit || !tab.parentId, onSelect: onOutdent },
      { label: "Move up", icon: "arrow-up", kbd: "Alt ↑", disabled: !canEdit || first, onSelect: () => onShift(-1) },
      { label: "Move down", icon: "arrow-down", kbd: "Alt ↓", disabled: !canEdit || last, onSelect: () => onShift(1) },
      { sep: true },
      { heading: "Merge into" },
      ...tabs
        .filter((t) => t.id !== tab.id)
        .map((t) => ({ label: "\u2002".repeat(t.depth) + t.title, icon: "git-merge", disabled: !canEdit || !mine, onSelect: () => onMerge(t.id) })),
      { sep: true },
      { label: "Delete tab", icon: "trash-2", kbd: "Del", danger: true, disabled: !mine, onSelect: onDelete },
    ]}
  />`;
}

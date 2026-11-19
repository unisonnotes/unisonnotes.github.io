// Doc page. Structure follows Google Docs (title + menu bar, toolbar, outline on the
// left, the page in the middle, a side panel on the right); the right panel holds your
// own stream and composer.
import { html, useState, useEffect, useMemo, useRef, useCallback } from "./h.js";
import { Icon } from "./icons.js";
import { Logo, AvatarStack, Menu, Modal, toast, ask, download, useNow, timeAgo, Kbd, go } from "./kit.js";
import { ModeToggle, ThemePicker } from "./theme-picker.js";
import { AccountMenu } from "./home.js";
import { ShareModal } from "./share.js";
import { Spine } from "./spine.js";
import { WovenPage } from "./woven.js";
import { StreamPanel, StreamsView } from "./stream.js";
import { Tour, TOUR_KEY } from "./tour.js";
import { EditMode } from "./editor.js";
import { ImportModal, importInto } from "./import.js";
import { FONTS, SPACINGS, DEFAULT_STYLE, fontCss, styleVars } from "./format.js";
import { weave, tagsNeedingSections, tagTitle, nextOrder, latestSection, orderedTabs, toMarkdown, agendaToSections } from "../weave.js";
import { setImageDoc } from "../images.js";
import * as store from "../store.js";

const ONLINE_MS = 90_000;
const pref = (k, d) => {
  const v = localStorage.getItem("unison.doc." + k);
  return v === null ? d : v === "1";
};

export function DocPage({ user, docId, backend }) {
  const [doc, setDoc] = useState(undefined);
  // Our own docs-list entry for this doc. It appears when an invite is accepted, which is
  // when a denied read (Firebase rules) is worth retrying.
  const [listed, setListed] = useState(false);
  useEffect(() => store.watchMyDocEntry(user.uid, docId, (e) => setListed(!!e)), [docId]);
  useEffect(
    () =>
      store.watchDoc(
        docId,
        (d) => setDoc(d && d.meta ? d : null),
        () => setDoc(false),
      ),
    [docId, listed],
  );
  const member = doc?.members?.[user.uid];

  if (doc === undefined)
    return html`<div class="boot"><${Logo} size=${52} draw /><span class="mono">Opening doc</span></div>`;
  if (!doc || !member)
    return html`<div class="boot boot--error">
      <${Logo} size=${52} />
      <b>${doc === null ? "This doc doesn't exist" : "You don't have access to this doc"}</b>
      <span>${doc === null ? "It may have been deleted by its owner." : "Ask the owner to share it with " + user.email + "."}</span>
      <button class="btn btn--primary" onClick=${() => go("/")}><${Icon} name="arrow-left" /> Back to your docs</button>
    </div>`;
  return html`<${DocView} user=${user} docId=${docId} doc=${{ id: docId, ...doc }} role=${member.role} backend=${backend} />`;
}

function useToggle(key, initial) {
  const [v, setV] = useState(() => pref(key, initial));
  const set = useCallback(
    (next) =>
      setV((cur) => {
        const val = typeof next === "function" ? next(cur) : next;
        localStorage.setItem("unison.doc." + key, val ? "1" : "0");
        return val;
      }),
    [key],
  );
  return [v, set];
}

function HelpModal({ open, onClose, onTour }) {
  const rows = [
    ["Your stream", "Everyone types in their own column. No cursor collisions, and you only ever edit your own notes."],
    ["Bullets", "Enter sends a bullet. Tab nests the next one under it, Shift+Tab steps back out. Hover a point on the page and press + to add a sub-point under anyone's note. Pasting an indented list keeps its structure."],
    ["Topics", "Start a message with #, like “#Mitochondria”, to add a topic for everyone. ##Cristae makes a subtopic inside the topic you're writing in, ### goes one deeper. New notes go to the newest topic."],
    ["Hashtags", "A #tag in the middle of a note groups it. When two or more people use the same tag, it becomes a topic and those notes move into it."],
    ["Duplicates", "Notes that say the same thing collapse into one point with a ×N badge. Points only one person wrote get a “solo” marker."],
    ["Conflicts", "Similar notes with different numbers or dates are highlighted so someone can check."],
    ["Gaps", "Topics with few notes glow. Claim one to tell the group you're covering it."],
    ["Paraphrases", "Word matching can't catch every rewording. Use “Merge into…” on your note, then click the point it repeats."],
    ["Others' notes", "Click a point to see who wrote what. Jump to their stream, suggest an edit or a removal (they accept or decline), or add a sub-point. The owner can delete any note."],
    ["Edit mode", "Edit turns the woven notes into a final copy you can rewrite like a normal document, with fonts, sizes, colors, lists and alignment. One person types at a time; the streams stay untouched."],
    ["Import", "File → Import brings in Word, Google Docs, Markdown or text files. Headings become topics and lists become notes."],
  ];
  const keys = [
    [html`<${Kbd}>↵<//>`, "Send bullet"],
    [html`<${Kbd}>⇧<//> <${Kbd}>↵<//>`, "New line in a bullet"],
    [html`<${Kbd}>Tab<//>`, "Indent / complete #tag"],
    [html`<${Kbd}>⇧<//> <${Kbd}>Tab<//>`, "Outdent"],
    [html`<${Kbd}>#<//> <${Kbd}>##<//>`, "Topic / subtopic"],
    [html`<${Kbd}>Ctrl<//> <${Kbd}>B<//> <${Kbd}>I<//>`, "Bold / italic"],
    [html`<${Kbd}>/<//>`, "Jump to composer"],
    [html`<${Kbd}>Esc<//>`, "Cancel merge or edit"],
  ];
  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="How Unison works"
    subtitle="Write alone. Read together."
    icon="circle-help"
    width=${640}
    footer=${html`<button class="btn btn--primary" onClick=${onTour}><${Icon} name="sparkle" /> Take the tour</button>`}
  >
    <div class="help-grid">
      ${rows.map(([t, d], i) => html`<div class="help-row" key=${i}><span class="kicker">${t}</span><p>${d}</p></div>`)}
    </div>
    <div class="kicker" style="margin-top:18px">Keyboard</div>
    <div class="keys">${keys.map(([k, d], i) => html`<div key=${i}><span>${k}</span><span>${d}</span></div>`)}</div>
  <//>`;
}

function AgendaModal({ open, onClose, onAdd }) {
  const [text, setText] = useState("");
  useEffect(() => open && setText(""), [open]);
  const list = agendaToSections(text);
  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title="Add topics from an agenda"
    subtitle="Each line becomes a topic at the end of the spine."
    icon="clipboard-list"
    footer=${html`<button class="btn btn--ghost" onClick=${onClose}>Cancel</button>
      <button class="btn btn--primary" disabled=${!list.length} onClick=${() => onAdd(list)}>Add ${list.length || ""} topics</button>`}
  >
    <textarea class="field field--area mono" rows="7" autofocus placeholder=${"1. Recap\n2. New material\n3. Practice"} value=${text} onInput=${(e) => setText(e.target.value)} />
  <//>`;
}

function TitleField({ doc, editable }) {
  const [value, setValue] = useState(doc.meta.title);
  const [focus, setFocus] = useState(false);
  useEffect(() => !focus && setValue(doc.meta.title), [doc.meta.title]);
  const commit = () => {
    setFocus(false);
    const t = value.trim();
    if (t && t !== doc.meta.title) store.renameDoc(doc.id, t);
    else setValue(doc.meta.title);
  };
  if (!editable) return html`<h1 class="doc-title doc-title--static" title=${doc.meta.title}>${doc.meta.title}</h1>`;
  return html`<span class="doc-title-wrap" data-value=${value || " "}>
    <input
      class="doc-title"
      value=${value}
      aria-label="Doc title"
      onFocus=${() => setFocus(true)}
      onInput=${(e) => setValue(e.target.value)}
      onBlur=${commit}
      onKeyDown=${(e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") {
          setValue(doc.meta.title);
          setTimeout(() => e.target.blur());
        }
      }}
    />
  </span>`;
}

function DocView({ user, doc, role, backend }) {
  const docId = doc.id;
  const canEdit = store.canWrite(role);
  const isOwner = role === "owner";
  const now = useNow(15_000);

  const [view, setView] = useState(() => localStorage.getItem("unison.doc.view") || "woven");
  const [showSpine, setShowSpine] = useToggle("spine", window.innerWidth > 1000);
  const [showPanel, setShowPanel] = useToggle("panel", window.innerWidth > 760);
  const [showTimes, setShowTimes] = useToggle("times", true);
  const [showHeat, setShowHeat] = useToggle("heat", true);
  const [showConflicts, setShowConflicts] = useToggle("conflicts", true);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("auto"); // "auto" | sectionId | "unsorted"
  const [mergeFrom, setMergeFrom] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [modal, setModal] = useState(null); // share | theme | help | agenda
  const [tour, setTour] = useState(() => canEdit && !localStorage.getItem(TOUR_KEY));
  const composerRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => localStorage.setItem("unison.doc.view", view), [view]);
  useEffect(() => {
    if (mergeFrom && view !== "woven") setView("woven");
  }, [mergeFrom]);
  useEffect(() => {
    document.title = `${doc.meta.title} · Unison Notes`;
  }, [doc.meta.title]);

  // Bump "last opened" once per visit.
  useEffect(() => {
    store.touchDoc(user.uid, docId, role).catch(() => {});
  }, [docId]);

  const woven = useMemo(() => weave(doc), [doc.sections, doc.notes, doc.merges, doc.tabs]);

  // Tabs: separate pages of one doc, like Google Docs. Docs without tabs show one page.
  const tabs = useMemo(() => orderedTabs(doc.tabs), [doc.tabs]);
  const [tabPick, setTabPick] = useState(() => localStorage.getItem(`unison.doc.tab.${docId}`));
  const activeTab = tabs.find((t) => t.id === tabPick)?.id ?? tabs[0]?.id ?? null;
  const openTab = (id) => {
    setTabPick(id);
    localStorage.setItem(`unison.doc.tab.${docId}`, id);
    setTarget("auto");
    if (view === "streams") setView("woven");
    document.querySelector(".canvas")?.scrollTo({ top: 0 });
  };
  const tabOfSection = useMemo(() => new Map(woven.sections.map((s) => [s.id, s.tab])), [woven]);
  const tabWoven = useMemo(() => (tabs.length ? { ...woven, sections: woven.sections.filter((s) => s.tab === activeTab) } : woven), [woven, tabs, activeTab]);
  const latest = useMemo(() => latestSection(doc.sections, doc.tabs, tabs.length ? activeTab : undefined), [doc.sections, doc.tabs, activeTab]);
  const resolvedTarget = target === "auto" ? latest?.id || null : target === "unsorted" ? null : doc.sections?.[target] ? target : latest?.id || null;
  setImageDoc(docId); // before children render, so their pictures load from this doc

  // Presence: announce ourselves and which section we're writing into.
  const presenceRef = useRef(null);
  useEffect(() => {
    const p = store.joinPresence(docId, user);
    presenceRef.current = p;
    return () => p.leave();
  }, [docId]);
  useEffect(() => {
    presenceRef.current?.update(canEdit ? resolvedTarget : null);
  }, [resolvedTarget, canEdit]);

  // A hashtag used by 2+ people becomes a section. Deterministic ids keep racing
  // browsers from creating duplicates.
  useEffect(() => {
    if (!canEdit) return;
    let order = nextOrder(doc.sections);
    for (const tag of tagsNeedingSections(doc)) {
      store.addSection(docId, user, tagTitle(tag), order++, { id: `t_${tag}`, tag }).catch(() => {});
    }
  }, [doc.notes, doc.sections, canEdit]);

  // People: members plus anyone who wrote notes and has since left.
  const people = useMemo(() => {
    const map = new Map();
    for (const [uid, m] of Object.entries(doc.members || {})) map.set(uid, { uid, ...m });
    for (const n of Object.values(doc.notes || {})) {
      if (!map.has(n.author)) map.set(n.author, { uid: n.author, name: n.authorName || "Former member", role: "former" });
    }
    const rank = { owner: 0, editor: 1, viewer: 2, former: 3 };
    return [...map.values()].sort((a, b) => (a.uid === user.uid ? -1 : b.uid === user.uid ? 1 : rank[a.role] - rank[b.role] || a.name.localeCompare(b.name)));
  }, [doc.members, doc.notes]);
  const nameOf = useCallback((uid) => people.find((p) => p.uid === uid)?.name || "Someone", [people]);

  const online = useMemo(() => {
    const out = new Map();
    for (const [uid, p] of Object.entries(doc.presence || {})) {
      if (p && now - (p.at || 0) < ONLINE_MS + 30_000) out.set(uid, p);
    }
    out.set(user.uid, { ...(out.get(user.uid) || {}), name: user.name, section: canEdit ? resolvedTarget : null });
    return out;
  }, [doc.presence, now, resolvedTarget]);

  const writersIn = useCallback(
    (sid) =>
      [...online]
        .filter(([uid, p]) => uid !== user.uid && p.section === sid && store.canWrite(doc.members?.[uid]?.role))
        .map(([uid]) => people.find((x) => x.uid === uid))
        .filter(Boolean),
    [online, people],
  );

  // Keyboard: "/" focuses the composer, Esc cancels merge picking.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if (e.key === "/" && !typing && canEdit) {
        e.preventDefault();
        setShowPanel(true);
        setTimeout(() => composerRef.current?.focus(), 30);
      } else if (e.key === "Escape" && mergeFrom) {
        setMergeFrom(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && !e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mergeFrom, canEdit]);

  /** Switch view if needed, then scroll an element into view and flash it. */
  const reveal = (nextView, id, opts = { block: "center", inline: "center" }) => {
    const run = () => {
      const el = document.getElementById(id);
      if (!el) return false;
      el.scrollIntoView({ behavior: "smooth", ...opts });
      el.classList.remove("is-flash");
      void el.offsetWidth;
      el.classList.add("is-flash");
      return true;
    };
    if (nextView && view !== nextView) setView(nextView);
    let tries = 12;
    const attempt = () => !run() && --tries > 0 && setTimeout(attempt, 50);
    setTimeout(attempt, 30);
  };
  const scrollToSection = (sid) => {
    const tab = sid && tabOfSection.get(sid);
    if (tab && tab !== activeTab) openTab(tab);
    reveal("woven", sid ? `sec-${sid}` : "sec-unsorted", { block: "start" });
  };
  const showInWeave = (noteId) => {
    const item = woven.groupOfNote.get(noteId);
    const tab = tabOfSection.get(woven.sectionOfNote.get(noteId));
    if (tab && tab !== activeTab) openTab(tab);
    if (item) reveal("woven", `pt-${item.id}`);
  };
  const showInStream = (noteId) => reveal("streams", `sn-${noteId}`);
  const showStreamOf = (uid) => reveal("streams", `col-${uid}`, { block: "nearest", inline: "center" });

  const cycle = useRef({ conflict: -1, gap: -1 });
  const jumpTo = (kind) => {
    const targets =
      kind === "conflict"
        ? [...woven.sections, { id: null, tab: activeTab, items: woven.unsorted }].flatMap((s) => s.items.filter((i) => i.conflicts.length).map((i) => [`pt-${i.id}`, s.tab]))
        : woven.sections.filter((s) => s.heat >= 0.5).map((s) => [`sec-${s.id}`, s.tab]);
    if (!targets.length) return;
    cycle.current[kind] = (cycle.current[kind] + 1) % targets.length;
    const [id, tab] = targets[cycle.current[kind]];
    if (tab && tab !== activeTab) openTab(tab);
    reveal("woven", id);
  };

  // The composer lives in the side panel; open it first if it's closed.
  const composerApi = useRef(null);
  const withComposer = (fn) => {
    setShowPanel(true);
    const run = (tries) => (composerApi.current ? fn(composerApi.current) : tries && setTimeout(() => run(tries - 1), 40));
    run(10);
  };
  const startTopic = (level) => withComposer((api) => api.startTopic(level));

  const addAgenda = async (titles) => {
    await store.addSections(docId, user, titles, nextOrder(doc.sections), activeTab);
    setModal(null);
    toast(`Added ${titles.length} topics`, { icon: "list-tree" });
  };

  /** New tab. A doc without tabs first gets “Tab 1” holding everything it already has. */
  const addTab = async (parentId = null) => {
    if (!canEdit) return;
    const title = await ask({ title: parentId ? "New sub-tab" : "New tab", input: { value: "", placeholder: "Tab name" }, confirm: "Add tab", icon: "panel-top" });
    if (!title) return;
    if (!tabs.length && Object.keys(doc.sections || {}).length) await store.addTab(docId, user, "Tab 1", 0);
    const id = await store.addTab(docId, user, title, nextOrder(doc.tabs || {}, parentId) + (tabs.length ? 0 : 1), parentId);
    openTab(id);
    setTarget("auto");
  };

  const exportMarkdown = () => {
    const md = toMarkdown(doc, woven, nameOf);
    const name = (doc.meta.title || "notes").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "notes";
    download(`${name}.md`, md);
    toast("Markdown downloaded", { icon: "download" });
  };
  const exportPdf = () => {
    if (view === "streams") setView("woven");
    setTimeout(() => window.print(), 120);
  };

  const removeDoc = async () => {
    const sure = await ask({
      title: `Delete “${doc.meta.title}”?`,
      body: "Every stream and note in this doc is deleted for everyone. This can't be undone.",
      confirm: "Delete forever",
      danger: true,
      icon: "trash-2",
    });
    if (!sure) return;
    await store.deleteDoc(user.uid, doc);
    go("/");
    toast("Doc deleted", { icon: "trash-2" });
  };
  const leave = async () => {
    const sure = await ask({ title: "Leave this doc?", body: "Your notes stay in it. The owner can invite you again.", confirm: "Leave", danger: true, icon: "log-out" });
    if (!sure) return;
    await store.leaveDoc(user.uid, docId);
    go("/");
  };

  const ctx = {
    doc,
    docId,
    user,
    role,
    canEdit,
    isOwner,
    woven: tabWoven,
    fullWoven: woven,
    tabs,
    activeTab,
    setActiveTab: openTab,
    people,
    nameOf,
    online,
    writersIn,
    now,
    query,
    showTimes,
    showHeat,
    showConflicts,
    target,
    setTarget,
    resolvedTarget,
    latest,
    mergeFrom,
    setMergeFrom,
    activeSection,
    setActiveSection,
    scrollToSection,
    composerRef,
    composerApi,
    focusComposer: (sid) => {
      if (sid !== undefined) setTarget(sid);
      setShowPanel(true);
      setTimeout(() => composerRef.current?.focus(), 40);
    },
    nestUnder: (noteId) => withComposer((api) => api.nestUnder(noteId)),
    startTopic,
    showInWeave,
    showInStream,
    showStreamOf,
  };

  const stats = woven.stats;
  const gaps = woven.sections.filter((s) => s.heat >= 0.5).length;
  const onlinePeople = people.filter((p) => online.has(p.uid)).map((p) => ({ ...p, online: true, title: `${p.name}${p.uid === user.uid ? " (you)" : ""} · online` }));
  const style = { ...DEFAULT_STYLE, ...(doc.style || {}) };
  const setStyle = (patch) => canEdit && store.setStyle(docId, patch);
  // Suggestions others left on my notes.
  const forMe = Object.entries(doc.suggestions || {}).filter(([nid, s]) => doc.notes?.[nid]?.author === user.uid && s && Object.keys(s).some((u) => u !== user.uid));
  const openSuggestions = () => {
    setShowPanel(true);
    reveal(null, `my-${forMe[0][0]}`, { block: "center" });
  };

  const menus = [
    {
      label: "File",
      items: [
        { label: "New doc", icon: "file-plus", onSelect: () => go("/") },
        { label: "Import into this doc…", hint: "Word, Google Docs, Markdown, text", icon: "file-up", disabled: !canEdit, onSelect: () => setModal("import") },
        { label: "Share…", icon: "user-plus", onSelect: () => setModal("share") },
        { sep: true },
        { label: "Download Markdown", hint: ".md with credits", icon: "download", onSelect: exportMarkdown },
        { label: "Print / save as PDF", hint: view === "edit" ? "the final doc" : "the woven doc", icon: "printer", kbd: "Ctrl P", onSelect: exportPdf },
        { sep: true },
        ...(isOwner
          ? [
              { label: "Rename…", icon: "pencil", onSelect: async () => { const t = await ask({ title: "Rename doc", input: { value: doc.meta.title }, confirm: "Rename", icon: "pencil" }); if (t) store.renameDoc(docId, t); } },
              { label: "Delete doc", icon: "trash-2", danger: true, onSelect: removeDoc },
            ]
          : [{ label: "Leave doc", icon: "log-out", danger: true, onSelect: leave }]),
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Find in notes", icon: "search", kbd: "Ctrl F", onSelect: () => searchRef.current?.focus() },
        { label: "Write a note", icon: "notebook-pen", kbd: "/", disabled: !canEdit, onSelect: () => ctx.focusComposer() },
        { sep: true },
        { label: "Next conflict", icon: "triangle-alert", disabled: !stats.conflicts, onSelect: () => jumpTo("conflict") },
        { label: "Next gap", icon: "flame", disabled: !gaps, onSelect: () => jumpTo("gap") },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Woven doc", icon: "file-text", checked: view === "woven", onSelect: () => setView("woven") },
        { label: "Everyone's streams", icon: "columns-3", checked: view === "streams", onSelect: () => setView("streams") },
        { label: "Edit mode", hint: "final doc, like a word processor", icon: "file-pen-line", checked: view === "edit", onSelect: () => setView("edit") },
        { sep: true },
        { label: "Spine outline", icon: "list-tree", checked: showSpine, onSelect: () => setShowSpine((v) => !v) },
        { label: "My stream panel", icon: "notebook-pen", checked: showPanel, onSelect: () => setShowPanel((v) => !v) },
        { sep: true },
        { label: "Timestamps", icon: "clock", checked: showTimes, onSelect: () => setShowTimes((v) => !v) },
        { label: "Conflict highlights", icon: "triangle-alert", checked: showConflicts, onSelect: () => setShowConflicts((v) => !v) },
        { label: "Gap heatmap", icon: "flame", checked: showHeat, onSelect: () => setShowHeat((v) => !v) },
        { sep: true },
        { label: "Appearance…", icon: "palette", onSelect: () => setModal("theme") },
      ],
    },
    {
      label: "Insert",
      items: [
        { label: "Topic", hint: "or type #Topic", icon: "hash", disabled: !canEdit, onSelect: () => startTopic(0) },
        { label: "Subtopic", hint: "or type ##Subtopic", icon: "corner-down-left", disabled: !canEdit || !resolvedTarget, onSelect: () => startTopic(1) },
        { label: "Topics from agenda…", icon: "clipboard-list", disabled: !canEdit, onSelect: () => setModal("agenda") },
        { sep: true },
        { label: "Tab", hint: "a separate page in this doc", icon: "panel-top", disabled: !canEdit, onSelect: () => addTab() },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Take the tour", icon: "sparkle", onSelect: () => setTour(true) },
        { label: "How Unison works", icon: "circle-help", onSelect: () => setModal("help") },
      ],
    },
  ];

  return html`<div class=${`doc-app view-${view}${showSpine ? " has-spine" : ""}${showPanel ? " has-panel" : ""}${mergeFrom ? " is-picking" : ""}`}>
    <header class="doc-header">
      <a class="doc-logo" href="#/" title="Your docs"><${Logo} size=${38} /></a>
      <div class="doc-heading">
        <div class="doc-title-row">
          <${TitleField} doc=${doc} editable=${isOwner} />
          ${!canEdit && html`<span class="role-pill role-pill--viewer"><${Icon} name="eye" size=${12} /> View only</span>`}
          <span class="save-state mono" title="Notes sync when you press Enter"><span class="dot-live" />synced</span>
        </div>
        <nav class="menubar">
          ${menus.map(
            (m) => html`<${Menu}
              key=${m.label}
              width=${248}
              trigger=${(open, toggle) => html`<button class=${"menubar-btn" + (open ? " is-open" : "")} onClick=${toggle}>${m.label}</button>`}
              items=${m.items}
            />`,
          )}
        </nav>
      </div>
      <div class="doc-header-right">
        <${AvatarStack} people=${onlinePeople} max=${4} size=${30} />
        <${ModeToggle} />
        <button class="btn btn--share" onClick=${() => setModal("share")} data-tour="share">
          <${Icon} name=${Object.keys(doc.members || {}).length > 1 ? "users" : "lock"} size=${15} /> Share
        </button>
        <${AccountMenu} user=${user} backend=${backend} onTheme=${() => setModal("theme")} />
      </div>
    </header>

    <div class="toolbar">
      <div class="toolbar-group">
        <button class=${"tool-btn" + (showSpine ? " is-on" : "")} onClick=${() => setShowSpine((v) => !v)} title="Spine outline" aria-label="Toggle spine"><${Icon} name="list-tree" /></button>
        <span class="tool-sep" />
        <div class="segmented segmented--tool" role="tablist" data-tour="views">
          <button class=${view === "woven" ? "is-on" : ""} onClick=${() => setView("woven")} title="Everyone's notes, woven together"><${Icon} name="file-text" size=${14} /> Woven</button>
          <button class=${view === "streams" ? "is-on" : ""} onClick=${() => setView("streams")} title="Each person's raw notes"><${Icon} name="columns-3" size=${14} /> Streams</button>
          <button class=${view === "edit" ? "is-on" : ""} onClick=${() => setView("edit")} title="A final copy you can edit like a normal document"><${Icon} name="file-pen-line" size=${14} /> Edit</button>
        </div>
        ${view !== "streams" &&
        html`<span class="tool-sep" />
          <${Menu}
            width=${210}
            trigger=${(open, toggle) => html`<button class=${"tool-select" + (open ? " is-open" : "")} onClick=${toggle} disabled=${!canEdit} title="Document font">
              <span style=${{ fontFamily: fontCss(style.font) }}>${FONTS.find((f) => f.id === style.font)?.name || "Geist"}</span><${Icon} name="chevron-down" size=${13} />
            </button>`}
            items=${[{ heading: "Document font" }, ...FONTS.map((f) => ({ label: html`<span style=${{ fontFamily: f.css }}>${f.name}</span>`, checked: f.id === style.font, onSelect: () => setStyle({ font: f.id }) }))]}
          />
          <span class="tool-size" title="Document text size">
            <button class="tool-btn tool-btn--sm" disabled=${!canEdit || style.size <= 10} onClick=${() => setStyle({ size: style.size - 1 })} aria-label="Smaller text"><${Icon} name="minus" size=${14} /></button>
            <span class="mono">${style.size}</span>
            <button class="tool-btn tool-btn--sm" disabled=${!canEdit || style.size >= 28} onClick=${() => setStyle({ size: style.size + 1 })} aria-label="Larger text"><${Icon} name="plus" size=${14} /></button>
          </span>
          <${Menu}
            width=${180}
            trigger=${(open, toggle) => html`<button class=${"tool-btn" + (open ? " is-open" : "")} onClick=${toggle} disabled=${!canEdit} title="Line spacing" aria-label="Line spacing"><${Icon} name="a-large-small" /></button>`}
            items=${[{ heading: "Line spacing" }, ...SPACINGS.map(([v, label]) => ({ label, checked: style.spacing === v, onSelect: () => setStyle({ spacing: v }) }))]}
          />`}
        <span class="tool-sep" />
        ${forMe.length > 0 &&
        html`<button class="stat stat--btn stat--suggest mono" onClick=${openSuggestions} title="Others suggested changes to your notes">
          <${Icon} name="pencil" size=${13} /> <b>${forMe.length}</b> for you
        </button>`}
        <button class=${"stat stat--btn stat--warn mono" + (stats.conflicts ? "" : " is-zero")} onClick=${() => jumpTo("conflict")} disabled=${!stats.conflicts} title="Jump to next conflict">
          <${Icon} name="triangle-alert" size=${13} /> <b>${stats.conflicts}</b> conflict${stats.conflicts === 1 ? "" : "s"}
        </button>
        <button class=${"stat stat--btn stat--heat mono" + (gaps ? "" : " is-zero")} onClick=${() => jumpTo("gap")} disabled=${!gaps} title="Jump to next thin topic">
          <${Icon} name="flame" size=${13} /> <b>${gaps}</b> gap${gaps === 1 ? "" : "s"}
        </button>
      </div>
      <div class="toolbar-group toolbar-group--right">
        <label class="tool-search">
          <${Icon} name="search" size=${14} />
          <input ref=${searchRef} placeholder="Filter notes" value=${query} onInput=${(e) => setQuery(e.target.value)} onKeyDown=${(e) => e.key === "Escape" && (setQuery(""), e.target.blur())} />
          ${query && html`<button class="icon-btn icon-btn--sm" onClick=${() => setQuery("")} aria-label="Clear filter"><${Icon} name="x" size=${13} /></button>`}
        </label>
        <span class="tool-sep" />
        <button class=${"tool-btn" + (showTimes ? " is-on" : "")} onClick=${() => setShowTimes((v) => !v)} title="Timestamps"><${Icon} name="clock" /></button>
        <button class=${"tool-btn" + (showConflicts ? " is-on" : "")} onClick=${() => setShowConflicts((v) => !v)} title="Conflict highlights"><${Icon} name="triangle-alert" /></button>
        <button class=${"tool-btn" + (showHeat ? " is-on" : "")} onClick=${() => setShowHeat((v) => !v)} title="Gap heatmap"><${Icon} name="flame" /></button>
        <span class="tool-sep" />
        <button class=${"tool-btn" + (showPanel ? " is-on" : "")} onClick=${() => setShowPanel((v) => !v)} title="My stream" aria-label="Toggle my stream"><${Icon} name="notebook-pen" /></button>
      </div>
    </div>

    ${mergeFrom &&
    html`<div class="merge-banner">
      <${Icon} name="git-merge" />
      <span>Click the point your note repeats. It will collapse into it.</span>
      <button class="btn btn--ghost btn--sm" onClick=${() => setMergeFrom(null)}>Cancel <${Kbd}>Esc<//></button>
    </div>`}

    <div class="doc-body">
      ${showSpine && html`<${Spine} ctx=${ctx} onAddSection=${() => startTopic(0)} onAgenda=${() => setModal("agenda")} onAddTab=${addTab} />`}
      <main class="canvas" style=${styleVars(style)}>
        ${view === "edit" ? html`<${EditMode} ctx=${ctx} />` : view === "streams" ? html`<${StreamsView} ctx=${ctx} />` : html`<${WovenPage} ctx=${ctx} />`}
      </main>
      ${showPanel && html`<${StreamPanel} ctx=${ctx} onClose=${() => setShowPanel(false)} />`}
    </div>

    <${ShareModal} open=${modal === "share"} onClose=${() => setModal(null)} doc=${doc} user=${user} role=${role} />
    <${ThemePicker} open=${modal === "theme"} onClose=${() => setModal(null)} />
    <${HelpModal} open=${modal === "help"} onClose=${() => setModal(null)} onTour=${() => (setModal(null), setTour(true))} />
    <${AgendaModal} open=${modal === "agenda"} onClose=${() => setModal(null)} onAdd=${addAgenda} />
    <${ImportModal}
      open=${modal === "import"}
      onClose=${() => setModal(null)}
      mode="append"
      onImport=${async (data) => {
        const res = await importInto(docId, user, data, { sections: doc.sections, tabs: doc.tabs, contextSection: resolvedTarget, tabId: activeTab });
        setModal(null);
        setTarget("auto");
        toast(`Imported ${res.notes} notes${res.tabs ? ` in ${res.tabs} tabs` : ""}`, { icon: "file-up" });
      }}
    />
    ${tour &&
    html`<${Tour}
      ctx=${ctx}
      stage=${{ setShowPanel, setShowSpine, setView }}
      onClose=${() => {
        localStorage.setItem(TOUR_KEY, "1");
        setTour(false);
      }}
    />`}
  </div>`;
}

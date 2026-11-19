// Home: Google Docs structure (template gallery up top, then your docs list with an
// ownership filter, sorted by last opened), dressed in the Tern aesthetic.
import { html, useState, useEffect, useMemo, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Logo, Avatar, Menu, Modal, toast, ask, timeAgo, useNow, go } from "./kit.js";
import { ModeToggle, ThemePicker } from "./theme-picker.js";
import { TEMPLATES } from "../templates.js";
import { agendaToSections } from "../weave.js";
import { watchMyDocs, watchDocMeta, createDoc, renameDoc, deleteDoc, leaveDoc, forgetDoc, setStyle } from "../store.js";
import { ImportModal, importInto } from "./import.js";

export function AccountMenu({ user, backend, onTheme }) {
  return html`<${Menu}
    align="right"
    width=${260}
    trigger=${(open, toggle) => html`<button class=${"avatar-btn" + (open ? " is-open" : "")} onClick=${toggle} aria-label="Account">
      <${Avatar} ...${user} size=${32} />
    </button>`}
    items=${[
      { heading: html`<div class="acct-head"><${Avatar} ...${user} size=${36} /><span><b>${user.name}</b><small>${user.email}</small></span></div>` },
      { sep: true },
      { label: "Appearance…", icon: "palette", onSelect: onTheme },
      { label: "About Unison", icon: "circle-help", onSelect: () => go("/about") },
      { label: backend.auth.kind === "local" ? "Switch account" : "Sign out", icon: "log-out", onSelect: () => backend.auth.signOut() },
    ]}
  />`;
}

/** Live list of the user's docs joined with each doc's meta. */
function useMyDocs(uid) {
  const [entries, setEntries] = useState(null);
  const [metas, setMetas] = useState({});
  const subs = useRef(new Map());
  useEffect(() => watchMyDocs(uid, setEntries), [uid]);
  useEffect(() => {
    if (!entries) return;
    const ids = new Set(Object.keys(entries));
    for (const [id, stop] of subs.current) {
      if (!ids.has(id)) {
        stop();
        subs.current.delete(id);
      }
    }
    for (const id of ids) {
      if (subs.current.has(id)) continue;
      const gone = () => {
        // Deleted, or we were removed: drop it from our list.
        setMetas((m) => ({ ...m, [id]: false }));
        forgetDoc(uid, id).catch(() => {});
      };
      subs.current.set(id, watchDocMeta(id, (meta) => (meta ? setMetas((m) => ({ ...m, [id]: meta })) : gone()), gone));
    }
  }, [entries]);
  useEffect(() => () => subs.current.forEach((stop) => stop()), []);
  const docs = useMemo(
    () =>
      entries &&
      Object.entries(entries)
        .filter(([id]) => metas[id])
        .map(([id, e]) => ({ id, ...e, meta: metas[id] }))
        .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)),
    [entries, metas],
  );
  const pending = entries ? Object.keys(entries).some((id) => metas[id] === undefined) : true;
  return { docs, pending };
}

function Thumb({ id, title }) {
  // Deterministic little woven page so every doc card looks a bit different.
  let seed = 0;
  for (const c of id) seed = (seed * 33 + c.charCodeAt(0)) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const blocks = [];
  const sections = 2 + Math.floor(rnd() * 2);
  for (let s = 0; s < sections; s++) {
    blocks.push(html`<i class="th-h" style=${{ width: 30 + rnd() * 30 + "%" }} />`);
    const n = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < n; b++) {
      blocks.push(html`<i class="th-b" style=${{ width: 45 + rnd() * 45 + "%", "--who": `var(--a${1 + Math.floor(rnd() * 8)})` }} />`);
    }
  }
  return html`<div class="thumb" aria-hidden="true">
    <div class="thumb-page">
      <b class="th-title">${title}</b>
      ${blocks}
    </div>
  </div>`;
}

function TemplateGallery({ onPick, busy }) {
  return html`<section class="gallery">
    <div class="gallery-inner">
      <div class="gallery-head">
        <span class="kicker">Start a new doc</span>
        <button class="btn btn--sm" onClick=${() => onPick(TEMPLATES.find((t) => t.id === "import"))} disabled=${busy}><${Icon} name="file-up" size=${14} /> Import a doc</button>
      </div>
      <div class="gallery-row">
        ${TEMPLATES.map(
          (t, i) => html`<button key=${t.id} class="tpl" style=${{ "--i": i }} onClick=${() => onPick(t)} disabled=${busy}>
            <span class=${"tpl-art" + (t.id === "blank" ? " tpl-art--blank" : t.id === "import" ? " tpl-art--import" : "")}>
              ${t.id === "blank"
                ? html`<span class="tpl-plus"><${Icon} name="plus" size=${30} stroke=${1.5} /></span>`
                : t.id === "import"
                  ? html`<span class="tpl-import"><${Icon} name="file-up" size=${28} stroke=${1.5} /><span class="mono">.docx .md .txt .html</span></span>`
                : html`<span class="tpl-page">
                    <span class="tpl-icon"><${Icon} name=${t.icon} size=${15} /></span>
                    ${(t.sections || ["Item one", "Item two", "Item three"]).slice(0, 4).map(
                      (s) => html`<span class="tpl-sec"><b>${t.sections ? s : ""}</b><i /><i /></span>`,
                    )}
                  </span>`}
            </span>
            <span class="tpl-name">${t.name}</span>
            <span class="tpl-blurb">${t.blurb}</span>
          </button>`,
        )}
      </div>
    </div>
  </section>`;
}

function NewDocModal({ template, onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (template) {
      setTitle(template.id === "blank" || template.id === "agenda" ? "" : template.name);
      setAgenda("");
      setTimeout(() => ref.current?.select(), 60);
    }
  }, [template]);
  const sections = template?.sections ?? agendaToSections(agenda);
  const submit = () => onCreate(title, sections);
  return html`<${Modal}
    open=${!!template}
    onClose=${onClose}
    title=${template ? (template.id === "blank" ? "New doc" : template.name) : ""}
    subtitle=${template?.blurb}
    icon=${template?.icon}
    width=${520}
    footer=${html`<button class="btn btn--ghost" onClick=${onClose}>Cancel</button>
      <button class="btn btn--primary" onClick=${submit}>Create doc <${Icon} name="arrow-right" /></button>`}
  >
    <label class="field-label">
      <span>Title</span>
      <input ref=${ref} class="field" placeholder="e.g. BIO 201 · Week 6 lecture" value=${title} onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => e.key === "Enter" && submit()} />
    </label>
    ${template?.id === "agenda" &&
    html`<label class="field-label">
      <span>Agenda <small>one topic per line</small></span>
      <textarea class="field field--area mono" rows="6" placeholder=${"1. Welcome\n2. Budget review\n3. Event planning\n4. Open floor"} value=${agenda} onInput=${(e) => setAgenda(e.target.value)} />
    </label>`}
    ${sections.length > 0 &&
    html`<div class="spine-preview">
      <div class="kicker">Spine · ${sections.length} topics</div>
      <ol>
        ${sections.map((s, i) => html`<li key=${i}><span class="mono">${String(i + 1).padStart(2, "0")}</span>${s}</li>`)}
      </ol>
    </div>`}
    ${template?.id === "blank" &&
    html`<p class="hint-line"><${Icon} name="hash" size=${14} /> Anyone can add topics while writing: type <code>#Topic</code> in the composer, or <code>##Subtopic</code> to nest one.</p>`}
  <//>`;
}

function DocActions({ doc, user }) {
  const owner = doc.role === "owner";
  return html`<${Menu}
    align="right"
    width=${210}
    trigger=${(open, toggle) => html`<button class=${"icon-btn doc-kebab" + (open ? " is-open" : "")} onClick=${(e) => (e.stopPropagation(), toggle())} aria-label="Doc actions">
      <${Icon} name="more-vertical" />
    </button>`}
    items=${[
      { label: "Open", icon: "file-text", onSelect: () => go(`/d/${doc.id}`) },
      { label: "Open in new tab", icon: "link", onSelect: () => window.open(`#/d/${doc.id}`, "_blank") },
      ...(owner
        ? [
            {
              label: "Rename",
              icon: "pencil",
              onSelect: async () => {
                const t = await ask({ title: "Rename doc", input: { value: doc.meta.title }, confirm: "Rename", icon: "pencil" });
                if (t) renameDoc(doc.id, t);
              },
            },
            { sep: true },
            {
              label: "Delete",
              icon: "trash-2",
              danger: true,
              onSelect: async () => {
                const sure = await ask({
                  title: `Delete “${doc.meta.title}”?`,
                  body: "This deletes every stream and note in it for everyone. It can't be undone.",
                  confirm: "Delete forever",
                  danger: true,
                  icon: "trash-2",
                });
                if (sure) deleteDoc(user.uid, { id: doc.id }).then(() => toast("Doc deleted", { icon: "trash-2" }));
              },
            },
          ]
        : [
            { sep: true },
            {
              label: "Leave doc",
              icon: "log-out",
              danger: true,
              onSelect: async () => {
                const sure = await ask({ title: `Leave “${doc.meta.title}”?`, body: "Your notes stay in the doc. The owner can invite you again.", confirm: "Leave", danger: true });
                if (sure) leaveDoc(user.uid, doc.id);
              },
            },
          ]),
    ]}
  />`;
}

const ROLE_LABEL = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

function DocCard({ doc, user, now, i }) {
  const mine = doc.role === "owner";
  return html`<div class="doc-card" style=${{ "--i": i }} onClick=${() => go(`/d/${doc.id}`)} role="link" tabindex="0" onKeyDown=${(e) => e.key === "Enter" && go(`/d/${doc.id}`)}>
    <${Thumb} id=${doc.id} title=${doc.meta.title} />
    <div class="doc-card-foot">
      <div class="doc-card-title">${doc.meta.title}</div>
      <div class="doc-card-meta">
        <${Icon} name=${mine ? "file-text" : "users"} size=${13} />
        <span>${mine ? "You" : doc.meta.ownerName || "Shared"}</span>
        <span class="sep">·</span>
        <span>Opened ${timeAgo(doc.lastOpened, now)}</span>
      </div>
      <${DocActions} doc=${doc} user=${user} />
    </div>
  </div>`;
}

function DocRow({ doc, user, now, i }) {
  const mine = doc.role === "owner";
  return html`<div class="doc-row" style=${{ "--i": i }} onClick=${() => go(`/d/${doc.id}`)} role="link" tabindex="0" onKeyDown=${(e) => e.key === "Enter" && go(`/d/${doc.id}`)}>
    <span class="doc-row-icon"><${Icon} name="file-text" size=${17} /></span>
    <span class="doc-row-title">${doc.meta.title}${!mine && html`<${Icon} name="users" size=${13} class="shared-ico" />`}</span>
    <span class="doc-row-owner">${mine ? "me" : doc.meta.ownerName || "—"}</span>
    <span class="doc-row-role"><span class=${"role-pill role-pill--" + doc.role}>${ROLE_LABEL[doc.role]}</span></span>
    <span class="doc-row-time mono">${timeAgo(doc.lastOpened, now)}</span>
    <span class="doc-row-actions"><${DocActions} doc=${doc} user=${user} /></span>
  </div>`;
}

const FILTERS = [
  ["all", "Owned by anyone"],
  ["mine", "Owned by me"],
  ["shared", "Shared with me"],
];

export function Home({ user, backend }) {
  const { docs, pending } = useMyDocs(user.uid);
  const [filter, setFilter] = useState(() => localStorage.getItem("unison.home.filter") || "all");
  const [layout, setLayout] = useState(() => localStorage.getItem("unison.home.layout") || "grid");
  const [query, setQuery] = useState("");
  const [template, setTemplate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const searchRef = useRef(null);
  const now = useNow();

  useEffect(() => localStorage.setItem("unison.home.filter", filter), [filter]);
  useEffect(() => localStorage.setItem("unison.home.layout", layout), [layout]);
  useEffect(() => {
    document.title = "Unison Notes";
    const onKey = (e) => {
      if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shown = (docs || []).filter(
    (d) =>
      (filter === "all" || (filter === "mine" ? d.role === "owner" : d.role !== "owner")) &&
      (!query || d.meta.title.toLowerCase().includes(query.trim().toLowerCase())),
  );
  const counts = {
    all: docs?.length || 0,
    mine: docs?.filter((d) => d.role === "owner").length || 0,
    shared: docs?.filter((d) => d.role !== "owner").length || 0,
  };

  const create = async (title, sections) => {
    setBusy(true);
    try {
      const id = await createDoc(user, { title, sections });
      setTemplate(null);
      go(`/d/${id}`);
    } catch (e) {
      toast(e.message || "Couldn't create doc", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return html`<div class="home">
    <header class="topbar">
      <a class="brand" href="#/">
        <${Logo} size=${36} />
        <span class="brand-name">Unison<span>Notes</span></span>
      </a>
      <label class="search">
        <${Icon} name="search" />
        <input ref=${searchRef} placeholder="Search your docs" value=${query} onInput=${(e) => setQuery(e.target.value)} />
        ${query ? html`<button class="icon-btn icon-btn--sm" onClick=${() => setQuery("")} aria-label="Clear"><${Icon} name="x" size=${14} /></button>` : html`<kbd class="kbd">/</kbd>`}
      </label>
      <div class="topbar-right">
        ${backend.db.kind === "local" && html`<span class="badge-local mono" title="No Firebase config: data is stored in this browser">LOCAL</span>`}
        <${ModeToggle} />
        <${AccountMenu} user=${user} backend=${backend} onTheme=${() => setThemeOpen(true)} />
      </div>
    </header>

    <${TemplateGallery} onPick=${setTemplate} busy=${busy} />

    <main class="docs">
      <div class="docs-head">
        <h2>Recent docs</h2>
        <div class="docs-tools">
          <div class="tabs" role="tablist">
            ${FILTERS.map(
              ([id, label]) => html`<button role="tab" aria-selected=${filter === id} class=${filter === id ? "is-on" : ""} onClick=${() => setFilter(id)}>
                ${label}<span class="tab-count mono">${counts[id]}</span>
              </button>`,
            )}
          </div>
          <div class="segmented segmented--icons">
            <button class=${layout === "grid" ? "is-on" : ""} onClick=${() => setLayout("grid")} aria-label="Grid view" title="Grid view"><${Icon} name="layout-grid" size=${15} /></button>
            <button class=${layout === "list" ? "is-on" : ""} onClick=${() => setLayout("list")} aria-label="List view" title="List view"><${Icon} name="list" size=${15} /></button>
          </div>
        </div>
      </div>

      ${docs === null || (pending && !shown.length)
        ? html`<div class="doc-grid">${[0, 1, 2, 3].map((i) => html`<div class="doc-card doc-card--ghost" key=${i} style=${{ "--i": i }} />`)}</div>`
        : !shown.length
          ? html`<div class="empty">
              <div class="empty-art" aria-hidden="true">
                <span /><span /><span />
              </div>
              <h3>${query ? "No docs match that search" : filter === "shared" ? "Nothing shared with you yet" : "No docs yet"}</h3>
              <p>${query
                ? "Try a different title."
                : filter === "shared"
                  ? "When someone invites your email, the doc shows up here automatically."
                  : "Pick a template above, or start blank and build the spine as you go."}</p>
              ${!query && filter !== "shared" && html`<button class="btn btn--primary" onClick=${() => setTemplate(TEMPLATES[0])}><${Icon} name="plus" /> New doc</button>`}
            </div>`
          : layout === "grid"
            ? html`<div class="doc-grid">${shown.map((d, i) => html`<${DocCard} key=${d.id} doc=${d} user=${user} now=${now} i=${i} />`)}</div>`
            : html`<div class="doc-list">
                <div class="doc-row doc-row--head mono">
                  <span /><span>Title</span><span>Owner</span><span>Your role</span><span>Last opened</span><span />
                </div>
                ${shown.map((d, i) => html`<${DocRow} key=${d.id} doc=${d} user=${user} now=${now} i=${i} />`)}
              </div>`}
    </main>

    <button class="fab" onClick=${() => setTemplate(TEMPLATES[0])} aria-label="New doc" title="New doc"><${Icon} name="plus" size=${22} /></button>

    <${NewDocModal} template=${template?.id === "import" ? null : template} onClose=${() => setTemplate(null)} onCreate=${create} />
    <${ImportModal}
      open=${template?.id === "import"}
      onClose=${() => setTemplate(null)}
      onImport=${async (data) => {
        const id = await createDoc(user, { title: data.title, sections: [] });
        const style = Object.fromEntries(Object.entries(data.style || {}).filter(([, v]) => v != null));
        if (Object.keys(style).length) await setStyle(id, style);
        await importInto(id, user, data);
        setTemplate(null);
        go(`/d/${id}`);
      }}
    />
    <${ThemePicker} open=${themeOpen} onClose=${() => setThemeOpen(false)} />
  </div>`;
}

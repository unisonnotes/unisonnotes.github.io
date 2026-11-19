// The spine: the one shared structure, shown like Google Docs' outline panel, with
// gap heat, live writers, claims and per-section time ranges.
import { html } from "./h.js";
import { Icon } from "./icons.js";
import { Menu, Avatar, ask, toast, clock } from "./kit.js";
import * as store from "../store.js";

function SectionMenu({ ctx, s }) {
  const { docId, user, isOwner, canEdit, woven } = ctx;
  const mine = s.createdBy === user.uid || isOwner;
  const siblings = woven.sections.filter((x) => x.parentId === s.parentId);
  const index = siblings.findIndex((x) => x.id === s.id);
  const swap = (dir) => {
    const ids = siblings.map((x) => x.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    store.reorderSections(docId, ids);
  };
  const claimed = s.claim?.uid === user.uid;
  const kind = s.depth ? "subtopic" : "topic";
  return html`<${Menu}
    align="right"
    width=${230}
    trigger=${(open, toggle) => html`<button class=${"icon-btn icon-btn--sm spine-kebab" + (open ? " is-open" : "")} onClick=${(e) => (e.stopPropagation(), toggle())} aria-label="Topic actions"><${Icon} name="more-horizontal" size=${15} /></button>`}
    items=${[
      { label: "Write here", icon: "notebook-pen", disabled: !canEdit, onSelect: () => ctx.focusComposer(s.id) },
      {
        label: "Add subtopic",
        icon: "corner-down-left",
        disabled: !canEdit || s.depth >= 2,
        onSelect: () => {
          ctx.setTarget(s.id);
          ctx.startTopic(s.depth + 1);
        },
      },
      { label: claimed ? "Unclaim" : `Claim this ${kind}`, icon: "hand", disabled: !canEdit || (s.claim && !claimed && !isOwner), onSelect: () => store.claimSection(docId, s.id, claimed ? null : user) },
      ...(!s.parentId && ctx.tabs.length > 1
        ? [
            { heading: "Move to tab" },
            ...ctx.tabs
              .filter((t) => t.id !== s.tab)
              .map((t) => ({
                label: "  ".repeat(t.depth) + t.title,
                icon: "panel-top",
                disabled: !canEdit,
                onSelect: async () => {
                  await store.moveSectionToTab(docId, s.id, t.id, ctx.fullWoven.sections.filter((x) => x.tab === t.id && !x.parentId).length);
                  toast(html`<b>${s.title}</b> moved to ${t.title}`, { icon: "panel-top" });
                },
              })),
          ]
        : []),
      { sep: true },
      { label: "Move up", icon: "arrow-up", disabled: !canEdit || index <= 0, onSelect: () => swap(-1) },
      { label: "Move down", icon: "arrow-down", disabled: !canEdit || index === siblings.length - 1, onSelect: () => swap(1) },
      {
        label: "Rename…",
        icon: "pencil",
        disabled: !mine,
        onSelect: async () => {
          const t = await ask({ title: `Rename ${kind}`, input: { value: s.title }, confirm: "Rename", icon: "pencil" });
          if (t) store.renameSection(docId, s.id, t);
        },
      },
      { sep: true },
      {
        label: `Delete ${kind}`,
        icon: "trash-2",
        danger: true,
        disabled: !mine,
        onSelect: async () => {
          const subs = woven.sections.filter((x) => x.parentId === s.id).length;
          const sure = await ask({
            title: `Delete “${s.title}”?`,
            body: [
              s.noteCount ? `Its ${s.noteCount} notes move to Unsorted.` : "",
              subs ? `Its ${subs} subtopic${subs === 1 ? "" : "s"} become${subs === 1 ? "s" : ""} top-level topics.` : "",
              "Nobody's notes are deleted.",
            ]
              .filter(Boolean)
              .join(" "),
            confirm: `Delete ${kind}`,
            danger: true,
            icon: "trash-2",
          });
          if (sure) {
            await store.deleteSection(docId, s.id);
            toast(`${kind[0].toUpperCase() + kind.slice(1)} deleted`, { icon: "trash-2" });
          }
        },
      },
    ]}
  />`;
}

function TabMenu({ ctx, tab, onAddTab }) {
  const { docId, user, isOwner, canEdit, tabs, fullWoven } = ctx;
  const mine = tab.createdBy === user.uid || isOwner;
  const siblings = tabs.filter((t) => (t.parentId || null) === (tab.parentId || null));
  const index = siblings.findIndex((t) => t.id === tab.id);
  const swap = (dir) => {
    const ids = siblings.map((t) => t.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    store.reorderTabs(docId, ids);
  };
  // The tab and every tab nested in it.
  const family = [tab.id];
  for (const t of tabs) if (t.parentId && family.includes(t.parentId)) family.push(t.id);
  return html`<${Menu}
    align="right"
    width=${220}
    trigger=${(open, toggle) => html`<button class=${"icon-btn icon-btn--sm spine-kebab" + (open ? " is-open" : "")} onClick=${(e) => (e.stopPropagation(), toggle())} aria-label="Tab actions"><${Icon} name="more-horizontal" size=${15} /></button>`}
    items=${[
      {
        label: "Rename…",
        icon: "pencil",
        disabled: !mine,
        onSelect: async () => {
          const t = await ask({ title: "Rename tab", input: { value: tab.title }, confirm: "Rename", icon: "pencil" });
          if (t) store.renameTab(docId, tab.id, t);
        },
      },
      { label: "Add sub-tab", icon: "corner-down-left", disabled: !canEdit || tab.depth >= 2, onSelect: () => onAddTab(tab.id) },
      { sep: true },
      { label: "Move up", icon: "arrow-up", disabled: !canEdit || index <= 0, onSelect: () => swap(-1) },
      { label: "Move down", icon: "arrow-down", disabled: !canEdit || index === siblings.length - 1, onSelect: () => swap(1) },
      { sep: true },
      {
        label: "Delete tab",
        icon: "trash-2",
        danger: true,
        disabled: !mine,
        onSelect: async () => {
          const sections = fullWoven.sections.filter((s) => family.includes(s.tab));
          const notes = sections.reduce((n, s) => n + s.noteCount, 0);
          const subs = family.length - 1;
          const sure = await ask({
            title: `Delete tab “${tab.title}”?`,
            body: [
              sections.length ? `Its ${sections.length} topic${sections.length === 1 ? " is" : "s are"} removed${notes ? ` and their ${notes} notes move to Unsorted` : ""}.` : "",
              subs ? `Its ${subs} sub-tab${subs === 1 ? " goes" : "s go"} too.` : "",
              "Nobody's notes are deleted.",
            ]
              .filter(Boolean)
              .join(" "),
            confirm: "Delete tab",
            danger: true,
            icon: "trash-2",
          });
          if (!sure) return;
          await store.deleteTab(docId, family, sections.map((s) => s.id));
          toast("Tab deleted", { icon: "trash-2" });
        },
      },
    ]}
  />`;
}

function Topics({ ctx }) {
  const { woven, canEdit, resolvedTarget, writersIn, showHeat, activeSection, showTimes, latest, tabs } = ctx;
  const sections = woven.sections;
  return html`<ol class="spine-list">
    ${sections.map((s, i) => {
      const writers = writersIn(s.id);
      const hot = showHeat && s.heat >= 0.5;
      return html`<li
        key=${s.id}
        class=${`spine-item spine-item--d${Math.min(s.depth, 2)}` + (resolvedTarget === s.id && canEdit ? " is-target" : "") + (activeSection === s.id ? " is-active" : "") + (hot ? " is-hot" : "")}
        style=${{ "--heat-amt": showHeat ? s.heat : 0, "--i": Math.min(i, 30), "--depth": s.depth }}
        onClick=${() => ctx.scrollToSection(s.id)}
      >
        <span class="spine-rail" aria-hidden="true"><i /></span>
        <span class="spine-num mono">${s.depth ? s.number.slice(s.number.indexOf(".")) : s.number}</span>
        <span class="spine-main">
          <span class="spine-title">${s.title}${s.tag && html`<span class="spine-tag mono">#</span>`}</span>
          <span class="spine-sub mono">
            ${s.items.length} pt${s.items.length === 1 ? "" : "s"}
            ${showTimes && s.firstAt && html`<span>· ${clock(s.firstAt)}</span>`}
            ${s.id === latest?.id && html`<span class="spine-latest">· latest</span>`}
          </span>
        </span>
        <span class="spine-side">
          ${writers.length > 0 &&
          html`<span class="spine-writers" title=${writers.map((w) => w.name).join(", ") + " writing here"}>
            ${writers.slice(0, 3).map((w) => html`<${Avatar} key=${w.uid} ...${w} size=${18} online />`)}
          </span>`}
          ${s.claim && html`<span class="spine-claim" title=${`Claimed by ${s.claim.name}`}><${Icon} name="hand" size=${12} /></span>`}
          <${SectionMenu} ctx=${ctx} s=${s} />
        </span>
      </li>`;
    })}
    ${!sections.length &&
    html`<li class="spine-empty">
      <p>${tabs.length ? "No topics in this tab yet." : "No topics yet."}</p>
      <p class="mono">Type <b>#Topic</b> in your composer to start the spine for everyone, and <b>##Subtopic</b> to nest one inside it.</p>
    </li>`}
  </ol>`;
}

export function Spine({ ctx, onAddSection, onAgenda, onAddTab }) {
  const { woven, fullWoven, canEdit, resolvedTarget, showHeat, tabs, activeTab } = ctx;
  const notesIn = new Map();
  for (const s of fullWoven.sections) notesIn.set(s.tab, (notesIn.get(s.tab) || 0) + s.noteCount);
  const addMenu = canEdit &&
    html`<${Menu}
      align="right"
      width=${240}
      trigger=${(open, toggle) => html`<button class=${"icon-btn icon-btn--sm" + (open ? " is-open" : "")} onClick=${toggle} aria-label="Add" title="Add a topic or tab"><${Icon} name="plus" size=${15} /></button>`}
      items=${[
        { label: "New topic", icon: "hash", onSelect: onAddSection, hint: "or type #Topic" },
        { label: "Topics from agenda…", icon: "clipboard-list", onSelect: onAgenda },
        { label: "New tab", icon: "panel-top", onSelect: () => onAddTab(), hint: "a separate page" },
      ]}
    />`;
  // Like Google Docs: tabs listed down the side, the open tab's outline nested inside it.
  return html`<aside class="spine" aria-label="Spine" data-tour="spine">
    <div class="spine-head">
      <span class="kicker">${tabs.length ? "Tabs" : "Spine"}</span>
      <span class="spine-count mono">${tabs.length || woven.sections.length}</span>
      ${addMenu}
    </div>
    ${tabs.length
      ? html`<ol class="tab-list">
          ${tabs.map(
            (t) => html`<li key=${t.id} class=${"tab-item" + (t.id === activeTab ? " is-active" : "")} style=${{ "--depth": t.depth }}>
              <div class="tab-row">
                <button class="tab-btn" onClick=${() => (t.id === activeTab ? ctx.scrollToSection(woven.sections[0]?.id) : ctx.setActiveTab(t.id))} title=${t.title}>
                  <${Icon} name=${t.id === activeTab ? "file-text" : "file"} size=${14} />
                  <span class="tab-name">${t.title}</span>
                  <span class="tab-count mono">${notesIn.get(t.id) || 0}</span>
                </button>
                <${TabMenu} ctx=${ctx} tab=${t} onAddTab=${onAddTab} />
              </div>
              ${t.id === activeTab && html`<${Topics} ctx=${ctx} />`}
            </li>`,
          )}
        </ol>`
      : html`<${Topics} ctx=${ctx} />`}

    <button class=${"spine-unsorted" + (woven.unsorted.length ? " has-items" : "") + (resolvedTarget === null && canEdit ? " is-target" : "")} onClick=${() => ctx.scrollToSection(null)}>
      <${Icon} name="inbox" size=${15} />
      <span>Unsorted</span>
      <span class="mono">${woven.unsorted.length}</span>
    </button>

    <div class="spine-legend mono">
      <span><i class="lg lg--target" /> you're writing</span>
      ${showHeat && html`<span><i class="lg lg--heat" /> needs notes</span>`}
    </div>
  </aside>`;
}

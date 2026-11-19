// Share dialog, modeled on Google Docs: add people by email with a role, see who has
// access, pending invites, and general access.
import { html, useState, useRef, useEffect } from "./h.js";
import { Icon } from "./icons.js";
import { Modal, Avatar, Menu, toast, ask } from "./kit.js";
import * as store from "../store.js";

const ROLE_NAMES = { owner: "Owner", editor: "Editor", viewer: "Viewer" };
const ROLE_HINT = { editor: "Gets their own stream", viewer: "Reads the woven notes" };

function RolePicker({ value, onChange, disabled, extra = [] }) {
  if (disabled) return html`<span class="role-static mono">${ROLE_NAMES[value]}</span>`;
  return html`<${Menu}
    align="right"
    width=${230}
    trigger=${(open, toggle) => html`<button class=${"role-btn" + (open ? " is-open" : "")} onClick=${toggle}>${ROLE_NAMES[value]} <${Icon} name="chevron-down" size=${13} /></button>`}
    items=${[
      ...["editor", "viewer"].map((r) => ({ label: ROLE_NAMES[r], hint: ROLE_HINT[r], checked: value === r, onSelect: () => onChange(r) })),
      ...extra,
    ]}
  />`;
}

export function ShareModal({ open, onClose, doc, user, role }) {
  const owner = role === "owner";
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState("editor");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    if (open && owner) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const members = Object.entries(doc.members || {})
    .map(([uid, m]) => ({ uid, ...m }))
    .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name)));
  const invites = Object.entries(doc.invites || {}).map(([key, v]) => ({ key, ...v }));

  const send = async () => {
    const list = email
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!list.length) return;
    const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) return toast(`Not an email: ${bad[0]}`, { icon: "mail", tone: "danger" });
    const already = new Set(members.map((m) => m.email));
    setBusy(true);
    try {
      let sent = 0;
      for (const e of list) {
        if (already.has(e)) {
          toast(`${e} already has access`, { icon: "users" });
          continue;
        }
        await store.invite(doc, user, e, newRole);
        sent++;
      }
      if (sent) toast(sent === 1 ? html`Invited <b>${list[0]}</b> as ${ROLE_NAMES[newRole].toLowerCase()}` : `Invited ${sent} people`, { icon: "user-plus" });
      setEmail("");
    } catch (e) {
      toast(e.message || "Couldn't invite", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}#/d/${doc.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied. Only people with access can open it.", { icon: "link" });
    } catch {
      await ask({ title: "Copy this link", body: url, confirm: "Done", cancel: "Close" });
    }
  };

  return html`<${Modal}
    open=${open}
    onClose=${onClose}
    title=${`Share “${doc.meta.title}”`}
    icon="user-plus"
    width=${560}
    class="share"
    footer=${html`<button class="btn btn--ghost" onClick=${copyLink}><${Icon} name="link" /> Copy link</button>
      <span class="grow" />
      <button class="btn btn--primary" onClick=${onClose}>Done</button>`}
  >
    ${owner
      ? html`<div class="share-add">
          <label class="share-input">
            <${Icon} name="mail" size=${16} />
            <input
              ref=${inputRef}
              type="email"
              multiple
              placeholder="Add people by email"
              value=${email}
              onInput=${(e) => setEmail(e.target.value)}
              onKeyDown=${(e) => e.key === "Enter" && send()}
            />
          </label>
          <${RolePicker} value=${newRole} onChange=${setNewRole} />
          <button class="btn btn--primary" onClick=${send} disabled=${busy || !email.trim()}>Invite</button>
        </div>
        <p class="share-note">People without an account get the doc as soon as they sign in with that email.</p>`
      : html`<p class="share-note share-note--top"><${Icon} name="lock" size=${14} /> Only the owner can add people or change roles.</p>`}

    <div class="kicker share-kicker">People with access <span class="mono">${members.length}</span></div>
    <ul class="share-list">
      ${members.map(
        (m) => html`<li key=${m.uid}>
          <${Avatar} ...${m} size=${34} />
          <span class="share-who">
            <b>${m.name}${m.uid === user.uid && html`<small> (you)</small>`}</b>
            <small>${m.email}</small>
          </span>
          <${RolePicker}
            value=${m.role}
            disabled=${!owner || m.role === "owner"}
            onChange=${(r) => store.setRole(doc.id, m.uid, r).then(() => toast(`${m.name} is now ${ROLE_NAMES[r].toLowerCase()}`, { icon: "users" }))}
            extra=${[
              { sep: true },
              {
                label: "Remove access",
                icon: "trash-2",
                danger: true,
                onSelect: async () => {
                  if (await ask({ title: `Remove ${m.name}?`, body: "Their notes stay in the doc, credited to them.", confirm: "Remove", danger: true }))
                    store.removeMember(doc.id, m.uid);
                },
              },
            ]}
          />
        </li>`,
      )}
      ${invites.map(
        (inv) => html`<li key=${inv.key} class="is-pending">
          <span class="avatar avatar--pending" style="--size:34px"><${Icon} name="mail" size=${16} /></span>
          <span class="share-who">
            <b>${inv.email}</b>
            <small class="mono">invited · waiting for sign-in</small>
          </span>
          ${owner
            ? html`<${RolePicker}
                value=${inv.role}
                onChange=${(r) => store.invite(doc, user, inv.email, r)}
                extra=${[{ sep: true }, { label: "Cancel invite", icon: "x", danger: true, onSelect: () => store.cancelInvite(doc.id, inv.key) }]}
              />`
            : html`<span class="role-static mono">${ROLE_NAMES[inv.role]}</span>`}
        </li>`,
      )}
    </ul>

    <div class="kicker share-kicker">General access</div>
    <div class="general-access">
      <span class="ga-icon"><${Icon} name="lock" size=${16} /></span>
      <span class="share-who">
        <b>Restricted</b>
        <small>Only people added above can open this doc. View-only links are coming later.</small>
      </span>
    </div>
  <//>`;
}

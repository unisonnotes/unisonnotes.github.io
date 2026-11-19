// Shared UI primitives: logo, avatars, menus, modals, toasts, confirm dialogs, time.
import { html, useState, useEffect, useRef, useLayoutEffect } from "./h.js";
import { Icon } from "./icons.js";

// ───────────── Brand ─────────────

let logoSeq = 0;
/**
 * Two skewed discs overlapping: separate voices, one shared middle. Colors follow the
 * theme's glow pair. `draw` slides the discs together.
 */
export function Logo({ size = 28, draw = false }) {
  const id = useRef(null);
  if (id.current === null) id.current = `lg${++logoSeq}`;
  const k = id.current;
  return html`<svg class=${"logo" + (draw ? " logo--draw" : "")} width=${size} height=${size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id=${k + "a"} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" class="logo-a1" /><stop offset="1" class="logo-a2" />
      </linearGradient>
      <linearGradient id=${k + "b"} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" class="logo-b1" /><stop offset="1" class="logo-b2" />
      </linearGradient>
      <clipPath id=${k + "c"}><ellipse class="logo-disc-a" cx="12.2" cy="18" rx="8.8" ry="9.3" /></clipPath>
    </defs>
    <g transform="translate(16 16) skewX(-10) translate(-16 -16)">
      <ellipse class="logo-disc-a" cx="12.2" cy="18" rx="8.8" ry="9.3" fill=${`url(#${k}a)`} />
      <ellipse class="logo-disc-b" cx="19.8" cy="14" rx="8.8" ry="9.3" fill=${`url(#${k}b)`} />
      <ellipse class="logo-lens" cx="19.8" cy="14" rx="8.8" ry="9.3" clip-path=${`url(#${k}c)`} />
    </g>
  </svg>`;
}

// ───────────── People ─────────────

export function colorFor(uid = "") {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return `var(--a${(h % 8) + 1})`;
}

export const initials = (name = "?") =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("") || "?";

export function Avatar({ uid, name, photo, size = 28, online, title }) {
  const [broken, setBroken] = useState(false);
  return html`<span
    class=${"avatar" + (online ? " avatar--online" : "")}
    style=${{ "--size": size + "px", "--who": colorFor(uid) }}
    title=${title ?? name}
  >
    ${photo && !broken
      ? html`<img src=${photo} alt="" referrerpolicy="no-referrer" onError=${() => setBroken(true)} />`
      : html`<span>${initials(name)}</span>`}
  </span>`;
}

export function AvatarStack({ people, max = 4, size = 28 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return html`<span class="avatar-stack">
    ${shown.map((p) => html`<${Avatar} key=${p.uid} size=${size} ...${p} />`)}
    ${extra > 0 && html`<span class="avatar avatar--more" style=${{ "--size": size + "px" }}>+${extra}</span>`}
  </span>`;
}

export const Kbd = ({ children }) => html`<kbd class="kbd">${children}</kbd>`;

// ───────────── Time ─────────────

export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "—";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}

export const clock = (ms) =>
  ms ? new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

// ───────────── Popover menu ─────────────

function useDismiss(open, setOpen, ref) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
}

/**
 * items: [{label, icon, onSelect, danger, kbd, checked, disabled, hint} | {sep:true} | {heading}]
 * trigger: (open, toggle) => vnode
 */
export function Menu({ trigger, items, align = "left", width = 232, class: cls = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [flip, setFlip] = useState(false);
  useDismiss(open, setOpen, ref);
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const r = menuRef.current.getBoundingClientRect();
    setFlip(r.bottom > window.innerHeight - 8);
  }, [open]);
  const list = typeof items === "function" ? (open ? items() : []) : items;
  return html`<span class=${"menu-wrap " + cls} ref=${ref}>
    ${trigger(open, () => setOpen(!open))}
    ${open &&
    html`<div
      ref=${menuRef}
      class=${`menu menu--${align}${flip ? " menu--up" : ""}`}
      style=${{ width: width + "px" }}
      role="menu"
    >
      ${list.map((it, i) =>
        it.sep
          ? html`<div key=${i} class="menu-sep" />`
          : it.heading
            ? html`<div key=${i} class="menu-heading">${it.heading}</div>`
            : html`<button
                key=${i}
                role="menuitem"
                class=${"menu-item" + (it.danger ? " is-danger" : "") + (it.checked ? " is-checked" : "")}
                disabled=${it.disabled}
                onClick=${() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                <span class="menu-icon">${it.icon ? html`<${Icon} name=${it.icon} />` : it.checked ? html`<${Icon} name="check" />` : null}</span>
                <span class="menu-label">${it.label}${it.hint && html`<small>${it.hint}</small>`}</span>
                ${it.kbd && html`<${Kbd}>${it.kbd}<//>`}
                ${it.checked && it.icon && html`<${Icon} name="check" class="menu-check" />`}
              </button>`,
      )}
    </div>`}
  </span>`;
}

// ───────────── Modal ─────────────

export function Modal({ open, onClose, title, subtitle, icon, width = 520, children, footer, class: cls = "" }) {
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) {
      setShown(true);
      setLeaving(false);
    } else if (shown) {
      setLeaving(true);
      const t = setTimeout(() => setShown(false), 180);
      return () => clearTimeout(t);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!shown) return null;
  return html`<div class=${"modal-root" + (leaving ? " is-leaving" : "")}>
    <div class="modal-backdrop" onClick=${onClose} />
    <section class=${"modal " + cls} role="dialog" aria-modal="true" aria-label=${title} style=${{ width: `min(${width}px, calc(100vw - 32px))` }}>
      ${title &&
      html`<header class="modal-head">
        ${icon && html`<span class="modal-icon"><${Icon} name=${icon} size=${18} /></span>`}
        <div class="modal-titles">
          <h2>${title}</h2>
          ${subtitle && html`<p>${subtitle}</p>`}
        </div>
        <button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>
      </header>`}
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </section>
  </div>`;
}

// ───────────── Toasts ─────────────

const toastSubs = new Set();
let toastId = 0;
export function toast(message, { icon = "check", tone = "default", ms = 3600 } = {}) {
  const t = { id: ++toastId, message, icon, tone };
  toastSubs.forEach((fn) => fn(t, ms));
}

export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (t, ms) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.map((x) => (x.id === t.id ? { ...x, out: true } : x))), ms);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), ms + 220);
    };
    toastSubs.add(fn);
    return () => toastSubs.delete(fn);
  }, []);
  return html`<div class="toasts" aria-live="polite">
    ${items.map(
      (t) => html`<div key=${t.id} class=${`toast toast--${t.tone}${t.out ? " is-out" : ""}`}>
        <${Icon} name=${t.icon} />
        <span>${t.message}</span>
      </div>`,
    )}
  </div>`;
}

// ───────────── Confirm / prompt dialogs ─────────────

let openDialog = null;
/** Promise-based confirm. Resolves true/false, or the entered string for prompts. */
export function ask({ title, body, confirm = "OK", cancel = "Cancel", danger = false, input = null, icon }) {
  return new Promise((resolve) => openDialog?.({ title, body, confirm, cancel, danger, input, icon, resolve }));
}

export function DialogHost() {
  const [d, setD] = useState(null);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    openDialog = (opts) => {
      setValue(opts.input?.value ?? "");
      setD({ ...opts, open: true });
    };
    return () => (openDialog = null);
  }, []);
  useEffect(() => {
    if (d?.open && d.input) setTimeout(() => inputRef.current?.select(), 30);
  }, [d?.open]);
  const close = (result) => {
    d?.resolve(result);
    setD((x) => x && { ...x, open: false });
  };
  const ok = () => close(d.input ? value.trim() || null : true);
  return html`<${Modal}
    open=${!!d?.open}
    onClose=${() => close(d?.input ? null : false)}
    title=${d?.title}
    icon=${d?.icon}
    width=${440}
    footer=${d &&
    html`<button class="btn btn--ghost" onClick=${() => close(d.input ? null : false)}>${d.cancel}</button>
      <button class=${"btn " + (d.danger ? "btn--danger" : "btn--primary")} onClick=${ok}>${d.confirm}</button>`}
  >
    ${d?.body && html`<p class="dialog-body">${d.body}</p>`}
    ${d?.input &&
    html`<input
      ref=${inputRef}
      class="field"
      value=${value}
      placeholder=${d.input.placeholder || ""}
      onInput=${(e) => setValue(e.target.value)}
      onKeyDown=${(e) => e.key === "Enter" && ok()}
    />`}
  <//>`;
}

/** Download a text file. */
export function download(filename, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

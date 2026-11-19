import { html } from "./h.js";
import { ICONS } from "./icon-paths.js";

export function Icon({ name, size = 16, stroke = 1.75, class: cls = "" }) {
  return html`<svg
    class=${"icon " + cls}
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width=${stroke}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || "" }}
  />`;
}

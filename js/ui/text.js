import { html } from "./h.js";

// Whitespace-delimited chunks, matching how weave.js tokenizes numbers ("CO2", "3:45pm").
const CHUNK_RE = /\S+/gu;
const TAG_RE = /^#[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const EDGE_RE = /^([^\p{L}\p{N}$#]*)(.*?)([^\p{L}\p{N}%]*)$/su;

const norm = (core) => core.toLowerCase().replace(/,(?=\d{3}\b)/g, "");

/** Render note text with #tags styled, clashing numbers/dates and filter hits highlighted. */
export function NoteText({ text, clash, query }) {
  const out = [];
  const q = query?.trim().toLowerCase();
  const push = (s) => {
    if (!s) return;
    if (!q) return out.push(s);
    const lower = s.toLowerCase();
    let i = 0;
    for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, i)) {
      out.push(s.slice(i, at), html`<mark class="hit">${s.slice(at, at + q.length)}</mark>`);
      i = at + q.length;
    }
    out.push(s.slice(i));
  };
  let last = 0;
  for (const m of text.matchAll(CHUNK_RE)) {
    const [, lead, core] = EDGE_RE.exec(m[0]);
    const isTag = TAG_RE.test(core);
    const isClash = !isTag && clash?.size && clash.has(norm(core));
    if (!isTag && !isClash) continue;
    const start = m.index + lead.length;
    push(text.slice(last, start));
    out.push(isTag ? html`<span class="tag">${core}</span>` : html`<mark class="clash" title="Differs from a similar note">${core}</mark>`);
    last = start + core.length;
  }
  push(text.slice(last));
  return html`${out}`;
}

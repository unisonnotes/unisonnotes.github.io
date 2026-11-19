import { html } from "./h.js";

// Whitespace-delimited chunks, matching how weave.js tokenizes numbers ("CO2", "3:45pm").
const CHUNK_RE = /\S+/gu;
const TAG_RE = /^#[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const EDGE_RE = /^([^\p{L}\p{N}$#]*)(.*?)([^\p{L}\p{N}%]*)$/su;
// Inline formatting: **bold**, *italic* or _italic_, ~~strike~~, ==highlight==, `code`, bare links.
const MARK_RE = /\*\*(?=\S)(?<b>.+?)(?<=\S)\*\*|`(?<code>[^`\n]+)`|~~(?=\S)(?<s>.+?)(?<=\S)~~|==(?=\S)(?<hl>.+?)(?<=\S)==|(?<![\p{L}\p{N}*])\*(?=\S)(?<i1>[^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_(?=\S)(?<i2>[^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])|(?<url>https?:\/\/[^\s<>"')\]]+)/gu;

const norm = (core) => core.toLowerCase().replace(/,(?=\d{3}\b)/g, "");

/** Tags, clashing numbers and filter hits within one run of plain text. */
function plain(text, clash, q, out) {
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
  return out;
}

/** Render note text with light formatting, #tags, clashing numbers/dates and filter hits. */
export function NoteText({ text, clash, query }) {
  const q = query?.trim().toLowerCase();
  const out = [];
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    plain(text.slice(last, m.index), clash, q, out);
    const g = m.groups;
    if (g.b) out.push(html`<strong>${plain(g.b, clash, q, [])}</strong>`);
    else if (g.code) out.push(html`<code class="inline-code">${g.code}</code>`);
    else if (g.s) out.push(html`<s>${plain(g.s, clash, q, [])}</s>`);
    else if (g.hl) out.push(html`<mark class="hl">${plain(g.hl, clash, q, [])}</mark>`);
    else if (g.i1 || g.i2) out.push(html`<em>${plain(g.i1 || g.i2, clash, q, [])}</em>`);
    else out.push(html`<a class="note-link" href=${g.url} target="_blank" rel="noopener noreferrer" onClick=${(e) => e.stopPropagation()}>${g.url.replace(/^https?:\/\//, "")}</a>`);
    last = m.index + m[0].length;
  }
  plain(text.slice(last), clash, q, out);
  return html`${out}`;
}

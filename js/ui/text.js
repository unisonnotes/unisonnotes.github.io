import { html, useState, useEffect } from "./h.js";
import { loadImage } from "../images.js";

// Whitespace-delimited chunks, matching how weave.js tokenizes numbers ("CO2", "3:45pm").
const CHUNK_RE = /\S+/gu;
const TAG_RE = /^#[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;
const EDGE_RE = /^([^\p{L}\p{N}$#]*)(.*?)([^\p{L}\p{N}%]*)$/su;
// Inline formatting: `code`, ![](img:id) pictures, [label](url), **bold**, ++underline++,
// ~~strike~~, ==highlight==, *italic* or _italic_, bare links. Marks nest.
const MARK_RE = /`(?<code>[^`\n]+)`|!\[(?<alt>[^\]\n]*)\]\(img:(?<img>[\w-]+)\)|\[(?<lt>[^\]\n]+)\]\((?<lu>https?:\/\/[^\s)]+)\)|\*\*(?=\S)(?<b>.+?)(?<=\S)\*\*|\+\+(?=\S)(?<u>.+?)(?<=\S)\+\+|~~(?=\S)(?<s>.+?)(?<=\S)~~|==(?=\S)(?<hl>.+?)(?<=\S)==|(?<![\p{L}\p{N}*])\*(?=\S)(?<i1>[^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_(?=\S)(?<i2>[^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])|(?<url>https?:\/\/[^\s<>"')\]]+)/gu;

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

/** A stored picture (![alt](img:id)), loaded once and cached. */
function NoteImage({ id, alt }) {
  const [img, setImg] = useState(undefined);
  useEffect(() => {
    let live = true;
    loadImage(id).then((v) => live && setImg(v));
    return () => {
      live = false;
    };
  }, [id]);
  if (img === null) return html`<span class="note-img note-img--missing mono">picture unavailable</span>`;
  if (!img) return html`<span class="note-img note-img--loading" aria-label="Loading picture" />`;
  return html`<img class="note-img" src=${img.data} alt=${alt || ""} width=${img.w} height=${img.h} loading="lazy" decoding="async" />`;
}

function rich(text, clash, q) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    plain(text.slice(last, m.index), clash, q, out);
    const g = m.groups;
    const inner = (s) => rich(s, clash, q);
    if (g.code) out.push(html`<code class="inline-code">${g.code}</code>`);
    else if (g.img) out.push(html`<${NoteImage} id=${g.img} alt=${g.alt} />`);
    else if (g.lu) out.push(html`<a class="note-link" href=${g.lu} target="_blank" rel="noopener noreferrer" onClick=${(e) => e.stopPropagation()}>${inner(g.lt)}</a>`);
    else if (g.b) out.push(html`<strong>${inner(g.b)}</strong>`);
    else if (g.u) out.push(html`<u>${inner(g.u)}</u>`);
    else if (g.s) out.push(html`<s>${inner(g.s)}</s>`);
    else if (g.hl) out.push(html`<mark class="hl">${inner(g.hl)}</mark>`);
    else if (g.i1 || g.i2) out.push(html`<em>${inner(g.i1 || g.i2)}</em>`);
    else out.push(html`<a class="note-link" href=${g.url} target="_blank" rel="noopener noreferrer" onClick=${(e) => e.stopPropagation()}>${g.url.replace(/^https?:\/\//, "")}</a>`);
    last = m.index + m[0].length;
  }
  plain(text.slice(last), clash, q, out);
  return out;
}

/** Render note text with light formatting, pictures, #tags, clashing numbers/dates and filter hits. */
export function NoteText({ text, clash, query }) {
  return html`${rich(text, clash, query?.trim().toLowerCase())}`;
}

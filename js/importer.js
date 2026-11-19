// Turn documents from other tools into Unison's shape: headings become topics and
// subtopics, list items and paragraphs become (nested) notes, and inline bold /
// italic / strikethrough / code carry over as Unison's light Markdown.
// Supports .docx (Word, Google Docs download), .html (Google Docs "Web page", any page),
// pasted rich text, and .md / .txt.
import { parseOutline } from "./weave.js";

const MAX_NOTE = 3800;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Read a File into {title, items}. Items match parseOutline: {kind: "section", text, level} | {kind: "note", text, depth}. */
export async function readImport(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, "");
  let out;
  if (ext === "docx") out = await docxToOutline(await file.arrayBuffer());
  else if (ext === "html" || ext === "htm") out = htmlToOutline(await file.text());
  else if (["md", "markdown", "txt", "text"].includes(ext)) out = textToOutline(await file.text());
  else throw new Error("Unsupported file. Use .docx, .html, .md or .txt.");
  return { title: out.title || base, items: out.items };
}

export function textToOutline(text) {
  return finish(parseOutline(text));
}

// ───────────── Shared clean-up ─────────────

/** Map whatever heading levels a doc used onto topic / subtopic / sub-subtopic, pull out a title, split huge notes. */
function finish(items) {
  items = items.filter((it) => it.text && it.text.trim());
  let title = null;
  const secs = items.filter((it) => it.kind === "section");
  if (items[0]?.kind === "section" && items[0].title) {
    title = items[0].text;
    items = items.slice(1);
  } else if (items[0]?.kind === "section" && secs.length > 1) {
    // A lone top-level heading followed only by deeper headings is the doc's title.
    const first = items[0];
    const rest = secs.slice(1);
    if (rest.every((s) => s.level > first.level)) {
      title = first.text;
      items = items.slice(1);
    }
  }
  const levels = [...new Set(items.filter((it) => it.kind === "section").map((it) => it.level))].sort((a, b) => a - b);
  const rank = new Map(levels.map((l, i) => [l, Math.min(i, 2)]));
  const out = [];
  for (const it of items) {
    if (it.kind === "section") {
      out.push({ kind: "section", text: it.text.replace(/\s+/g, " ").trim().slice(0, 200), level: rank.get(it.level) ?? 0 });
      continue;
    }
    const text = it.text.trim();
    if (text.length <= MAX_NOTE) {
      out.push({ kind: "note", text, depth: Math.min(it.depth || 0, 4) });
      continue;
    }
    // Split very long paragraphs at sentence ends so each fits in a note.
    const parts = text.match(new RegExp(`[\\s\\S]{1,${MAX_NOTE}}(?:[.!?](?=\\s)|$)|[\\s\\S]{1,${MAX_NOTE}}`, "g")) || [text];
    for (const p of parts) if (p.trim()) out.push({ kind: "note", text: p.trim(), depth: Math.min(it.depth || 0, 4) });
  }
  return { title, items: out };
}

const wrapMd = (text, { b, i, s, code }) => {
  if (!text.trim()) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  let core = text.trim();
  if (code) return `${lead}\`${core.replace(/`/g, "'")}\`${trail}`;
  if (s) core = `~~${core}~~`;
  if (i) core = `*${core}*`;
  if (b) core = `**${core}**`;
  return lead + core + trail;
};

/** Join formatted runs, merging neighbours with the same formatting so markers don't stutter. */
function runsToMd(runs) {
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.b === r.b && last.i === r.i && last.s === r.s && last.code === r.code) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged
    .map((r) => wrapMd(r.text, r))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

// ───────────── HTML (Google Docs export, web pages, rich paste) ─────────────

export function htmlToOutline(source) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  // Google Docs' HTML export styles text through classes (.c3{font-weight:700}).
  const classFmt = new Map();
  for (const st of doc.querySelectorAll("style")) {
    for (const m of st.textContent.matchAll(/\.([\w-]+)\{([^}]*)\}/g)) {
      const css = m[2];
      classFmt.set(m[1], {
        b: /font-weight:\s*(bold|[6-9]00)/.test(css),
        i: /font-style:\s*italic/.test(css),
        s: /line-through/.test(css),
      });
    }
  }
  doc.querySelectorAll("script, style, noscript, template, head, svg").forEach((n) => n.remove());

  const fmtOf = (el, inherited) => {
    const f = { ...inherited };
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") f.b = true;
    if (tag === "I" || tag === "EM") f.i = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") f.s = true;
    if (tag === "CODE" || tag === "KBD" || tag === "SAMP") f.code = true;
    for (const c of el.classList || []) {
      const cf = classFmt.get(c);
      if (cf) {
        if (cf.b) f.b = true;
        if (cf.i) f.i = true;
        if (cf.s) f.s = true;
      }
    }
    const st = el.style;
    if (st) {
      const fw = st.fontWeight;
      if (fw === "bold" || +fw >= 600) f.b = true;
      else if (fw === "normal" || (fw && +fw < 600)) f.b = false;
      if (st.fontStyle === "italic") f.i = true;
      else if (st.fontStyle === "normal") f.i = false;
      if (/line-through/.test(st.textDecoration || st.textDecorationLine || "")) f.s = true;
    }
    return f;
  };

  const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|DL|DT|DD|FIGURE|FIGCAPTION|HR)$/;

  /** Inline content of a block as Markdown, skipping nested blocks (handled separately). */
  const inline = (el, fmt) => {
    const runs = [];
    const walk = (node, f) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) runs.push({ text: n.nodeValue.replace(/\s+/g, " "), ...f });
        else if (n.nodeType === 1) {
          if (BLOCK.test(n.tagName)) continue;
          if (n.tagName === "BR") runs.push({ text: "\n", ...f });
          else if (n.tagName === "A") {
            const href = n.getAttribute("href") || "";
            const text = n.textContent.replace(/\s+/g, " ");
            const real = href.replace(/^https?:\/\/www\.google\.com\/url\?q=([^&]+).*$/, (_, u) => decodeURIComponent(u));
            runs.push({ text: /^https?:/.test(real) && !text.includes(real.replace(/^https?:\/\//, "").slice(0, 12)) ? `${text} (${real})` : text, ...fmtOf(n, f) });
          } else walk(n, fmtOf(n, f));
        }
      }
    };
    walk(el, fmt);
    return runsToMd(runs).trim();
  };

  const items = [];
  const listDepth = (li) => {
    let d = 0;
    for (let p = li.parentElement; p; p = p.parentElement) if (p.tagName === "LI") d++;
    // Google Docs flattens nesting into classes like lst-kix_abc-2.
    const m = /lst-kix_[\w]+-(\d+)/.exec(li.parentElement?.className || "");
    return m ? Math.max(d, +m[1]) : d;
  };

  const visit = (el, fmt) => {
    for (const n of el.children) {
      const tag = n.tagName;
      const f = fmtOf(n, fmt);
      if (/^H[1-6]$/.test(tag)) {
        const text = n.textContent.replace(/\s+/g, " ").trim();
        if (text) items.push({ kind: "section", text, level: +tag[1] - 1 });
      } else if (n.classList.contains("title")) {
        const text = n.textContent.replace(/\s+/g, " ").trim();
        if (text) items.push({ kind: "section", text, level: -1, title: true });
      } else if (tag === "LI") {
        const text = inline(n, f);
        if (text) items.push({ kind: "note", text, depth: listDepth(n) });
        visit(n, f);
      } else if (tag === "UL" || tag === "OL" || tag === "TABLE" || tag === "TBODY" || tag === "THEAD" || tag === "TR" || /^(SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|FIGURE|DL)$/.test(tag)) {
        visit(n, f);
      } else if (tag === "HR") {
        continue;
      } else if (/^(P|BLOCKQUOTE|PRE|TD|TH|DT|DD|FIGCAPTION)$/.test(tag) || (tag === "DIV" && ![...n.children].some((c) => BLOCK.test(c.tagName)))) {
        const text = tag === "PRE" ? "`" + n.textContent.trim() + "`" : inline(n, f);
        if (text) items.push({ kind: "note", text, depth: 0 });
        if (tag !== "PRE") for (const c of n.children) if (BLOCK.test(c.tagName)) visit({ children: [c] }, f);
      } else visit(n, f);
    }
  };
  visit(doc.body, {});
  return finish(items);
}

// ───────────── DOCX (Word, Google Docs → Download → .docx) ─────────────

/** Read one file out of a zip using the browser's DecompressionStream. */
async function unzip(buf, wanted) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file isn't a valid .docx.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, size);
    if (method === 0) out[name] = dec.decode(data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out[name] = await new Response(stream).text();
    }
  }
  return out;
}

export async function docxToOutline(buf) {
  const files = await unzip(buf, ["word/document.xml", "word/styles.xml"]);
  if (!files["word/document.xml"]) throw new Error("Couldn't find the text in that .docx.");
  return docxXmlToOutline(files["word/document.xml"], files["word/styles.xml"]);
}

export function docxXmlToOutline(documentXml, stylesXml) {
  const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
  const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute("w:" + name);
  const kid = (el, name) => (el ? [...el.childNodes].find((n) => n.localName === name) : null);
  const on = (el) => el && !/^(0|false|none)$/.test(attr(el, "val") || "");

  // styleId → {heading level | "title"}; Word localizes ids, names stay English ("heading 1").
  const styles = new Map();
  if (stylesXml) {
    for (const st of parse(stylesXml).getElementsByTagNameNS(W, "style")) {
      const id = attr(st, "styleId");
      const name = (attr(kid(st, "name"), "val") || "").toLowerCase();
      const outline = attr(kid(kid(st, "pPr"), "outlineLvl"), "val");
      const m = /^heading (\d)$/.exec(name);
      if (name === "title") styles.set(id, "title");
      else if (m) styles.set(id, +m[1] - 1);
      else if (outline != null && +outline < 9) styles.set(id, +outline);
    }
  }
  const styleLevel = (id) => {
    if (styles.has(id)) return styles.get(id);
    if (/^title$/i.test(id || "")) return "title";
    const m = /^heading(\d)$/i.exec(id || "");
    return m ? +m[1] - 1 : null;
  };

  const items = [];
  const body = parse(documentXml).getElementsByTagNameNS(W, "body")[0];
  if (!body) return { title: null, items: [] };
  for (const p of body.getElementsByTagNameNS(W, "p")) {
    const pPr = kid(p, "pPr");
    const runs = [];
    for (const r of p.getElementsByTagNameNS(W, "r")) {
      const rPr = kid(r, "rPr");
      const f = { b: on(kid(rPr, "b")), i: on(kid(rPr, "i")), s: on(kid(rPr, "strike")) || on(kid(rPr, "dstrike")), code: false };
      for (const n of r.childNodes) {
        if (n.localName === "t") runs.push({ text: n.textContent, ...f });
        else if (n.localName === "tab") runs.push({ text: " ", ...f });
        else if (n.localName === "br" || n.localName === "cr") runs.push({ text: "\n", ...f });
      }
    }
    const text = runsToMd(runs).trim();
    if (!text) continue;
    const level = styleLevel(attr(kid(pPr, "pStyle"), "val")) ?? (kid(pPr, "outlineLvl") ? +attr(kid(pPr, "outlineLvl"), "val") : null);
    const plain = text.replace(/[*~`]/g, "");
    if (level === "title") items.push({ kind: "section", text: plain, level: -1, title: true });
    else if (level != null && level < 9) items.push({ kind: "section", text: plain, level });
    else {
      const numPr = kid(pPr, "numPr");
      const ilvl = numPr ? +(attr(kid(numPr, "ilvl"), "val") || 0) : 0;
      items.push({ kind: "note", text, depth: numPr ? ilvl : 0 });
    }
  }
  return finish(items);
}

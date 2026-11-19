// Export to Word (.docx), which Google Docs, Word and Pages all open. The doc is
// written from HTML (the woven doc via weaveToHtml, or the Edit-mode final copy), so
// both exports share one converter: headings, nested bullet and numbered lists, bold,
// italic, underline, strikethrough, highlight, colours, sizes, fonts, links, sub/
// superscript, alignment and pictures. Each tab starts on a new page.

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Unison's page fonts as fonts people actually have installed.
const WORD_FONTS = { sans: "Arial", serif: "Cambria", times: "Times New Roman", georgia: "Georgia", humanist: "Calibri", arial: "Arial", mono: "Consolas" };
const HEADING = { H1: "Title", H2: "Heading1", H3: "Heading2", H4: "Heading3", H5: "Heading4", H6: "Heading4" };
const CONTENT_W = 6.5 * 914400; // 8.5in page, 1in margins, in EMU
const EMU_PER_PX = 9525;

const esc = (s) =>
  String(s)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ───────────── Colours and sizes from CSS ─────────────

let colorCtx = null;
/** Any CSS colour → "RRGGBB", or null when transparent/unreadable. */
function hex(css) {
  if (!css) return null;
  colorCtx ??= document.createElement("canvas").getContext("2d");
  colorCtx.fillStyle = "#000001";
  colorCtx.fillStyle = css;
  const v = colorCtx.fillStyle;
  if (v === "#000001" && !/^#0{5}1$/i.test(css)) return null;
  if (v.startsWith("#")) return v.slice(1).toUpperCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(v);
  if (!m || (m[4] !== undefined && +m[4] < 0.2)) return null;
  return [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** CSS font-size → half-points. */
function halfPoints(css) {
  const m = /^([\d.]+)(px|pt|em|rem)?$/.exec((css || "").trim());
  if (!m) return null;
  const n = +m[1];
  const pt = m[2] === "pt" ? n : m[2] === "em" || m[2] === "rem" ? n * 11.25 : n * 0.75;
  return Math.max(2, Math.round(pt * 2));
}
function fontName(css) {
  const first = (css || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  return first && !/^(ui-|system-ui|sans-serif|serif|monospace)/.test(first) ? first : null;
}

// ───────────── Zip (deflate via the browser's CompressionStream) ─────────────

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());

/** files: [{name, data: Uint8Array | string, store?}] → zip Blob. */
async function zip(files, type) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const raw = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const name = enc.encode(f.name);
    const method = f.store ? 0 : 8;
    const body = method ? await deflate(raw) : raw;
    const crc = crc32(raw);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);
    head.setUint16(8, method, true);
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type });
}

// ───────────── Pictures ─────────────

const dataUrlBytes = (url) => {
  const [head, b64] = url.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: /data:([^;]+)/.exec(head)?.[1] || "", bytes };
};

/** Word reads PNG, JPEG and GIF; anything else (our WebP) is re-encoded as JPEG. */
async function wordImage(img) {
  const { mime, bytes } = dataUrlBytes(img.data);
  if (mime === "image/png") return { ext: "png", bytes };
  if (mime === "image/jpeg") return { ext: "jpeg", bytes };
  if (mime === "image/gif") return { ext: "gif", bytes };
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  return { ext: "jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) };
}

// ───────────── HTML → WordprocessingML ─────────────

const BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|HR|TABLE|SECTION|ARTICLE|HEADER|FOOTER|FIGURE)$/;

/**
 * Build a .docx Blob from HTML. `style`: {font, size (px), spacing}. `loadImage(id)`
 * resolves a stored picture ({data, w, h}) for <img data-img>.
 */
export async function htmlToDocx(html, { title = "Notes", author = "", style = {}, loadImage = async () => null } = {}) {
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const rels = []; // {id, type, target, external?}
  const media = []; // {name, bytes}
  const relId = () => `rId${rels.length + 10}`;
  const linkIds = new Map();
  const linkRel = (url) => {
    if (!linkIds.has(url)) {
      const id = relId();
      rels.push({ id, type: `${REL}/hyperlink`, target: url, external: true });
      linkIds.set(url, id);
    }
    return linkIds.get(url);
  };
  // Pictures: fetch, convert and size them up front (in document order).
  const pictures = new Map();
  for (const el of dom.querySelectorAll("img[data-img]")) {
    const id = el.getAttribute("data-img");
    if (pictures.has(id)) continue;
    pictures.set(id, null);
    try {
      const img = await loadImage(id);
      if (!img?.data) continue;
      const { ext, bytes } = await wordImage(img);
      const name = `image${media.length + 1}.${ext}`;
      media.push({ name, bytes });
      const rid = relId();
      rels.push({ id: rid, type: `${REL}/image`, target: `media/${name}` });
      let cx = Math.round((img.w || 600) * EMU_PER_PX);
      let cy = Math.round((img.h || 400) * EMU_PER_PX);
      if (cx > CONTENT_W) [cx, cy] = [CONTENT_W, Math.round((cy * CONTENT_W) / cx)];
      pictures.set(id, { rid, cx, cy, name });
    } catch {
      // unreadable picture: left out
    }
  }

  let drawingId = 0;
  const nums = []; // extra numbering instances for numbered lists: [{id, level}]
  const body = [];

  // ── runs ──
  const runXml = (r) => {
    if (r.pic) {
      const p = pictures.get(r.pic);
      if (!p) return "";
      const n = ++drawingId;
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${p.cx}" cy="${p.cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${esc(r.alt || "")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS.pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${p.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${p.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.cx}" cy="${p.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }
    const f = r.f;
    const pr = [];
    if (f.link) pr.push(`<w:rStyle w:val="Hyperlink"/>`);
    const font = f.code ? "Consolas" : f.font;
    if (font) pr.push(`<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:cs="${esc(font)}"/>`);
    if (f.b) pr.push("<w:b/><w:bCs/>");
    if (f.i) pr.push("<w:i/><w:iCs/>");
    if (f.s) pr.push("<w:strike/>");
    if (f.color) pr.push(`<w:color w:val="${f.color}"/>`);
    if (f.sz) pr.push(`<w:sz w:val="${f.sz}"/><w:szCs w:val="${f.sz}"/>`);
    if (f.mark) pr.push(`<w:highlight w:val="yellow"/>`);
    if (f.u) pr.push(`<w:u w:val="single"/>`);
    if (f.bg) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${f.bg}"/>`);
    else if (f.code) pr.push(`<w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/>`);
    if (f.sub || f.sup) pr.push(`<w:vertAlign w:val="${f.sup ? "superscript" : "subscript"}"/>`);
    const rPr = pr.length ? `<w:rPr>${pr.join("")}</w:rPr>` : "";
    if (r.br) return `<w:r>${rPr}<w:br/></w:r>`;
    return `<w:r>${rPr}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
  };
  const runsXml = (runs) => {
    let out = "";
    for (let i = 0; i < runs.length; ) {
      const link = runs[i].f?.link;
      if (!link) {
        out += runXml(runs[i++]);
        continue;
      }
      let inner = "";
      while (i < runs.length && runs[i].f?.link === link) inner += runXml(runs[i++]);
      out += `<w:hyperlink r:id="${linkRel(link)}" w:history="1">${inner}</w:hyperlink>`;
    }
    return out;
  };

  const fmtOf = (el, f) => {
    f = { ...f };
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") f.b = true;
    if (tag === "I" || tag === "EM") f.i = true;
    if (tag === "U" || tag === "INS") f.u = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") f.s = true;
    if (tag === "MARK") f.mark = true;
    if (tag === "CODE" || tag === "KBD" || tag === "SAMP") f.code = true;
    if (tag === "SUB") f.sub = true;
    if (tag === "SUP") f.sup = true;
    if (tag === "A") {
      const href = el.getAttribute("href") || "";
      if (/^(https?:|mailto:)/i.test(href)) f.link = href;
    }
    const st = el.style;
    if (st) {
      const fw = st.fontWeight;
      if (fw) f.b = fw === "bold" || +fw >= 600;
      if (st.fontStyle) f.i = st.fontStyle === "italic";
      const deco = `${st.textDecorationLine || ""} ${st.textDecoration || ""}`;
      if (/underline/.test(deco)) f.u = true;
      if (/line-through/.test(deco)) f.s = true;
      if (st.color) f.color = hex(st.color) || f.color;
      if (st.backgroundColor) {
        const bg = hex(st.backgroundColor);
        if (bg && bg !== "FFFFFF") f.bg = bg;
      }
      if (st.fontSize) f.sz = halfPoints(st.fontSize) || f.sz;
      if (st.fontFamily) f.font = fontName(st.fontFamily) || f.font;
    }
    return f;
  };

  /** Inline content of `el` as runs; nested blocks are reported through `onBlock`. */
  const inline = (el, f, runs, onBlock) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) {
        const text = n.nodeValue.replace(/\s+/g, " ");
        if (text) runs.push({ text, f });
      } else if (n.nodeType === 1) {
        if (n.tagName === "BR") runs.push({ br: true, f });
        else if (n.tagName === "IMG") {
          const id = n.getAttribute("data-img");
          if (id && pictures.get(id)) runs.push({ pic: id, alt: n.getAttribute("alt") || "" });
        } else if (BLOCK.test(n.tagName)) onBlock(n, f);
        else inline(n, fmtOf(n, f), runs, onBlock);
      }
    }
    return runs;
  };
  const trim = (runs) => {
    while (runs[0]?.text !== undefined && !runs[0].text.trim()) runs.shift();
    while (runs.length && runs[runs.length - 1].text !== undefined && !runs[runs.length - 1].text.trim()) runs.pop();
    if (runs[0]?.text) runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, "") };
    const last = runs[runs.length - 1];
    if (last?.text) runs[runs.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
    return runs;
  };
  const align = (el) => ({ center: "center", right: "right", justify: "both", left: "left", start: "left", end: "right" })[el?.style?.textAlign] || null;

  const para = (runs, { style = null, num = null, jc = null, pageBreak = false, keep = false, border = false, ind = null } = {}) => {
    const pPr = [];
    if (style) pPr.push(`<w:pStyle w:val="${style}"/>`);
    if (keep) pPr.push("<w:keepNext/>");
    if (pageBreak) pPr.push("<w:pageBreakBefore/>");
    if (num) pPr.push(`<w:numPr><w:ilvl w:val="${num.level}"/><w:numId w:val="${num.id}"/></w:numPr>`);
    if (border) pPr.push(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>`);
    if (ind) pPr.push(`<w:ind w:left="${ind}"/>`);
    if (jc) pPr.push(`<w:jc w:val="${jc}"/>`);
    body.push(`<w:p>${pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : ""}${runsXml(runs)}</w:p>`);
  };

  let firstHeading = true;
  const blocks = (container, f, list = null) => {
    let pending = [];
    const flush = (opts = {}) => {
      const runs = trim(pending);
      pending = [];
      if (runs.length) para(runs, opts);
    };
    for (const n of container.childNodes) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !BLOCK.test(n.tagName))) {
        if (n.nodeType === 3) {
          const text = n.nodeValue.replace(/\s+/g, " ");
          if (text.trim() || pending.length) pending.push({ text, f });
        } else if (n.tagName === "BR") pending.push({ br: true, f });
        else if (n.tagName === "IMG") inline({ childNodes: [n] }, f, pending, () => {});
        else inline(n, fmtOf(n, f), pending, (b, bf) => (flush(), blocks({ childNodes: [b] }, bf, list)));
        continue;
      }
      flush();
      const tag = n.tagName;
      const nf = fmtOf(n, f);
      if (HEADING[tag]) {
        const isTab = n.classList.contains("tab-title");
        para(trim(inline(n, nf, [], () => {})), { style: HEADING[tag], keep: true, jc: align(n), pageBreak: isTab && !firstHeading });
        if (tag !== "H1") firstHeading = false;
      } else if (tag === "UL" || tag === "OL") {
        const level = list ? Math.min(list.level + 1, 8) : 0;
        let id = 1;
        if (tag === "OL") {
          id = nums.length + 3;
          nums.push({ id, level });
        }
        for (const li of n.children) if (li.tagName === "LI") listItem(li, nf, { id, level });
      } else if (tag === "LI") listItem(n, nf, list || { id: 1, level: 0 });
      else if (tag === "HR") para([], { border: true });
      else if (tag === "PRE") {
        for (const line of n.textContent.replace(/\n$/, "").split("\n")) para([{ text: line || " ", f: { ...nf, code: true } }]);
      } else if (tag === "BLOCKQUOTE") {
        const runs = trim(inline(n, nf, [], (b, bf) => blocks({ childNodes: [b] }, bf, list)));
        if (runs.length) para(runs, { style: "Quote", jc: align(n) });
      } else if (tag === "TABLE") {
        for (const tr of n.querySelectorAll("tr")) {
          const cells = [...tr.children].map((c) => trim(inline(c, fmtOf(c, nf), [], () => {})));
          const runs = [];
          cells.forEach((c, i) => {
            if (i) runs.push({ text: " | ", f: nf });
            runs.push(...c);
          });
          if (runs.length) para(runs);
        }
      } else {
        // P, DIV and other containers: a paragraph, or nested blocks.
        const hasBlocks = [...n.children].some((c) => BLOCK.test(c.tagName));
        if (hasBlocks) blocks(n, nf, list);
        else {
          const runs = trim(inline(n, nf, [], () => {}));
          if (runs.length || tag === "P") para(runs, { style: n.classList.contains("doc-byline") ? "Subtitle" : null, jc: align(n) });
        }
      }
    }
    flush();
  };
  const listItem = (li, f, num) => {
    const runs = [];
    const nested = [];
    inline(li, f, runs, (b, bf) => {
      if (b.tagName === "UL" || b.tagName === "OL") nested.push([b, bf]);
      else {
        // A paragraph inside a list item continues it on a new line.
        if (runs.length) runs.push({ br: true, f });
        inline(b, fmtOf(b, bf), runs, (bb, bbf) => nested.push([bb, bbf]));
      }
    });
    const clean = trim(runs);
    if (clean.length) para(clean, { style: "ListParagraph", num, jc: align(li) });
    for (const [b, bf] of nested) blocks({ childNodes: [b] }, bf, num);
  };

  blocks(dom, {});

  // ── parts ──
  const font = WORD_FONTS[style.font] || "Arial";
  const sz = Math.round((style.size || 15) * 1.5); // px → half-points
  const line = Math.round(((style.spacing || 1.5) * 1.1 * 240) / 1.15);
  const hs = (k) => Math.round(sz * k);

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const pStyle = (id, name, { size, bold = true, before = 0, after = 120, outline = null, color = null, italic = false, next = "Normal", basedOn = "Normal", keep = true, ind = null } = {}) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:next w:val="${next}"/><w:qFormat/><w:pPr>${keep ? "<w:keepNext/>" : ""}<w:spacing w:before="${before}" w:after="${after}"/>${ind ? `<w:ind w:left="${ind}"/>` : ""}${outline != null ? `<w:outlineLvl w:val="${outline}"/>` : ""}</w:pPr><w:rPr>${bold ? "<w:b/><w:bCs/>" : ""}${italic ? "<w:i/><w:iCs/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""}</w:rPr></w:style>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS.w}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${pStyle("Title", "Title", { size: hs(2.2), after: 80, next: "Normal" })}
${pStyle("Subtitle", "Subtitle", { size: sz, bold: false, color: "666666", after: 240, keep: false })}
${pStyle("Heading1", "heading 1", { size: hs(1.6), before: 360, after: 120, outline: 0 })}
${pStyle("Heading2", "heading 2", { size: hs(1.33), before: 280, after: 100, outline: 1 })}
${pStyle("Heading3", "heading 3", { size: hs(1.15), before: 220, after: 80, outline: 2 })}
${pStyle("Heading4", "heading 4", { size: sz, before: 200, after: 60, outline: 3 })}
${pStyle("Quote", "Quote", { bold: false, italic: true, color: "555555", ind: 720, keep: false })}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1155CC"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

  const BULLETS = ["●", "○", "■"];
  const lvl = (i, kind) => {
    const ind = `<w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr>`;
    if (kind === "bullet") return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLETS[i % 3]}"/><w:lvlJc w:val="left"/>${ind}<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${Math.max(12, Math.round(sz * 0.7))}"/></w:rPr></w:lvl>`;
    const fmt = ["decimal", "lowerLetter", "lowerRoman"][i % 3];
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/>${ind}</w:lvl>`;
  };
  const levels = (kind) => Array.from({ length: 9 }, (_, i) => lvl(i, kind)).join("");
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${NS.w}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels("decimal")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${nums
    .map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`)
    .join("")}</w:numbering>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>${rels
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`)
    .join("")}</Relationships>`;

  const iso = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`;

  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  return zip(
    [
      { name: "[Content_Types].xml", data: types },
      { name: "_rels/.rels", data: pkgRels },
      { name: "docProps/core.xml", data: core },
      { name: "word/document.xml", data: docXml },
      { name: "word/styles.xml", data: styles },
      { name: "word/numbering.xml", data: numbering },
      { name: "word/_rels/document.xml.rels", data: docRels },
      ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.bytes, store: true })),
    ],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
}

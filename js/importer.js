// Turn documents from other tools into Unison's shape. Formatting is read the way a
// person reads it (see inferOutline in weave.js): real headings, big text, page/section
// breaks and short labels right before lists become topics; lists become nested notes.
// Inline bold / italic / underline / strikethrough / highlight / links / sub- and
// superscript carry over as Unison's light Markdown, and pictures come along as images.
// Supports .docx (Word, Google Docs → Download → .docx), .html, rich paste, .md and .txt.
import { parseOutline, inferOutline } from "./weave.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/**
 * Read a File. Returns {title, items, images: Map<key, Blob>, style?: {font, size}}.
 * Items use ![](img:<key>) for pictures; keys are replaced with stored ids on import.
 */
export async function readImport(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, "");
  let out;
  if (ext === "docx") out = await docxToOutline(await file.arrayBuffer());
  else if (ext === "html" || ext === "htm") out = htmlToOutline(await file.text());
  else if (["md", "markdown", "txt", "text"].includes(ext)) out = textToOutline(await file.text());
  else throw new Error("Unsupported file. Use .docx, .html, .md or .txt.");
  return { ...out, title: out.title || base };
}

export function textToOutline(text) {
  const items = parseOutline(text);
  let title = null;
  if (items[0]?.kind === "section" && items.filter((i) => i.kind === "section" && i.level === items[0].level).length === 1 && items.length > 1) {
    title = items.shift().text;
  }
  return { title, items, images: new Map() };
}

// ───────────── Runs → Markdown ─────────────

const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" };
const script = (text, map) => ([...text].every((c) => map[c] || c === " ") ? [...text].map((c) => map[c] || c).join("") : null);

const SAME = ["b", "i", "u", "s", "hl", "code", "link"];
const wrapMd = (r) => {
  let text = r.text;
  if (!text.trim()) return text;
  const lead = text.match(/^\s*/)[0];
  const trail = text.match(/\s*$/)[0];
  let core = text.trim();
  if (r.code) core = "`" + core.replace(/`/g, "'") + "`";
  else {
    if (r.s) core = `~~${core}~~`;
    if (r.u && !r.link) core = `++${core}++`;
    if (r.hl) core = `==${core}==`;
    if (r.i) core = `*${core}*`;
    if (r.b) core = `**${core}**`;
  }
  if (r.link) core = core === r.link ? r.link : `[${core}](${r.link})`;
  return lead + core + trail;
};

/** Join formatted runs into Markdown, merging neighbours with identical formatting. */
function runsToMd(runs) {
  const merged = [];
  for (const r of runs) {
    if (r.img) {
      merged.push({ ...r });
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && !last.img && SAME.every((k) => (last[k] || null) === (r[k] || null))) last.text += r.text;
    else merged.push({ ...r });
  }
  return merged
    .map((r) => (r.img ? ` ![](img:${r.img}) ` : wrapMd(r)))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const FONT_IDS = [
  [/times/i, "times"],
  [/georgia/i, "georgia"],
  [/calibri|carlito|segoe|ubuntu/i, "humanist"],
  [/arial|helvetica|roboto|open sans|liberation sans/i, "arial"],
  [/mono|courier|consol/i, "mono"],
  [/serif|garamond|cambria|charter|cardo|caudex|merriweather|lora|baskerville|book/i, "serif"],
];
const fontId = (name) => FONT_IDS.find(([re]) => re.test(name || ""))?.[1] || "sans";

// ───────────── DOCX ─────────────

/** Read selected entries out of a zip with the browser's DecompressionStream. */
async function unzip(buf, want) {
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
  const dec = new TextDecoder();
  const out = {};
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
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, size);
    out[name] =
      method === 0
        ? data.slice()
        : new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  }
  return out;
}

export async function docxToOutline(buf) {
  const files = await unzip(buf, (n) => n === "word/document.xml" || n === "word/styles.xml" || n === "word/_rels/document.xml.rels" || n.startsWith("word/media/"));
  if (!files["word/document.xml"]) throw new Error("Couldn't find the text in that .docx.");
  const dec = new TextDecoder();
  const media = new Map(Object.entries(files).filter(([n]) => n.startsWith("word/media/")));
  return docxXmlToOutline(
    dec.decode(files["word/document.xml"]),
    files["word/styles.xml"] && dec.decode(files["word/styles.xml"]),
    files["word/_rels/document.xml.rels"] && dec.decode(files["word/_rels/document.xml.rels"]),
    media,
  );
}

export function docxXmlToOutline(documentXml, stylesXml, relsXml, media = new Map()) {
  const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
  const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute("w:" + name) ?? null;
  const kid = (el, name) => (el ? [...el.children].find((n) => n.localName === name) : null);
  const on = (el) => !!el && !/^(0|false|none)$/i.test(attr(el, "val") || "");

  // Relationships: hyperlinks and pictures.
  const rels = new Map();
  if (relsXml) for (const r of parse(relsXml).getElementsByTagName("Relationship")) rels.set(r.getAttribute("Id"), r.getAttribute("Target"));

  // styleId → heading level / title, plus style-level run defaults (size, bold).
  const styles = new Map();
  // The doc's default font and size (Word keeps them here rather than on every run).
  const defaults = { font: null, size: null };
  if (stylesXml) {
    const sx = parse(stylesXml);
    const normal = [...sx.getElementsByTagNameNS(W, "style")].find((st) => attr(st, "type") === "paragraph" && attr(st, "default") === "1");
    for (const r of [kid(normal, "rPr"), kid(sx.getElementsByTagNameNS(W, "rPrDefault")[0], "rPr")]) {
      const f = kid(r, "rFonts");
      defaults.font ??= f?.getAttributeNS(W, "ascii") || f?.getAttribute("w:ascii") || null;
      const sz = attr(kid(r, "sz"), "val");
      if (sz && !defaults.size) defaults.size = +sz / 2;
    }
    for (const st of sx.getElementsByTagNameNS(W, "style")) {
      const id = attr(st, "styleId");
      const name = (attr(kid(st, "name"), "val") || "").toLowerCase();
      const outline = attr(kid(kid(st, "pPr"), "outlineLvl"), "val");
      const m = /^heading (\d)$/.exec(name);
      styles.set(id, { title: name === "title", heading: m ? +m[1] : outline != null && +outline < 9 ? +outline + 1 : null, subtitle: name === "subtitle" });
    }
  }
  const styleOf = (id) => {
    if (styles.has(id)) return styles.get(id);
    const m = /^heading(\d)$/i.exec(id || "");
    return { title: /^title$/i.test(id || ""), heading: m ? +m[1] : null };
  };

  const images = new Map();
  let imgN = 0;
  const addImage = (rid) => {
    const target = rels.get(rid);
    const bytes = target && media.get("word/" + target.replace(/^\.?\//, "").replace(/^word\//, ""));
    if (!bytes) return null;
    const ext = target.split(".").pop().toLowerCase();
    if (!/^(png|jpe?g|gif|webp|bmp)$/.test(ext)) return null;
    const key = `imp${imgN++}`;
    images.set(key, new Blob([bytes], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }));
    return key;
  };

  const fontWeight = new Map();
  const blocks = [];
  let nextSectionStart = false;
  // Google Docs exports each document tab as a section that restarts page numbering.
  const tabbed = (documentXml.match(/<w:pgNumType[^>]*w:start=/g) || []).length >= 2;
  let pendingTab = tabbed;

  const runsOf = (p) => {
    const runs = [];
    let pageBreak = false;
    const walk = (node, link) => {
      for (const n of node.children) {
        const name = n.localName;
        if (name === "hyperlink") {
          const url = rels.get(n.getAttributeNS(R, "id") || n.getAttribute("r:id"));
          walk(n, url && /^(https?:|mailto:)/i.test(url) ? url : link);
        } else if (name === "r") {
          const rPr = kid(n, "rPr");
          const hl = kid(rPr, "highlight");
          const shd = attr(kid(rPr, "shd"), "fill");
          const va = attr(kid(rPr, "vertAlign"), "val");
          const u = kid(rPr, "u");
          const f = {
            b: on(kid(rPr, "b")),
            i: on(kid(rPr, "i")),
            u: !!u && !/^none$/i.test(attr(u, "val") || ""),
            s: on(kid(rPr, "strike")) || on(kid(rPr, "dstrike")),
            hl: (!!hl && !/^none$/i.test(attr(hl, "val") || "")) || (!!shd && !/^(auto|ffffff|FFFFFF)$/.test(shd)),
            code: false,
            link,
            size: +(attr(kid(rPr, "sz"), "val") || 0) / 2 || null,
          };
          const font = kid(rPr, "rFonts")?.getAttributeNS(W, "ascii") || kid(rPr, "rFonts")?.getAttribute("w:ascii");
          for (const c of n.children) {
            if (c.localName === "t") {
              let text = c.textContent;
              if (va === "superscript") text = script(text, SUP) ?? `^${text}`;
              else if (va === "subscript") text = script(text, SUB) ?? text;
              runs.push({ text, ...f });
              if (font) fontWeight.set(font, (fontWeight.get(font) || 0) + text.length);
            } else if (c.localName === "tab") runs.push({ text: " ", ...f });
            else if (c.localName === "br" || c.localName === "cr") {
              if (attr(c, "type") === "page") pageBreak = true;
              else runs.push({ text: "\n", ...f });
            } else if (c.localName === "noBreakHyphen") runs.push({ text: "-", ...f });
            else if (c.localName === "drawing" || c.localName === "pict" || c.localName === "object") {
              for (const blip of c.getElementsByTagNameNS(A, "blip")) {
                const key = addImage(blip.getAttributeNS(R, "embed") || blip.getAttribute("r:embed"));
                if (key) runs.push({ text: "", img: key });
              }
              for (const im of c.getElementsByTagName("v:imagedata")) {
                const key = addImage(im.getAttributeNS(R, "id") || im.getAttribute("r:id"));
                if (key) runs.push({ text: "", img: key });
              }
            }
          }
        } else if (name === "ins" || name === "smartTag" || name === "customXml" || name === "fldSimple" || name === "sdt" || name === "sdtContent") walk(n, link);
      }
    };
    walk(p, null);
    return { runs, pageBreak };
  };

  const paragraph = (p, cellDepth = null) => {
    const pPr = kid(p, "pPr");
    const st = styleOf(attr(kid(pPr, "pStyle"), "val"));
    const numPr = kid(pPr, "numPr");
    const outline = attr(kid(pPr, "outlineLvl"), "val");
    const { runs, pageBreak } = runsOf(p);
    const textRuns = runs.filter((r) => !r.img);
    const chars = textRuns.reduce((n, r) => n + r.text.trim().length, 0);
    const sizes = new Map();
    for (const r of textRuns) if (r.size && r.text.trim()) sizes.set(r.size, (sizes.get(r.size) || 0) + r.text.length);
    const size = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const bold = chars > 0 && textRuns.filter((r) => r.b).reduce((n, r) => n + r.text.trim().length, 0) >= chars * 0.9;
    const imgs = runs.filter((r) => r.img).map((r) => r.img);
    const sectionStart = nextSectionStart || !!kid(pPr, "pageBreakBefore");
    if (chars || imgs.length) {
      nextSectionStart = false;
      if (pendingTab) {
        blocks.push({ type: "tab" });
        pendingTab = false;
      }
    }
    const sectPr = kid(pPr, "sectPr");
    if (sectPr || pageBreak) nextSectionStart = true;
    if (sectPr && tabbed) pendingTab = true;

    const isList = !!numPr || cellDepth != null;
    const depth = cellDepth ?? (numPr ? +(attr(kid(numPr, "ilvl"), "val") || 0) : 0);
    const heading = st.heading ?? (outline != null && +outline < 9 ? +outline + 1 : null);
    if (isList) {
      // Pictures inside a bullet stay in that bullet.
      const text = runsToMd(runs);
      if (text) blocks.push({ type: "li", text, depth, size, bold });
      return;
    }
    const text = runsToMd(textRuns);
    if (text) blocks.push({ type: "p", text, size, bold, heading, title: st.title, sectionStart });
    for (const key of imgs) blocks.push({ type: "img", text: `![](img:${key})` });
  };

  const body = parse(documentXml).getElementsByTagNameNS(W, "body")[0];
  if (!body) return { title: null, items: [], images };
  const visit = (el) => {
    for (const n of el.children) {
      if (n.localName === "p") paragraph(n);
      else if (n.localName === "tbl") {
        // Tables: one note per row ("a | b | c"); the first row in bold.
        [...n.getElementsByTagNameNS(W, "tr")].forEach((tr, i) => {
          const cells = [...tr.children]
            .filter((c) => c.localName === "tc")
            .map((tc) =>
              [...tc.getElementsByTagNameNS(W, "p")]
                .map((p) => runsToMd(runsOf(p).runs))
                .filter(Boolean)
                .join(" / "),
            );
          if (!cells.some((c) => c.trim())) return;
          if (pendingTab) {
            blocks.push({ type: "tab" });
            pendingTab = false;
          }
          while (cells.length > 1 && !cells[cells.length - 1].trim()) cells.pop();
          const head = (c) => (!c || c.startsWith("*") ? c : `**${c}**`);
          blocks.push({ type: "li", text: i === 0 ? cells.map(head).join(" | ") : cells.join(" | "), depth: i === 0 ? 0 : 1 });
        });
      } else if (n.localName === "sdt") visit(kid(n, "sdtContent") || n);
    }
  };
  visit(body);

  const out = inferOutline(blocks);
  const font = [...fontWeight].sort((a, b) => b[1] - a[1])[0]?.[0] || defaults.font;
  const sizeWeight = new Map();
  for (const b of blocks) if (b.size && b.type !== "img") sizeWeight.set(b.size, (sizeWeight.get(b.size) || 0) + b.text.length);
  const pt = [...sizeWeight].sort((a, b) => b[1] - a[1])[0]?.[0] || defaults.size;
  return {
    ...out,
    images,
    style: { font: font ? fontId(font) : undefined, size: pt ? Math.max(10, Math.min(28, Math.round((pt * 4) / 3))) : undefined },
  };
}

// ───────────── Google Docs (Docs API JSON, with tabs) ─────────────

const rgbIsBlank = (c) => {
  const rgb = c?.color?.rgbColor;
  if (!rgb) return true;
  return (rgb.red ?? 0) > 0.97 && (rgb.green ?? 0) > 0.97 && (rgb.blue ?? 0) > 0.97;
};

/**
 * A document from the Google Docs API (documents.get with includeTabsContent=true).
 * Tabs keep their real names and nesting. Returns {title, items, imageUris: Map<key,
 * url>, style}; pictures are fetched separately (their URLs are short-lived).
 */
export function gdocToOutline(json) {
  const blocks = [];
  const imageUris = new Map();
  const fontWeight = new Map();
  let imgN = 0;
  let nextSectionStart = false;
  let normal = null; // the first tab's Normal text style: the doc's font and size

  const tabList = json.tabs?.length ? json.tabs : [{ tabProperties: { title: json.title }, documentTab: { body: json.body, inlineObjects: json.inlineObjects, positionedObjects: json.positionedObjects, namedStyles: json.namedStyles } }];
  const countTabs = (tabs) => tabs.reduce((n, t) => n + 1 + countTabs(t.childTabs || []), 0);
  const showTabs = countTabs(tabList) > 1;

  const doTab = (tab, depth) => {
    const dt = tab.documentTab || {};
    const named = new Map((dt.namedStyles?.styles || []).map((s) => [s.namedStyleType, s.textStyle || {}]));
    normal ??= named.get("NORMAL_TEXT") || null;
    const image = (obj) => {
      const uri = obj?.embeddedObject?.imageProperties?.contentUri;
      if (!uri) return null;
      const key = `imp${imgN++}`;
      imageUris.set(key, uri);
      return key;
    };

    const runsOf = (para) => {
      const base = { ...(named.get("NORMAL_TEXT") || {}), ...(named.get(para.paragraphStyle?.namedStyleType) || {}) };
      const runs = [];
      let pageBreak = false;
      for (const el of para.elements || []) {
        if (el.textRun) {
          const ts = { ...base, ...(el.textRun.textStyle || {}) };
          const link = ts.link?.url && /^(https?:|mailto:)/i.test(ts.link.url) ? ts.link.url : null;
          let text = el.textRun.content.replace(/\u000b/g, "\n").replace(/\n$/, "");
          if (ts.baselineOffset === "SUPERSCRIPT") text = script(text, SUP) ?? `^${text}`;
          else if (ts.baselineOffset === "SUBSCRIPT") text = script(text, SUB) ?? text;
          const font = ts.weightedFontFamily?.fontFamily;
          if (font && text.trim()) fontWeight.set(font, (fontWeight.get(font) || 0) + text.length);
          runs.push({
            text,
            b: !!ts.bold || (ts.weightedFontFamily?.weight ?? 400) >= 600,
            i: !!ts.italic,
            u: !!ts.underline && !link,
            s: !!ts.strikethrough,
            hl: !rgbIsBlank(ts.backgroundColor),
            code: false,
            link,
            size: ts.fontSize?.magnitude || null,
          });
        } else if (el.inlineObjectElement) {
          const key = image(dt.inlineObjects?.[el.inlineObjectElement.inlineObjectId]?.inlineObjectProperties);
          if (key) runs.push({ text: "", img: key });
        } else if (el.richLink) {
          const p = el.richLink.richLinkProperties || {};
          runs.push({ text: p.title || p.uri || "", link: p.uri || null });
        } else if (el.person) {
          runs.push({ text: el.person.personProperties?.name || el.person.personProperties?.email || "" });
        } else if (el.pageBreak) pageBreak = true;
      }
      for (const id of para.positionedObjectIds || []) {
        const key = image(dt.positionedObjects?.[id]?.positionedObjectProperties);
        if (key) runs.push({ text: "", img: key });
      }
      return { runs, pageBreak };
    };

    const measure = (runs) => {
      const textRuns = runs.filter((r) => !r.img);
      const chars = textRuns.reduce((n, r) => n + r.text.trim().length, 0);
      const sizes = new Map();
      for (const r of textRuns) if (r.size && r.text.trim()) sizes.set(r.size, (sizes.get(r.size) || 0) + r.text.length);
      return {
        textRuns,
        chars,
        size: [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        bold: chars > 0 && textRuns.filter((r) => r.b).reduce((n, r) => n + r.text.trim().length, 0) >= chars * 0.9,
      };
    };

    const content = (elements) => {
      for (const se of elements || []) {
        if (se.sectionBreak) nextSectionStart = true;
        else if (se.table) {
          (se.table.tableRows || []).forEach((row, i) => {
            const cells = (row.tableCells || []).map((cell) =>
              (cell.content || [])
                .filter((x) => x.paragraph)
                .map((x) => runsToMd(runsOf(x.paragraph).runs))
                .filter(Boolean)
                .join(" / "),
            );
            while (cells.length > 1 && !cells[cells.length - 1].trim()) cells.pop();
            if (!cells.some((c) => c.trim())) return;
            const head = (c) => (!c || c.startsWith("*") ? c : `**${c}**`);
            blocks.push({ type: "li", text: i === 0 ? cells.map(head).join(" | ") : cells.join(" | "), depth: i === 0 ? 0 : 1 });
          });
        } else if (se.paragraph) {
          const para = se.paragraph;
          const { runs, pageBreak } = runsOf(para);
          const { textRuns, chars, size, bold } = measure(runs);
          const imgs = runs.filter((r) => r.img).map((r) => r.img);
          const sectionStart = nextSectionStart;
          if (chars || imgs.length) nextSectionStart = false;
          if (pageBreak) nextSectionStart = true;
          const style = para.paragraphStyle?.namedStyleType || "NORMAL_TEXT";
          const h = /^HEADING_(\d)$/.exec(style);
          if (para.bullet) {
            const text = runsToMd(runs);
            if (text) blocks.push({ type: "li", text, depth: para.bullet.nestingLevel || 0, size, bold });
            continue;
          }
          const text = runsToMd(textRuns);
          if (text) blocks.push({ type: "p", text, size, bold, heading: h ? +h[1] : null, title: style === "TITLE", sectionStart });
          for (const key of imgs) blocks.push({ type: "img", text: `![](img:${key})` });
        }
      }
    };

    if (showTabs) blocks.push({ type: "tab", title: tab.tabProperties?.title || "Untitled tab", depth });
    nextSectionStart = true;
    content(dt.body?.content);
    for (const child of tab.childTabs || []) doTab(child, depth + 1);
  };
  for (const t of tabList) doTab(t, 0);

  const out = inferOutline(blocks);
  const font = normal?.weightedFontFamily?.fontFamily || [...fontWeight].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pt = normal?.fontSize?.magnitude;
  return {
    title: json.title || out.title,
    items: out.items,
    imageUris,
    style: { font: font ? fontId(font) : undefined, size: pt ? Math.max(10, Math.min(28, Math.round((pt * 4) / 3))) : undefined },
  };
}

// ───────────── HTML (Google Docs "Web page", any page, rich paste) ─────────────

export function htmlToOutline(source) {
  const doc = new DOMParser().parseFromString(source, "text/html");
  // Google Docs' HTML export styles text through classes (.c3{font-weight:700}).
  const classCss = new Map();
  for (const st of doc.querySelectorAll("style")) for (const m of st.textContent.matchAll(/\.([\w-]+)\{([^}]*)\}/g)) classCss.set(m[1], m[2]);
  doc.querySelectorAll("script, style, noscript, template, head, svg").forEach((n) => n.remove());

  const images = new Map();
  let imgN = 0;
  const addImage = (src) => {
    const m = /^data:(image\/[\w+.-]+);base64,(.*)$/s.exec(src || "");
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const key = `imp${imgN++}`;
    images.set(key, new Blob([bytes], { type: m[1] }));
    return key;
  };

  const cssOf = (el) => (el.getAttribute?.("style") || "") + ";" + [...(el.classList || [])].map((c) => classCss.get(c) || "").join(";");
  const fmtOf = (el, f) => {
    f = { ...f };
    const tag = el.tagName;
    const css = cssOf(el);
    if (tag === "B" || tag === "STRONG") f.b = true;
    if (tag === "I" || tag === "EM") f.i = true;
    if (tag === "U" || tag === "INS") f.u = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") f.s = true;
    if (tag === "MARK") f.hl = true;
    if (tag === "CODE" || tag === "KBD" || tag === "SAMP") f.code = true;
    const fw = /font-weight:\s*(\w+)/.exec(css)?.[1];
    if (fw) f.b = fw === "bold" || +fw >= 600;
    const fs = /font-style:\s*(\w+)/.exec(css)?.[1];
    if (fs) f.i = fs === "italic";
    if (/text-decoration[^;]*underline/.test(css)) f.u = true;
    if (/text-decoration[^;]*line-through/.test(css)) f.s = true;
    const bg = /background-color:\s*([^;]+)/.exec(css)?.[1]?.trim();
    if (bg && !/^(transparent|#fff(fff)?|white|rgba?\(\s*255,\s*255,\s*255)/i.test(bg)) f.hl = true;
    const size = /font-size:\s*([\d.]+)(pt|px)/.exec(css);
    if (size) f.size = size[2] === "px" ? +size[1] * 0.75 : +size[1];
    return f;
  };

  const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TABLE|THEAD|TBODY|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|NAV|DL|DT|DD|FIGURE|FIGCAPTION|HR)$/;
  const inline = (el, f0) => {
    const runs = [];
    const walk = (node, f) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) runs.push({ text: n.nodeValue.replace(/\s+/g, " "), ...f });
        else if (n.nodeType === 1 && !BLOCK.test(n.tagName)) {
          if (n.tagName === "BR") runs.push({ text: "\n", ...f });
          else if (n.tagName === "IMG") {
            const key = addImage(n.getAttribute("src"));
            if (key) runs.push({ text: "", img: key });
          } else if (n.tagName === "SUP" || n.tagName === "SUB") {
            const t = n.textContent;
            runs.push({ text: script(t, n.tagName === "SUP" ? SUP : SUB) ?? t, ...f });
          } else if (n.tagName === "A") {
            const href = (n.getAttribute("href") || "").replace(/^https?:\/\/www\.google\.com\/url\?q=([^&]+).*$/, (_, u) => decodeURIComponent(u));
            walk(n, { ...fmtOf(n, f), u: false, link: /^(https?:|mailto:)/.test(href) ? href : f.link });
          } else walk(n, fmtOf(n, f));
        }
      }
    };
    walk(el, f0);
    const textRuns = runs.filter((r) => !r.img);
    const chars = textRuns.reduce((n, r) => n + r.text.trim().length, 0);
    const sizes = new Map();
    for (const r of textRuns) if (r.size && r.text.trim()) sizes.set(r.size, (sizes.get(r.size) || 0) + r.text.length);
    return {
      runs,
      size: [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0] || f0.size || null,
      bold: chars > 0 && textRuns.filter((r) => r.b).reduce((n, r) => n + r.text.trim().length, 0) >= chars * 0.9,
    };
  };

  const blocks = [];
  let sectionStart = false;
  const listDepth = (li) => {
    let d = 0;
    for (let p = li.parentElement; p; p = p.parentElement) if (p.tagName === "LI") d++;
    const m = /lst-kix_[\w]+-(\d+)/.exec(li.parentElement?.className || "");
    return m ? Math.max(d, +m[1]) : d;
  };
  const visit = (el, f) => {
    for (const n of el.children) {
      const tag = n.tagName;
      const nf = fmtOf(n, f);
      if (tag === "HR" || /page-break-(before|after):\s*always/.test(cssOf(n))) sectionStart = true;
      if (/^H[1-6]$/.test(tag) || tag === "P" || n.classList.contains("title") || /^(BLOCKQUOTE|PRE|TD|TH|DT|DD|FIGCAPTION)$/.test(tag) || (tag === "DIV" && ![...n.children].some((c) => BLOCK.test(c.tagName)))) {
        const { runs, size, bold } = inline(n, nf);
        const textRuns = runs.filter((r) => !r.img);
        const text = tag === "PRE" ? "`" + n.textContent.trim() + "`" : runsToMd(textRuns);
        const heading = /^H[1-6]$/.test(tag) ? +tag[1] : null;
        if (text) {
          blocks.push({ type: "p", text, size, bold, heading, title: n.classList.contains("title"), sectionStart });
          sectionStart = false;
        }
        for (const r of runs) if (r.img) blocks.push({ type: "img", text: `![](img:${r.img})` });
        if (tag !== "PRE") for (const c of n.children) if (BLOCK.test(c.tagName)) visit({ children: [c] }, nf);
      } else if (tag === "LI") {
        const { runs, size, bold } = inline(n, nf);
        const text = runsToMd(runs);
        if (text) blocks.push({ type: "li", text, depth: listDepth(n), size, bold });
        visit(n, nf);
      } else if (tag === "IMG") {
        const key = addImage(n.getAttribute("src"));
        if (key) blocks.push({ type: "img", text: `![](img:${key})` });
      } else if (tag !== "HR") visit(n, nf);
    }
  };
  visit(doc.body, {});
  return { ...inferOutline(blocks), images };
}

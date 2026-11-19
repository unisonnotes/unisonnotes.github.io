// Weaving: turns every stream's notes plus the shared spine into one organized doc.
// Pure functions, no DOM and no backend, all in the browser with word matching and
// regex. Run `node --test tests/` to exercise them.

// ───────────── Input parsing ─────────────

const TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

export const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

export function extractTags(text) {
  const tags = new Set();
  for (const m of text.matchAll(TAG_RE)) tags.add(slug(m[2]));
  tags.delete("");
  return [...tags];
}

/**
 * A message that starts with "#" is a heading for everyone: "#Topic" (or "# Topic"),
 * "##Subtopic" under the current topic, "###" one level deeper. Hashtags anywhere
 * else in a note are tags. Everything else is a note.
 */
export function parseInput(raw) {
  const text = raw.trim();
  const heading = /^(#{1,3})\s*([^#\s][^\n]*)$/.exec(text);
  if (heading) return { kind: "section", title: heading[2].trim(), level: heading[1].length - 1 };
  return { kind: "note", text, tags: extractTags(text) };
}

export const tagTitle = (tag) => tag.replace(/[-_]+/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());

/** Lines of a pasted agenda become section titles. Bullets and numbering are dropped. */
export function agendaToSections(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)]|#+)\s*/, "").trim())
    .filter(Boolean);
}

// ───────────── Tokens & similarity ─────────────

const STOP = new Set(
  ("a an the and or but if then than so of to in on at by for from with without into onto over under " +
    "is are was were be been being am do does did done has have had having it its it's this that these those " +
    "there here as not no yes can could should would will just also very really about which who whom whose what " +
    "when where why how all any each every both few more most other some such only own same too i me my we our you your " +
    "he him his she her they them their one get got like happen happens occur occurs take takes place around").split(" "),
);

// Full month names (minus "may", which is mostly a verb) count as date tokens.
const MONTHS = new Set(
  "january february march april june july august september october november december".split(" "),
);

// Light suffix stripping, then truncation to 7 letters so word families line up
// (mitochondria / mitochondrial, conserve / conservation).
function stem(w) {
  if (w.length <= 4) return w;
  if (w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w.slice(0, 7);
}

/** Split a note into meaningful words and number/date tokens. */
export function tokenize(text) {
  const words = new Set();
  const nums = new Set();
  const cleaned = text.toLowerCase().replace(TAG_RE, " ").replace(/[^\p{L}\p{N}$%.,:/'’-]+/gu, " ");
  for (let raw of cleaned.split(/\s+/)) {
    raw = raw.replace(/^[.,:/'’-]+|[.,:/'’-]+$/g, "");
    if (!raw) continue;
    if (/\d/.test(raw)) {
      nums.add(raw.replace(/,(?=\d{3}\b)/g, ""));
    } else if (MONTHS.has(raw)) {
      nums.add(raw);
    } else {
      for (const part of raw.split(/[-/'’]/)) {
        const w = part.replace(/[.,:]/g, "");
        if (w.length >= 2 && !STOP.has(w)) words.add(stem(w));
      }
    }
  }
  return { words, nums };
}

function overlap(a, b) {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Do two notes make the same point, judged on words alone (numbers ignored)? */
export function wordsMatch(ta, tb) {
  const sa = ta.words.size;
  const sb = tb.words.size;
  if (sa + ta.nums.size < 2 || sb + tb.nums.size < 2) return false;
  if (!sa || !sb) return false;
  const inter = overlap(ta.words, tb.words);
  const jaccard = inter / (sa + sb - inter);
  const containment = inter / Math.min(sa, sb);
  return jaccard >= 0.55 || (containment >= 0.8 && Math.min(sa, sb) >= 3);
}

/** Numbers each side has that the other lacks; a conflict needs both sides non-empty. */
export function numberConflict(ta, tb) {
  const onlyA = [...ta.nums].filter((n) => !tb.nums.has(n));
  const onlyB = [...tb.nums].filter((n) => !ta.nums.has(n));
  return onlyA.length && onlyB.length ? { a: onlyA, b: onlyB } : null;
}

// ───────────── Spine helpers ─────────────

export function sortedSections(sections) {
  return Object.entries(sections || {})
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

/**
 * Sections as an outline, depth-first: each topic followed by its subtopics.
 * Adds `depth` (0 = topic), `parentId` (effective; a missing or looping parent makes
 * it a topic) and `number` ("02", "02.1", "02.1.3").
 */
export function orderedSections(sections) {
  const list = sortedSections(sections);
  const parents = parentMap(new Map(list.map((s) => [s.id, s])));
  const kids = new Map();
  const roots = [];
  for (const s of list) {
    const p = parents.get(s.id);
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(s);
    } else roots.push(s);
  }
  const out = [];
  const walk = (s, depth, number) => {
    out.push({ ...s, parentId: parents.get(s.id) || null, depth, number });
    (kids.get(s.id) || []).forEach((k, i) => walk(k, depth + 1, `${number}.${i + 1}`));
  };
  roots.forEach((s, i) => walk(s, 0, String(i + 1).padStart(2, "0")));
  return out;
}

/**
 * The newest section; notes go here unless the writer pins another one. Sections
 * created together (template, agenda) share a timestamp, so the first of that batch wins.
 * Sections spawned from hashtags don't count: they collect tagged notes, not the flow.
 */
export function latestSection(sections) {
  let best = null;
  for (const s of orderedSections(sections)) {
    if (s.tag) continue;
    if (!best || (s.createdAt ?? 0) > (best.createdAt ?? 0)) best = s;
  }
  return best;
}

/** Next `order` among the children of `parentId` (null = topics). */
export const nextOrder = (sections, parentId = null) =>
  orderedSections(sections)
    .filter((s) => s.parentId === parentId)
    .reduce((m, s) => Math.max(m, (s.order ?? 0) + 1), 0);

/**
 * Where a new heading of `level` (0 topic, 1 subtopic, 2 sub-subtopic) goes, given the
 * section the writer is in: under that section's ancestor one level up. Returns the
 * parent id (null = new topic).
 */
export function headingParent(sections, level, currentId) {
  if (level <= 0 || !currentId) return null;
  const ordered = orderedSections(sections);
  const byId = new Map(ordered.map((s) => [s.id, s]));
  let cur = byId.get(currentId);
  if (!cur) return null;
  while (cur.depth > level - 1 && cur.parentId) cur = byId.get(cur.parentId);
  return cur.id;
}

function sectionTagIndex(sections) {
  const index = new Map();
  for (const s of sortedSections(sections)) {
    if (s.tag) index.set(s.tag, s.id);
    const t = slug(s.title || "");
    if (t && !index.has(t)) index.set(t, s.id);
  }
  return index;
}

/** Hashtags used by 2+ different people that don't have a section yet. */
export function tagsNeedingSections(doc) {
  const index = sectionTagIndex(doc.sections);
  const authorsByTag = new Map();
  for (const n of Object.values(doc.notes || {})) {
    for (const t of n.tags || []) {
      if (index.has(t)) continue;
      if (!authorsByTag.has(t)) authorsByTag.set(t, new Set());
      authorsByTag.get(t).add(n.author);
    }
  }
  return [...authorsByTag].filter(([, a]) => a.size >= 2).map(([t]) => t);
}

/** Section a note shows up in: a matching hashtag section wins, then its own pick, else Unsorted (null). */
export function placeNote(note, sections, tagIndex = sectionTagIndex(sections)) {
  for (const t of note.tags || []) if (tagIndex.has(t)) return tagIndex.get(t);
  return note.sectionId && sections?.[note.sectionId] ? note.sectionId : null;
}

// ───────────── Weave ─────────────

function groupDuplicates(notes, merges) {
  const parent = new Map(notes.map((n) => [n.id, n.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (wordsMatch(a.tokens, b.tokens) && !numberConflict(a.tokens, b.tokens)) union(a.id, b.id);
    }
  }
  for (const n of notes) {
    const target = merges[n.id];
    if (target && parent.has(target)) union(n.id, target);
  }

  const groups = new Map();
  for (const n of notes) {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  return [...groups.values()];
}

/** Similar notes anywhere in the doc whose numbers or dates disagree. */
function findConflicts(notes) {
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (!wordsMatch(a.tokens, b.tokens)) continue;
      const clash = numberConflict(a.tokens, b.tokens);
      if (clash) out.push({ noteA: a.id, noteB: b.id, numsA: clash.a, numsB: clash.b });
    }
  }
  return out;
}

/** Deepest sub-point level the composer allows (0 = top-level point). */
export const MAX_DEPTH = 4;

/**
 * Effective parent of each note: its `parentId` when that note exists and following
 * parents upward never loops. Notes whose parent is gone become top-level.
 */
export function parentMap(notesById) {
  const out = new Map();
  for (const [id, n] of notesById) {
    if (!n.parentId || !notesById.has(n.parentId)) continue;
    const seen = new Set([id]);
    let cur = n;
    let loops = false;
    while (cur.parentId && notesById.has(cur.parentId)) {
      if (seen.has(cur.parentId)) {
        loops = true;
        break;
      }
      seen.add(cur.parentId);
      cur = notesById.get(cur.parentId);
    }
    if (!loops) out.set(id, n.parentId);
  }
  return out;
}

/**
 * Weave a doc snapshot into sections of collapsed bullets. Sub-points (notes with a
 * parent) nest under their parent's point and collapse among their siblings.
 * Returns { sections, unsorted, stats, groupOfNote, sectionOfNote }.
 */
export function weave(doc) {
  const sections = orderedSections(doc.sections);
  const tagIndex = sectionTagIndex(doc.sections);
  const merges = doc.merges || {};
  const notes = Object.entries(doc.notes || {})
    .map(([id, n]) => ({ id, ...n, tokens: tokenize(n.text || "") }))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const byId = new Map(notes.map((n) => [n.id, n]));
  const parents = parentMap(byId);
  const childrenOf = new Map();
  for (const n of notes) {
    const p = parents.get(n.id);
    if (!p) continue;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p).push(n);
  }
  const roots = notes.filter((n) => !parents.has(n.id));

  const placed = new Map(roots.map((n) => [n.id, placeNote(n, doc.sections, tagIndex)]));
  // A hand-merged note follows its target into the target's section.
  for (const n of roots) {
    const target = merges[n.id];
    if (target && placed.has(target)) placed.set(n.id, placed.get(target));
  }
  // Sub-points live wherever their top-level ancestor lives.
  const sectionOfNote = new Map();
  const rootOf = (n) => {
    while (parents.has(n.id)) n = byId.get(parents.get(n.id));
    return n;
  };
  for (const n of notes) sectionOfNote.set(n.id, placed.get(rootOf(n).id) ?? null);

  const contributors = new Set(notes.map((n) => n.author));
  const bySection = new Map([[null, []], ...sections.map((s) => [s.id, []])]);
  for (const n of roots) bySection.get(placed.get(n.id)).push(n);

  const groupOfNote = new Map();
  let duplicateCount = 0;
  let pointCount = 0;

  const buildItems = (list, depth) => {
    const items = groupDuplicates(list, merges).map((g) => {
      const rep = g.reduce((best, n) =>
        n.tokens.words.size + n.tokens.nums.size > best.tokens.words.size + best.tokens.nums.size ? n : best,
      );
      const authors = [...new Set(g.map((n) => n.author))];
      return {
        id: g[0].id,
        rep,
        notes: g,
        authors,
        depth,
        createdAt: g[0].createdAt ?? 0,
        solo: depth === 0 && authors.length === 1 && contributors.size >= 2,
        manual: g.some((n) => merges[n.id]),
        conflicts: [],
        clashNums: new Set(),
        children: [],
      };
    });
    for (const item of items) {
      for (const n of item.notes) groupOfNote.set(n.id, item);
      duplicateCount += item.notes.length - 1;
      pointCount++;
      const kids = item.notes.flatMap((n) => childrenOf.get(n.id) || []);
      if (kids.length) item.children = buildItems(kids, depth + 1);
    }
    return items.sort((a, b) => a.createdAt - b.createdAt);
  };

  const woven = sections.map((s) => {
    const items = buildItems(bySection.get(s.id), 0);
    const list = notes.filter((n) => sectionOfNote.get(n.id) === s.id);
    const times = list.map((n) => n.createdAt ?? 0);
    return {
      ...s,
      items,
      noteCount: list.length,
      authors: [...new Set(list.map((n) => n.author))],
      firstAt: times.length ? Math.min(...times) : null,
      lastAt: times.length ? Math.max(...times) : null,
      heat: 0,
    };
  });

  // Gap heatmap: leaf sections well below the average number of distinct top-level
  // points glow. A section with subtopics is judged by its subtopics instead.
  const parentIds = new Set(woven.map((s) => s.parentId).filter(Boolean));
  const leaves = woven.filter((s) => !parentIds.has(s.id));
  const leafPoints = leaves.reduce((sum, s) => sum + s.items.length, 0);
  if (leaves.length >= 2 && leafPoints >= 4) {
    const mean = leafPoints / leaves.length;
    for (const s of leaves) s.heat = Math.max(0, Math.min(1, 1 - s.items.length / (0.6 * mean)));
  }
  const unsorted = buildItems(bySection.get(null), 0);

  const conflicts = findConflicts(notes);
  for (const c of conflicts) {
    const ga = groupOfNote.get(c.noteA);
    const gb = groupOfNote.get(c.noteB);
    ga.conflicts.push({ note: c.noteA, other: c.noteB, otherGroup: gb.id });
    gb.conflicts.push({ note: c.noteB, other: c.noteA, otherGroup: ga.id });
    for (const x of c.numsA) ga.clashNums.add(x);
    for (const x of c.numsB) gb.clashNums.add(x);
  }

  return {
    sections: woven,
    unsorted,
    groupOfNote,
    sectionOfNote,
    stats: {
      notes: notes.length,
      points: pointCount,
      contributors: contributors.size,
      conflicts: conflicts.length,
      duplicates: duplicateCount,
    },
  };
}

/**
 * One person's notes in outline order: each top-level note followed by its own
 * sub-points (depth-first, oldest first). Notes whose parent belongs to someone else
 * start a new branch and keep `foreignParent` so the UI can say what they hang under.
 */
export function streamOutline(mine, allNotesById) {
  const ids = new Set(mine.map((n) => n.id));
  const parents = parentMap(allNotesById);
  const kids = new Map();
  const roots = [];
  for (const n of mine) {
    const p = parents.get(n.id);
    if (p && ids.has(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  }
  const byTime = (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0);
  const out = [];
  const walk = (n, depth) => {
    const p = parents.get(n.id);
    out.push({ note: n, depth, foreignParent: depth === 0 && p ? p : null });
    for (const k of (kids.get(n.id) || []).sort(byTime)) walk(k, depth + 1);
  };
  for (const r of roots.sort(byTime)) walk(r, 0);
  return out;
}

/**
 * Split pasted text into an outline: [{kind: "note"|"section", text, depth}].
 * Indentation (tabs or 2 spaces) and list markers set depth; "# " lines are topics.
 */
export function parseOutline(raw) {
  const out = [];
  const indents = [];
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const lead = /^[\t ]*/.exec(line)[0];
    const width = [...lead].reduce((w, c) => w + (c === "\t" ? 4 : 1), 0);
    let body = line.slice(lead.length);
    const heading = /^(#{1,6})\s*([^#\s].*)$/.exec(body);
    if (heading) {
      out.push({ kind: "section", text: heading[2].trim(), level: Math.min(heading[1].length - 1, 2) });
      indents.length = 0;
      continue;
    }
    body = body.replace(/^(?:[-*+•–◦▪]|\d+[.)]|[a-z][.)])\s+/i, "").trim();
    if (!body) continue;
    while (indents.length && width <= indents[indents.length - 1]) indents.pop();
    const depth = Math.min(indents.length, MAX_DEPTH);
    indents.push(width);
    out.push({ kind: "note", text: body, depth });
  }
  return out;
}

// ───────────── Export ─────────────

const fmtDate = (ms) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function toMarkdown(doc, woven, nameOf) {
  const out = [];
  const counts = new Map();
  for (const n of Object.values(doc.notes || {})) counts.set(n.author, (counts.get(n.author) || 0) + 1);
  out.push(`# ${doc.meta.title}`, "");
  out.push(`_Woven by Unison Notes · ${fmtDate(Date.now())}_`, "");
  if (counts.size) {
    const credits = [...counts].sort((a, b) => b[1] - a[1]).map(([uid, c]) => `${nameOf(uid)} (${c})`);
    out.push(`**Contributors:** ${credits.join(", ")}`, "");
  }
  const bullet = (item, depth = 0) => {
    const pad = "  ".repeat(depth);
    const names = item.authors.map(nameOf).join(", ");
    const marks = [];
    if (item.authors.length > 1) marks.push(`×${item.authors.length}`);
    if (item.solo) marks.push("solo");
    let line = `${pad}- ${item.rep.text.replace(/\n+/g, " ")} — _${names}_${marks.length ? ` (${marks.join(", ")})` : ""}`;
    if (item.conflicts.length) {
      const others = item.conflicts.map((c) => `"${findText(doc, c.other)}"`).join("; ");
      line += `\n${pad}  - ⚠ Conflicts with ${others}`;
    }
    for (const child of item.children) line += "\n" + bullet(child, depth + 1);
    return line;
  };
  for (const s of woven.sections) {
    const when = s.firstAt ? ` · ${fmtTime(s.firstAt)}` : "";
    out.push(`${"#".repeat(Math.min(2 + (s.depth || 0), 6))} ${s.title}`, "");
    if (s.firstAt) out.push(`<sub>${s.noteCount} notes${when}</sub>`, "");
    if (!s.items.length && !woven.sections.some((x) => x.parentId === s.id)) out.push("_No notes._");
    for (const item of s.items) out.push(bullet(item));
    out.push("");
  }
  if (woven.unsorted.length) {
    out.push("## Unsorted", "");
    for (const item of woven.unsorted) out.push(bullet(item));
    out.push("");
  }
  return out.join("\n");
}

const findText = (doc, noteId) => (doc.notes?.[noteId]?.text || "").replace(/\n+/g, " ");

// ───────────── HTML (the editable doc) ─────────────

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Note text with light Markdown (**b**, *i*, _i_, ~~s~~, ==mark==, `code`, links) as safe HTML. */
export function inlineHtml(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<s>$1</s>")
    .replace(/==(?=\S)(.+?)(?<=\S)==/g, "<mark>$1</mark>")
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, "$1<em>$2</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>")
    .replace(/https?:\/\/[^\s<>"')\]]+/g, (url) => `<a href="${url}">${url.replace(/^https?:\/\//, "")}</a>`)
    .replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

/** The woven doc as plain document HTML: title, topic headings, nested bullet lists. */
export function weaveToHtml(doc, woven, nameOf) {
  const counts = new Map();
  for (const n of Object.values(doc.notes || {})) counts.set(n.author, (counts.get(n.author) || 0) + 1);
  const names = [...counts].sort((a, b) => b[1] - a[1]).map(([uid]) => escapeHtml(nameOf(uid)));
  const list = (items) =>
    items.length ? `<ul>${items.map((it) => `<li>${inlineHtml(it.rep.text)}${list(it.children)}</li>`).join("")}</ul>` : "";
  const out = [`<h1>${escapeHtml(doc.meta.title)}</h1>`];
  if (names.length) out.push(`<p class="doc-byline">Notes by ${names.join(", ")}</p>`);
  for (const s of woven.sections) {
    const h = `h${Math.min(2 + (s.depth || 0), 4)}`;
    out.push(`<${h}>${escapeHtml(s.title)}</${h}>`, list(s.items));
  }
  if (woven.unsorted.length) out.push("<h2>Other notes</h2>", list(woven.unsorted));
  return out.filter(Boolean).join("\n");
}

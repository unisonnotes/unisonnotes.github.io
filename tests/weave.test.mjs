import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInput,
  agendaToSections,
  tagsNeedingSections,
  weave,
  latestSection,
  toMarkdown,
  parseOutline,
  streamOutline,
  inlineHtml,
  weaveToHtml,
  inferOutline,
  planOutline,
  orderedSections,
  headingParent,
  nextOrder,
} from "../js/weave.js";

const doc = (sections, notes, merges = {}) => ({ meta: { title: "T" }, sections, notes, merges });
const note = (author, text, sectionId, createdAt, tags) => ({
  author,
  text,
  sectionId,
  createdAt,
  tags: tags || parseInput(text).tags,
});

test("parseInput: a leading # makes a topic (## subtopic), #tags elsewhere are tags", () => {
  assert.deepEqual(parseInput("# Photosynthesis"), { kind: "section", title: "Photosynthesis", level: 0 });
  assert.deepEqual(parseInput("#Mitochondria"), { kind: "section", title: "Mitochondria", level: 0 });
  assert.deepEqual(parseInput("##cristae"), { kind: "section", title: "cristae", level: 1 });
  assert.deepEqual(parseInput("### Folds"), { kind: "section", title: "Folds", level: 2 });
  const n = parseInput("Light reactions make ATP #Photo-synthesis #atp");
  assert.equal(n.kind, "note");
  assert.deepEqual(n.tags, ["photo-synthesis", "atp"]);
  assert.equal(parseInput("#").kind, "note");
  assert.equal(parseInput("#### too deep").kind, "note");
});

test("subtopics nest under the topic you're in", () => {
  const sections = {
    a: { title: "Cells", order: 0, createdAt: 1 },
    b: { title: "Mito", order: 1, createdAt: 2 },
    b1: { title: "Cristae", order: 0, createdAt: 3, parentId: "b" },
    b1a: { title: "Folds", order: 0, createdAt: 4, parentId: "b1" },
    gone: { title: "Orphan", order: 2, createdAt: 5, parentId: "deleted" },
  };
  const ordered = orderedSections(sections);
  assert.deepEqual(ordered.map((s) => [s.id, s.depth, s.number]), [
    ["a", 0, "01"],
    ["b", 0, "02"],
    ["b1", 1, "02.1"],
    ["b1a", 2, "02.1.1"],
    ["gone", 0, "03"],
  ]);
  assert.equal(headingParent(sections, 1, "b"), "b", "## inside a topic nests under it");
  assert.equal(headingParent(sections, 1, "b1a"), "b", "## inside a sub-subtopic nests under the topic");
  assert.equal(headingParent(sections, 2, "b1"), "b1");
  assert.equal(headingParent(sections, 0, "b1"), null);
  assert.equal(nextOrder(sections, "b"), 1);
  assert.equal(nextOrder(sections), 3);
  assert.equal(latestSection(sections).id, "gone");
});

test("agenda paste strips bullets and numbering", () => {
  assert.deepEqual(agendaToSections("1. Intro\n- Budget\n\n  • Q&A \n## Wrap up"), [
    "Intro",
    "Budget",
    "Q&A",
    "Wrap up",
  ]);
});

test("paraphrased duplicates collapse with ×N authors; solo points are marked", () => {
  const w = weave(
    doc({ s1: { title: "Cells", order: 0, createdAt: 1 } }, {
      a: note("u1", "Mitochondria is the powerhouse of the cell", "s1", 10),
      b: note("u2", "the mitochondria: powerhouse of cells!", "s1", 11),
      c: note("u3", "Mitochondria = powerhouse of the cell", "s1", 12),
      d: note("u2", "Ribosomes build proteins from amino acids", "s1", 13),
    }),
  );
  const items = w.sections[0].items;
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].authors, ["u1", "u2", "u3"]);
  assert.equal(items[0].solo, false);
  assert.equal(items[1].solo, true);
  assert.equal(w.stats.duplicates, 2);
});

test("similar notes with different numbers are flagged as conflicts, not merged", () => {
  const w = weave(
    doc({ s1: { title: "WW2", order: 0, createdAt: 1 } }, {
      a: note("u1", "World War 2 ended in 1945", "s1", 10),
      b: note("u2", "WW2 ended in 1946 according to the world war timeline", "s1", 11),
      c: note("u3", "World War 2 ended in 1945.", "s1", 12),
    }),
  );
  const items = w.sections[0].items;
  assert.equal(items.length, 2, "1945 notes merge, 1946 note stays separate");
  assert.equal(w.stats.conflicts >= 1, true);
  const flagged = items.filter((i) => i.conflicts.length);
  assert.equal(flagged.length, 2);
  assert.ok(items.find((i) => i.clashNums.has("1946")));
});

test("a note that only lacks the number still merges with the detailed one", () => {
  const w = weave(
    doc({ s1: { title: "x", order: 0, createdAt: 1 } }, {
      a: note("u1", "Midterm exam moved to Friday 3pm in room 204", "s1", 10),
      b: note("u2", "midterm exam moved to friday", "s1", 11),
    }),
  );
  assert.equal(w.sections[0].items.length, 1);
  assert.equal(w.sections[0].items[0].rep.id, "a", "most detailed note represents the group");
});

test("hashtag used by two people becomes a section and pulls tagged notes in", () => {
  const notes = {
    a: note("u1", "Chlorophyll absorbs red and blue #pigments", "s1", 10),
    b: note("u2", "Carotenoids are accessory #pigments", "s1", 11),
    c: note("u1", "Only I use #rare", "s1", 12),
  };
  const d = doc({ s1: { title: "Intro", order: 0, createdAt: 1 } }, notes);
  assert.deepEqual(tagsNeedingSections(d), ["pigments"]);
  d.sections.tag_pigments = { title: "Pigments", tag: "pigments", order: 1, createdAt: 20 };
  assert.deepEqual(tagsNeedingSections(d), []);
  const w = weave(d);
  assert.equal(w.sections[1].noteCount, 2);
  assert.equal(w.sections[0].noteCount, 1);
});

test("notes without a live section land in Unsorted; manual merge pulls them into the target", () => {
  const notes = {
    a: note("u1", "Photosynthesis happens in chloroplasts", "s1", 10),
    b: note("u2", "Plants cook sugar inside green organelles", "gone", 11),
  };
  let w = weave(doc({ s1: { title: "x", order: 0, createdAt: 1 } }, notes));
  assert.equal(w.unsorted.length, 1);
  w = weave(doc({ s1: { title: "x", order: 0, createdAt: 1 } }, notes, { b: "a" }));
  assert.equal(w.unsorted.length, 0);
  assert.equal(w.sections[0].items.length, 1);
  assert.deepEqual(w.sections[0].items[0].authors, ["u1", "u2"]);
});

test("gap heatmap glows for sparse sections only", () => {
  const notes = {};
  for (let i = 0; i < 6; i++) notes["n" + i] = note("u1", `distinct point number ${"abcdef"[i]}x unique${i}word`, "s1", i);
  const w = weave(
    doc(
      {
        s1: { title: "Busy", order: 0, createdAt: 1 },
        s2: { title: "Empty", order: 1, createdAt: 2 },
      },
      notes,
    ),
  );
  assert.equal(w.sections[0].heat, 0);
  assert.equal(w.sections[1].heat, 1);
});

test("latest section is the most recently created", () => {
  const s = latestSection({ a: { order: 0, createdAt: 5 }, b: { order: 1, createdAt: 9 }, c: { order: 2, createdAt: 7 } });
  assert.equal(s.id, "b");
  const batch = latestSection({ a: { order: 0, createdAt: 5 }, b: { order: 1, createdAt: 5 }, c: { order: 2, createdAt: 5 } });
  assert.equal(batch.id, "a", "a template/agenda batch starts at its first section");
});

test("hashtag sections never become the default target", () => {
  const s = latestSection({ a: { order: 0, createdAt: 5 }, t_mito: { order: 1, createdAt: 9, tag: "mito" } });
  assert.equal(s.id, "a");
});

test("word families match and conflicts are found across sections", () => {
  const w = weave(
    doc(
      { s1: { title: "Krebs", order: 0, createdAt: 1 }, s2: { title: "Other", order: 1, createdAt: 2 } },
      {
        a: note("u1", "Krebs cycle runs in the mitochondrial matrix", "s1", 10),
        b: note("u2", "Krebs cycle happens in the matrix of the mitochondria", "s1", 11),
        c: note("u1", "Each turn of the Krebs cycle releases 2 CO2", "s1", 12),
        d: note("u2", "Every turn of the Krebs cycle releases 3 CO2", "s2", 13),
      },
    ),
  );
  assert.deepEqual(w.sections[0].items[0].authors, ["u1", "u2"]);
  assert.equal(w.stats.conflicts, 1);
  assert.ok(w.sections[1].items[0].clashNums.has("3"));
});

test("sub-points nest under their point, follow its section and collapse among siblings", () => {
  const notes = {
    p1: note("u1", "Photosynthesis has two stages", "s1", 10),
    p2: note("u2", "photosynthesis happens in two stages", "s1", 11),
    c1: { ...note("u1", "Light reactions happen in the thylakoid", "s1", 12), parentId: "p1" },
    c2: { ...note("u2", "light reactions occur in the thylakoids", "gone", 13), parentId: "p2" },
    c3: { ...note("u2", "Calvin cycle in the stroma", "s1", 14), parentId: "p2" },
    g1: { ...note("u1", "uses ATP from light reactions", "s1", 15), parentId: "c1" },
    orphan: { ...note("u1", "parent was deleted", "s1", 16), parentId: "missing" },
    loopA: { ...note("u1", "loop a", "s1", 17), parentId: "loopB" },
    loopB: { ...note("u1", "loop b", "s1", 18), parentId: "loopA" },
  };
  const w = weave(doc({ s1: { title: "Plants", order: 0, createdAt: 1 } }, notes));
  const items = w.sections[0].items;
  const top = items[0];
  assert.deepEqual(top.authors, ["u1", "u2"], "the two parents merge");
  assert.equal(top.children.length, 2, "duplicate sub-points under the merged point collapse");
  assert.deepEqual(top.children[0].authors, ["u1", "u2"]);
  assert.equal(top.children[0].children[0].rep.id, "g1", "grandchildren keep nesting");
  assert.equal(w.sectionOfNote.get("c2"), "s1", "sub-points follow their ancestor's section");
  assert.ok(items.some((i) => i.id === "orphan"), "orphans become top-level");
  assert.ok(items.some((i) => i.id === "loopA") && items.some((i) => i.id === "loopB"), "cycles don't vanish");
  assert.equal(top.children[0].solo, false);
  const md = toMarkdown(doc({ s1: { title: "Plants", order: 0, createdAt: 1 } }, notes), w, (u) => u);
  assert.match(md, /\n  - Light reactions/);
  assert.match(md, /\n    - uses ATP/);
});

test("pasted outlines keep their structure", () => {
  const out = parseOutline("# Cells\n- Mitochondria\n  - makes ATP\n    - via ETC\n  - has DNA\n- Ribosomes\n\n1. Numbered\n\tTabbed child");
  assert.deepEqual(
    out.map((o) => [o.kind, o.text, o.kind === "section" ? o.level : o.depth]),
    [
      ["section", "Cells", 0],
      ["note", "Mitochondria", 0],
      ["note", "makes ATP", 1],
      ["note", "via ETC", 2],
      ["note", "has DNA", 1],
      ["note", "Ribosomes", 0],
      ["note", "Numbered", 0],
      ["note", "Tabbed child", 1],
    ],
  );
});

test("a stream lists sub-points right after their parent", () => {
  const all = new Map(
    Object.entries({
      a: { author: "me", createdAt: 1 },
      b: { author: "me", createdAt: 2 },
      a1: { author: "me", createdAt: 3, parentId: "a" },
      x: { author: "them", createdAt: 0 },
      x1: { author: "me", createdAt: 4, parentId: "x" },
    }),
  );
  const mine = ["a", "b", "a1", "x1"].map((id) => ({ id, ...all.get(id) }));
  const out = streamOutline(mine, all);
  assert.deepEqual(out.map((o) => [o.note.id, o.depth, o.foreignParent]), [
    ["a", 0, null],
    ["a1", 1, null],
    ["b", 0, null],
    ["x1", 0, "x"],
  ]);
});

test("markdown export credits writers and marks conflicts", () => {
  const d = doc({ s1: { title: "Dates", order: 0, createdAt: 1 } }, {
    a: note("u1", "Treaty signed in 1648", "s1", 10),
    b: note("u2", "The treaty was signed in 1658", "s1", 11),
  });
  const md = toMarkdown(d, weave(d), (uid) => ({ u1: "Ana", u2: "Ben" })[uid]);
  assert.match(md, /^# T/);
  assert.match(md, /\*\*Contributors:\*\* Ana \(1\), Ben \(1\)/);
  assert.match(md, /## Dates/);
  assert.match(md, /⚠ Conflicts with/);
});

test("inline Markdown becomes safe HTML", () => {
  assert.equal(
    inlineHtml("**ATP** is *key*, ~~old~~ ==new== `x<y` <script> see https://a.com/b?c=1&d=2"),
    '<strong>ATP</strong> is <em>key</em>, <s>old</s> <mark>new</mark> <code>x&lt;y</code> &lt;script&gt; see <a href="https://a.com/b?c=1&amp;d=2">a.com/b?c=1&amp;d=2</a>',
  );
});

test("weave HTML keeps headings by depth and nested lists", () => {
  const d = doc(
    { a: { title: "Cells", order: 0, createdAt: 1 }, b: { title: "Cristae", order: 0, createdAt: 2, parentId: "a" } },
    {
      p: note("u1", "Mitochondria make **ATP**", "a", 10),
      c: { ...note("u1", "via the ETC", "a", 11), parentId: "p" },
      s: note("u2", "Folds", "b", 12),
    },
  );
  const html = weaveToHtml(d, weave(d), (u) => ({ u1: "Ana", u2: "Ben" })[u]);
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /Notes by Ana, Ben/);
  assert.match(html, /<h2>Cells<\/h2>\n<ul><li>Mitochondria make <strong>ATP<\/strong><ul><li>via the ETC<\/li><\/ul><\/li><\/ul>/);
  assert.match(html, /<h3>Cristae<\/h3>/);
});

test("inferring structure from a mostly-unstyled doc", () => {
  const p = (text, extra = {}) => ({ type: "p", text, size: 13, ...extra });
  const li = (text, depth = 0) => ({ type: "li", text, depth, size: 13 });
  const { title, items } = inferOutline([
    p("BIO NOTES", { size: 70 }),
    p("-By Taj"),
    p("The Brain", { size: 50, sectionStart: true }),
    p("Nervous System", { title: true, sectionStart: true }),
    p("Neurons"),
    li("Receive and transmit signals"),
    li("Cell body", 1),
    p("28.15: The human brain", { heading: 1 }),
    p("Cortex"),
    { type: "img", text: "![](img:a)" },
    li("Folded"),
    p("This is a long ordinary sentence that just explains something in prose form."),
    p("Evolution", { sectionStart: true }),
    p("Charles Darwin"),
    li("Natural selection"),
  ]);
  assert.equal(title, "BIO NOTES");
  const secs = items.filter((i) => i.kind === "section").map((i) => [i.text, i.rank]);
  assert.deepEqual(secs, [
    ["The Brain", 10],
    ["Nervous System", 10],
    ["Neurons", 40],
    ["28.15: The human brain", 21],
    ["Cortex", 40],
    ["Evolution", 10],
    ["Charles Darwin", 40],
  ]);
  const plan = planOutline(items);
  const at = (text) => plan.find((i) => i.text === text);
  assert.equal(at("Nervous System").parent, null, "parts are top-level topics");
  assert.equal(plan[at("Neurons").parent].text, "Nervous System");
  assert.equal(plan[at("Cortex").parent].text, "28.15: The human brain");
  assert.equal(at("Cortex").depth, 2);
  assert.equal(plan[at("Cell body").noteParent].text, "Receive and transmit signals");
  assert.equal(plan[at("![](img:a)").section].text, "Cortex");
  assert.equal(at("This is a long ordinary sentence that just explains something in prose form.").kind, "note");
  assert.equal(plan[at("Charles Darwin").parent].text, "Evolution");
});

test("planOutline never nests topics deeper than three levels", () => {
  const plan = planOutline([
    { kind: "section", text: "a", rank: 1 },
    { kind: "section", text: "b", rank: 2 },
    { kind: "section", text: "c", rank: 3 },
    { kind: "section", text: "d", rank: 4 },
    { kind: "note", text: "n", depth: 3 },
  ]);
  assert.deepEqual(plan.map((i) => i.depth), [0, 1, 2, 2, 0]);
  assert.equal(plan[3].parent, 1);
});

test("inline HTML handles images, labelled links and underline", () => {
  assert.equal(
    inlineHtml("++under++ ![chart](img:abc) [Video](https://x.com/v)"),
    '<u>under</u> <img data-img="abc" alt="chart"> <a href="https://x.com/v">Video</a>',
  );
});

test("tabs from an imported doc: named, empty ones dropped, loose notes get a topic", () => {
  const p = (text, extra = {}) => ({ type: "p", text, size: 13, ...extra });
  const li = (text) => ({ type: "li", text, depth: 0, size: 13 });
  const tab = { type: "tab" };
  const { title, items } = inferOutline([
    tab, p("BIO NOTES", { size: 70 }), p("-By Taj"),
    tab, p("The Brain", { size: 50, sectionStart: true }),
    tab, p("Nervous system", { sectionStart: true }), p("Neurons"), li("Fire"),
    tab, p("Watch the following video to learn about the parts of the microscope and how to use it", { sectionStart: true }), li("Part 1"),
  ]);
  assert.equal(title, "BIO NOTES");
  assert.deepEqual(items.filter((i) => i.kind === "tab").map((i) => i.text), ["Cover", "Nervous system", "Watch the following video to learn about the parts of the…"]);
  const plan = planOutline(items);
  const fire = plan.find((i) => i.text === "Fire");
  assert.equal(plan[fire.tab].text, "Nervous system");
  assert.equal(plan[fire.section].text, "Neurons");
  const byline = plan.find((i) => i.text === "-By Taj");
  assert.equal(plan[byline.section].text, "Cover");
  const neurons = plan.find((i) => i.text === "Neurons");
  assert.equal(neurons.parent, null, "the tab-named wrapper topic is dropped");
  assert.equal(plan.filter((i) => i.kind === "section" && i.text === "Nervous system").length, 0);
});

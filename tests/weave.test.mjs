import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInput,
  agendaToSections,
  tagsNeedingSections,
  weave,
  latestSection,
  toMarkdown,
} from "../js/weave.js";

const doc = (sections, notes, merges = {}) => ({ meta: { title: "T" }, sections, notes, merges });
const note = (author, text, sectionId, createdAt, tags) => ({
  author,
  text,
  sectionId,
  createdAt,
  tags: tags || parseInput(text).tags,
});

test("parseInput: '# Topic' is a section, '#tag' inside text is a tag", () => {
  assert.deepEqual(parseInput("# Photosynthesis"), { kind: "section", title: "Photosynthesis" });
  const n = parseInput("Light reactions make ATP #Photo-synthesis #atp");
  assert.equal(n.kind, "note");
  assert.deepEqual(n.tags, ["photo-synthesis", "atp"]);
  assert.equal(parseInput("#notaheading").kind, "note");
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

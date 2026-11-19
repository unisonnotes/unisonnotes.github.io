import { test } from "node:test";
import assert from "node:assert/strict";
import { gdocToOutline } from "../js/importer.js";
import { planOutline } from "../js/weave.js";

const run = (content, textStyle = {}) => ({ textRun: { content, textStyle } });
const para = (elements, extra = {}) => ({ paragraph: { elements, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, ...extra } });
const bullet = (text, nestingLevel = 0, style) => para([run(text + "\n", style)], { bullet: { listId: "l", nestingLevel } });
const tab = (title, content, childTabs = [], extra = {}) => ({
  tabProperties: { title },
  childTabs,
  documentTab: { body: { content: [{ sectionBreak: {} }, ...content] }, namedStyles: { styles: [{ namedStyleType: "NORMAL_TEXT", textStyle: { fontSize: { magnitude: 13, unit: "PT" }, weightedFontFamily: { fontFamily: "Times New Roman", weight: 400 } } }] }, ...extra },
});

test("Google Docs tabs keep their names and nesting, even empty grouping tabs", () => {
  const json = {
    title: "Bio Notes",
    tabs: [
      tab("Intro", [para([run("BIO NOTES\n", { fontSize: { magnitude: 70, unit: "PT" } })]), para([run("-By Taj\n")])]),
      tab("The Brain", [para([run("The Brain\n", { fontSize: { magnitude: 50, unit: "PT" } })])], [
        tab("Nervous System", [], [
          tab("Nervous System In Class", [para([run("Neurons\n")]), para([run("Fire "), run("fast", { bold: true }), run("\n")], { bullet: { listId: "l", nestingLevel: 0 } }), bullet("Axon", 1)]),
          tab("Gratification, the Brain", [para([{ inlineObjectElement: { inlineObjectId: "o1" } }])], [], {
            inlineObjects: { o1: { inlineObjectProperties: { embeddedObject: { imageProperties: { contentUri: "https://lh3.example/img" } } } } },
          }),
        ]),
      ]),
      tab("Chemistry", [], [tab("2.1-2.9", [para([run("Matter\n")]), bullet("Takes up space"), bullet("Has mass, see "), para([run("CO2 and Na", {}), run("+", { baselineOffset: "SUPERSCRIPT" }), run(" with ", {}), run("link", { link: { url: "https://x.org" }, underline: true }), run("\n")])])]),
    ],
  };
  const out = gdocToOutline(json);
  assert.equal(out.title, "Bio Notes");
  assert.deepEqual(out.style, { font: "times", size: 17 });
  assert.deepEqual([...out.imageUris.values()], ["https://lh3.example/img"]);
  const plan = planOutline(out.items);
  const tabs = plan.filter((i) => i.kind === "tab").map((t) => [t.text, t.depth, t.parent == null ? null : plan[t.parent].text]);
  assert.deepEqual(tabs, [
    ["Intro", 0, null],
    ["The Brain", 0, null],
    ["Nervous System", 1, "The Brain"],
    ["Nervous System In Class", 2, "Nervous System"],
    ["Gratification, the Brain", 2, "Nervous System"],
    ["Chemistry", 0, null],
    ["2.1-2.9", 1, "Chemistry"],
  ]);
  const at = (t) => plan.find((i) => i.text === t);
  assert.equal(plan[at("-By Taj").tab].text, "Intro");
  assert.equal(plan[at("Axon").noteParent].text, "Fire **fast**");
  assert.equal(plan[at("Fire **fast**").section].text, "Neurons");
  assert.equal(plan[at("![](img:imp0)").tab].text, "Gratification, the Brain");
  assert.ok(plan.some((i) => i.text === "CO2 and Na⁺ with [link](https://x.org)"));
  assert.ok(!plan.some((i) => i.kind === "section" && i.text === "The Brain"), "a title-only grouping tab has no topics");
});

test("a Google Doc without tabs imports as a plain doc", () => {
  const out = gdocToOutline({ title: "Notes", tabs: [tab("Tab 1", [para([run("Heading\n")], { paragraphStyle: { namedStyleType: "HEADING_1" } }), bullet("point")])] });
  assert.ok(!out.items.some((i) => i.kind === "tab"));
  assert.deepEqual(out.items.map((i) => i.kind), ["section", "note"]);
});

// Public main page: what Unison is, how it works, and a way in (Log in / Get started).
import { html, useState, useEffect, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Logo, go } from "./kit.js";
import { ModeToggle } from "./theme-picker.js";

const WRITERS = [
  { name: "Maya", color: "var(--a1)" },
  { name: "Jon", color: "var(--a2)" },
  { name: "Priya", color: "var(--a3)" },
];

// The hero demo plays these notes one per beat, then shows what Unison wove from them.
const BEATS = [
  { who: 0, text: "Krebs cycle runs in the matrix" },
  { who: 1, text: "krebs cycle happens in the mitochondrial matrix" },
  { who: 2, text: "aka the citric acid cycle #krebs" },
  { who: 0, text: "Makes 2 ATP per glucose" },
  { who: 1, text: "makes 3 ATP per glucose" },
  { who: 2, text: "Krebs cycle runs in the matrix of mitochondria" },
];
const HOLD = 5; // beats to hold the finished doc before replaying

function useBeat(ms) {
  const reduce = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [beat, setBeat] = useState(reduce.current ? BEATS.length : 0);
  useEffect(() => {
    if (reduce.current) return;
    const t = setInterval(() => setBeat((b) => (b + 1) % (BEATS.length + HOLD + 1)), ms);
    return () => clearInterval(t);
  }, []);
  return Math.min(beat, BEATS.length);
}

function Dots({ who }) {
  return html`<span class="hm-dots">${who.map((i) => html`<i key=${i} style=${{ "--who": WRITERS[i].color }} />`)}</span>`;
}

function HeroDemo() {
  const beat = useBeat(1400);
  const shown = BEATS.slice(0, beat);
  const matrix = [0, 1, 5].filter((i) => i < beat).map((i) => BEATS[i].who);
  const conflict = beat >= 5;
  return html`<div class="hero-mock" aria-label="Three people's notes woven into one doc" role="img">
    <div class="hm-bar">
      <span class="hm-lights"><i /><i /><i /></span>
      <span class="hm-tab"><${Logo} size=${14} /> BIO 201 · Week 6</span>
      <span class="hm-live mono"><span class="dot-live" /> 3 writing</span>
    </div>
    <div class="hm-body">
      <div class="hm-streams">
        ${WRITERS.map(
          (w, col) => html`<div class="hm-col" key=${w.name} style=${{ "--who": w.color }}>
            <div class="hm-who mono"><i />${w.name}</div>
            ${shown.map((b, i) => b.who === col && html`<div class="hm-note" key=${i}>${b.text.replace(/ #\w+/, "")}${/#\w+/.test(b.text) && html` <span class="tag">#krebs</span>`}</div>`)}
          </div>`,
        )}
      </div>
      <div class="hm-arrow" aria-hidden="true">
        <svg viewBox="0 0 40 120" preserveAspectRatio="none">
          <path d="M2 20 C 22 20, 18 60, 38 60" style="--who: var(--a1)" />
          <path d="M2 60 L 38 60" style="--who: var(--a2)" />
          <path d="M2 100 C 22 100, 18 60, 38 60" style="--who: var(--a3)" />
        </svg>
      </div>
      <div class="hm-doc">
        <div class="hm-kicker mono">Woven notes</div>
        <div class="hm-h"><span class="mono">01</span> Krebs cycle</div>
        <ul>
          ${matrix.length > 0 &&
          html`<li class="hm-pt" key="m">
            <span>Krebs cycle happens in the mitochondrial matrix</span>
            ${matrix.length > 1 && html`<em class="badge badge--dup mono" key=${matrix.length}>×${matrix.length}</em>`}
            <${Dots} who=${matrix} />
          </li>`}
          ${beat >= 3 &&
          html`<li class="hm-pt" key="c">
            <span>Also called the citric acid cycle</span>
            <b class="badge badge--solo mono">solo</b>
            <${Dots} who=${[2]} />
          </li>`}
          ${beat >= 4 &&
          html`<li class=${"hm-pt" + (conflict ? " is-conflict" : "")} key="a2">
            <span>Makes <mark class=${conflict ? "clash" : ""}>2</mark> ATP per glucose</span>
            ${conflict && html`<b class="badge badge--conflict mono"><${Icon} name="triangle-alert" size=${10} /> check</b>`}
            <${Dots} who=${[0]} />
          </li>`}
          ${conflict &&
          html`<li class="hm-pt is-conflict" key="a3">
            <span>Makes <mark class="clash">3</mark> ATP per glucose</span>
            <b class="badge badge--conflict mono"><${Icon} name="triangle-alert" size=${10} /> check</b>
            <${Dots} who=${[1]} />
          </li>`}
        </ul>
        <div class=${"hm-h hm-h--gap" + (beat >= 4 ? " is-hot" : "")}><span class="mono">02</span> Electron transport chain</div>
        ${beat >= 4 && html`<div class="hm-gap"><${Icon} name="flame" size=${12} /> Nobody has written here yet <span class="hm-claim"><${Icon} name="hand" size=${11} /> Claim</span></div>`}
      </div>
    </div>
  </div>`;
}

const STEPS = [
  {
    n: "01",
    title: "Write in your own stream",
    body: "Everyone types in their own column. No cursors colliding, no one overwriting you, and you only ever edit your own notes.",
    art: "streams",
  },
  {
    n: "02",
    title: "Share one spine",
    body: "The spine is the only shared structure: an outline of topics. Type # Topic to add one for everyone. New notes go to the latest topic.",
    art: "spine",
  },
  {
    n: "03",
    title: "Read the woven doc",
    body: "Every note snaps onto a section, so the group ends up with one clean doc that credits each writer. No cleanup afterwards.",
    art: "woven",
  },
];

function StepArt({ kind }) {
  if (kind === "streams")
    return html`<div class="art art--streams">${[1, 2, 3].map((i) => html`<span key=${i} style=${{ "--who": `var(--a${i})`, "--i": i }}><i /><i /><i /></span>`)}</div>`;
  if (kind === "spine")
    return html`<div class="art art--spine">
      ${["Overview", "Key concepts", "Examples", "# Questions"].map((t, i) => html`<span key=${t} class=${i === 3 ? "is-new" : ""}><b class="mono">0${i + 1}</b>${t}</span>`)}
    </div>`;
  return html`<div class="art art--woven">
    <span><i />Mitochondria make ATP<em class="mono">×3</em></span>
    <span><i />Krebs runs in the matrix<em class="mono">×2</em></span>
    <span><i />Why oxygen last?<b class="mono">solo</b></span>
  </div>`;
}

const FEATURES = [
  { icon: "git-merge", title: "Duplicates collapse", body: "Matching notes merge into one bullet with a ×N badge. Points only one person caught get a solo marker.", demo: html`<span class="badge badge--dup mono">×3</span><span class="badge badge--solo mono">solo</span>` },
  { icon: "triangle-alert", title: "Conflicts get flagged", body: "Similar notes with different numbers or dates light up, so someone double-checks before the exam.", demo: html`<span class="fx-clash">signed in <mark class="clash">1648</mark> vs <mark class="clash">1658</mark></span>` },
  { icon: "flame", title: "Gaps glow", body: "Sections with few notes glow on the spine. Anyone can claim one, and everyone sees who's on it.", demo: html`<span class="fx-heat"><i /><i /><i class="hot" /><i /></span>` },
  { icon: "hash", title: "Hashtags become sections", body: "When two people use the same #tag, it becomes a section and their notes move into it.", demo: html`<span class="tag mono">#photosynthesis</span>` },
  { icon: "clock", title: "Every note is timed", body: "Timestamps on every note mean the spine doubles as a timeline of the lecture or meeting.", demo: html`<span class="mono fx-time">10:02 → 10:41</span>` },
  { icon: "download", title: "Clean export", body: "One doc with credits, as Markdown or PDF. Ready to share with the people who missed it.", demo: html`<span class="mono fx-file">notes.md · notes.pdf</span>` },
];

const AUDIENCES = [
  ["graduation-cap", "Lecture notes with classmates"],
  ["book-open", "Study groups splitting a chapter"],
  ["users", "Club and team meetings"],
  ["briefcase", "Group projects"],
];

export function Landing({ signedIn }) {
  const enter = () => go(signedIn ? "/" : "/signin");
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  useEffect(() => {
    document.title = "Unison Notes · everyone writes, one doc";
  }, []);

  return html`<div class="landing">
    <header class="l-nav">
      <a class="brand" href="#/" onClick=${(e) => (e.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))}>
        <${Logo} size=${34} />
        <span class="brand-name">Unison<span>Notes</span></span>
      </a>
      <nav class="l-links">
        <button onClick=${() => scrollTo("how")}>How it works</button>
        <button onClick=${() => scrollTo("features")}>Features</button>
        <button onClick=${() => scrollTo("who")}>Who it's for</button>
      </nav>
      <div class="l-nav-right">
        <${ModeToggle} />
        ${signedIn
          ? html`<button class="btn btn--primary" onClick=${enter}>Open your docs <${Icon} name="arrow-right" /></button>`
          : html`<button class="btn btn--ghost" onClick=${enter}>Log in</button>
              <button class="btn btn--primary" onClick=${enter}>Get started</button>`}
      </div>
    </header>

    <section class="l-hero">
      <div class="signin-grid" aria-hidden="true" />
      <div class="l-hero-copy">
        <span class="l-chip mono"><span class="dot-live" /> Free · No AI · Runs in your browser</span>
        <h1>Everyone writes alone.<br /><em>One doc comes out.</em></h1>
        <p class="l-lede">
          Unison is group notes without the chaos. Each person takes notes in their own stream, and Unison weaves them into one organized, credited doc.
        </p>
        <div class="l-ctas">
          <button class="btn btn--primary btn--lg" onClick=${enter}>${signedIn ? "Open your docs" : "Start a doc, it's free"} <${Icon} name="arrow-right" /></button>
          <button class="btn btn--lg l-ghost" onClick=${() => scrollTo("how")}>See how it works</button>
        </div>
      </div>
      <div class="l-hero-shot">
        <div class="l-horizon" aria-hidden="true" />
        <${HeroDemo} />
        <div class="card-glow" aria-hidden="true" />
      </div>
    </section>

    <section class="l-section l-problem">
      <div class="l-split">
        <div>
          <span class="kicker">The problem</span>
          <h2>One shared doc, five people typing</h2>
          <ul class="l-pains">
            <li><${Icon} name="x" size=${15} /> Cursors collide and paragraphs get overwritten</li>
            <li><${Icon} name="x" size=${15} /> The same point gets written three different ways</li>
            <li><${Icon} name="x" size=${15} /> Structure falls apart and nobody knows who's covering what</li>
            <li><${Icon} name="x" size=${15} /> Someone spends the evening cleaning it all up</li>
          </ul>
        </div>
        <div>
          <span class="kicker kicker--accent">The Unison way</span>
          <h2>Separate the writing from the organizing</h2>
          <ul class="l-gains">
            <li><${Icon} name="check" size=${15} /> You write in your own space, at your own pace</li>
            <li><${Icon} name="check" size=${15} /> Repeats collapse into one point with a ×N badge</li>
            <li><${Icon} name="check" size=${15} /> One shared outline keeps everyone on the same page</li>
            <li><${Icon} name="check" size=${15} /> The doc is already clean when the meeting ends</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="l-section" id="how">
      <div class="l-head">
        <span class="kicker">How it works</span>
        <h2>Streams, a spine, and one woven doc</h2>
      </div>
      <div class="l-steps">
        ${STEPS.map(
          (s, i) => html`<article class="l-step" key=${s.n} style=${{ "--i": i }}>
            <${StepArt} kind=${s.art} />
            <span class="l-step-n mono">${s.n}</span>
            <h3>${s.title}</h3>
            <p>${s.body}</p>
          </article>`,
        )}
      </div>
    </section>

    <section class="l-section" id="features">
      <div class="l-head">
        <span class="kicker">Features</span>
        <h2>Small tools that keep group notes clean</h2>
        <p>All of it runs in the browser with plain word matching, so it costs nothing and needs no AI.</p>
      </div>
      <div class="l-features">
        ${FEATURES.map(
          (f) => html`<article class="l-feature" key=${f.title}>
            <span class="l-feature-icon"><${Icon} name=${f.icon} size=${17} /></span>
            <h3>${f.title}</h3>
            <p>${f.body}</p>
            <div class="l-feature-demo">${f.demo}</div>
          </article>`,
        )}
      </div>
    </section>

    <section class="l-section" id="who">
      <div class="l-head">
        <span class="kicker">Who it's for</span>
        <h2>Anywhere a group takes notes together</h2>
      </div>
      <div class="l-audience">
        ${AUDIENCES.map(([icon, label]) => html`<span class="l-aud" key=${label}><${Icon} name=${icon} size=${16} />${label}</span>`)}
      </div>
    </section>

    <section class="l-section l-final">
      <div class="l-final-inner">
        <h2>Your next lecture, written together</h2>
        <p>Sign in with Google, start a doc, and share it with your group. Docs stick around, so people can come back and keep adding.</p>
        <div class="l-final-card-wrap">
          <button class="l-final-card" onClick=${enter}>
            <span class="l-final-placeholder">What are we taking notes on today?</span>
            <span class="l-final-bar">
              <span class="target-btn target-btn--static"><span class="target-ring" /><span class="target-label">New doc</span></span>
              <span class="send-btn is-ready"><${Icon} name="arrow-up" size=${16} stroke=${2.2} /></span>
            </span>
          </button>
          <div class="card-glow" aria-hidden="true" />
        </div>
      </div>
    </section>

    <footer class="l-foot">
      <span class="brand"><${Logo} size=${24} /><span class="brand-name">Unison<span>Notes</span></span></span>
      <span class="mono">free · runs on Firebase · no AI</span>
      <a href="https://github.com/unisonnotes/unisonnotes.github.io" target="_blank" rel="noopener">GitHub</a>
    </footer>
  </div>`;
}

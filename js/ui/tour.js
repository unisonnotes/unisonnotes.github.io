// Interactive walkthrough over the real doc page: a spotlight on one part of the UI,
// a card that explains it, and small "try it" tasks that tick themselves off when you
// actually do them.
import { html, useState, useEffect, useLayoutEffect, useMemo, useRef } from "./h.js";
import { Icon } from "./icons.js";
import { Kbd } from "./kit.js";

export const TOUR_KEY = "unison.tour.v1";

const mineOf = (ctx) => Object.entries(ctx.doc.notes || {}).filter(([, n]) => n.author === ctx.user.uid);

function snapshot(ctx) {
  return { mine: new Set(mineOf(ctx).map(([id]) => id)), sections: Object.keys(ctx.doc.sections || {}).length };
}

function buildSteps(canEdit) {
  const welcome = {
    id: "welcome",
    title: "Welcome to Unison",
    art: true,
    body: html`Everyone in your group writes in <b>their own stream</b>. Unison weaves all of it into <b>one organized doc</b>, merging repeats and crediting each writer. This takes about a minute.`,
  };
  const stream = {
    id: "stream",
    target: '[data-tour="composer-input"]',
    prepare: (s) => s.setShowPanel(true),
    title: "Your stream",
    body: html`This is where you write. Each <${Kbd}>↵<//> sends one bullet. Only you write here, so nobody types over you.`,
    task: {
      text: "Write a note and press Enter",
      fill: "Mitochondria make ATP for the cell",
      done: (ctx, b) => mineOf(ctx).some(([id]) => !b.mine.has(id)),
    },
  };
  const topics = {
    id: "topics",
    target: '[data-tour="composer-input"]',
    prepare: (s) => s.setShowPanel(true),
    title: "Topics and subtopics",
    body: html`Start a message with <code>#</code> to add a topic for everyone, like <code>#Mitochondria</code>. Use <code>##</code> for a subtopic inside the topic you're in, like <code>##Cristae</code>. Your next notes go into it.`,
    task: {
      text: "Make a topic: type #Mitochondria and press Enter",
      fill: "#Mitochondria",
      done: (ctx, b) => Object.keys(ctx.doc.sections || {}).length > b.sections,
    },
  };
  const bullets = {
    id: "bullets",
    target: '[data-tour="composer-input"]',
    prepare: (s) => s.setShowPanel(true),
    title: "Sub-bullets",
    body: html`Press <${Kbd}>Tab<//> to nest your next bullet under the one you just sent, and <${Kbd}>⇧<//> <${Kbd}>Tab<//> to step back out. Pasting an indented list keeps its structure.`,
    task: {
      text: "Send a note, press Tab, then send a sub-point",
      done: (ctx, b) => mineOf(ctx).some(([id, n]) => !b.mine.has(id) && n.parentId),
    },
  };
  const spine = {
    id: "spine",
    target: '[data-tour="spine"]',
    prepare: (s) => s.setShowSpine(true),
    title: "The spine",
    body: html`The one shared outline, built from everyone's topics. Click a topic to jump to it. The <span class="tour-swatch tour-swatch--target"></span> bar shows where your notes are going; topics with few notes <span class="tour-swatch tour-swatch--heat"></span> glow so someone can claim them.`,
  };
  const woven = {
    id: "woven",
    target: ".page",
    prepare: (s) => s.setView("woven"),
    title: "The woven doc",
    body: html`Everyone's notes land here. Repeats merge into one point with <span class="badge badge--dup mono">×N</span>, points only one person caught are <span class="badge badge--solo mono">solo</span>, and similar notes with different numbers get flagged. Hover a point and press <b>+</b> to add a sub-point under it.`,
  };
  const views = {
    id: "views",
    target: '[data-tour="views"]',
    title: "Everyone's streams",
    body: "Switch to Streams to see each person's raw notes side by side, in the order they wrote them.",
  };
  const share = {
    id: "share",
    target: '[data-tour="share"]',
    title: "Bring your group",
    body: "Invite people by email. Editors get their own stream; viewers can read the woven notes.",
  };
  const done = {
    id: "done",
    title: "You're set",
    body: html`That's the whole idea: write alone, read together. You can replay this from <b>Help → Take the tour</b>.`,
  };
  return canEdit ? [welcome, stream, topics, bullets, spine, woven, views, share, done] : [welcome, spine, woven, views, done];
}

const CARD_W = 360;
const GAP = 14;

/** Put the card beside the spotlight on whichever side has room, clamped on screen. */
function place(rect, cardH) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) return rect && rect.y + rect.h / 2 > vh / 2 ? { left: 12, right: 12, top: 12 } : { left: 12, right: 12, bottom: 12 };
  if (!rect) return { left: (vw - CARD_W) / 2, top: Math.max(24, (vh - cardH) / 2) };
  const clampY = (y) => Math.min(Math.max(16, y), vh - cardH - 16);
  const clampX = (x) => Math.min(Math.max(16, x), vw - CARD_W - 16);
  const midY = rect.y + rect.h / 2 - cardH / 2;
  if (rect.x - GAP - CARD_W >= 16) return { left: rect.x - GAP - CARD_W, top: clampY(midY) };
  if (rect.x + rect.w + GAP + CARD_W <= vw - 16) return { left: rect.x + rect.w + GAP, top: clampY(midY) };
  if (rect.y + rect.h + GAP + cardH <= vh - 16) return { left: clampX(rect.x + rect.w / 2 - CARD_W / 2), top: rect.y + rect.h + GAP };
  return { left: clampX(rect.x + rect.w / 2 - CARD_W / 2), top: clampY(rect.y - GAP - cardH) };
}

function WelcomeArt() {
  return html`<div class="tour-art" aria-hidden="true">
    <div class="tour-art-cols">
      ${[1, 2, 3].map((i) => html`<span key=${i} style=${{ "--who": `var(--a${i})`, "--i": i }}><i /><i /></span>`)}
    </div>
    <svg viewBox="0 0 120 30" preserveAspectRatio="none">
      <path d="M20 0 C20 18 60 12 60 30" style="--who: var(--a1)" />
      <path d="M60 0 L60 30" style="--who: var(--a2)" />
      <path d="M100 0 C100 18 60 12 60 30" style="--who: var(--a3)" />
    </svg>
    <div class="tour-art-doc"><b /><i /><i /><i /></div>
  </div>`;
}

export function Tour({ ctx, stage, onClose }) {
  const steps = useMemo(() => buildSteps(ctx.canEdit), [ctx.canEdit]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const [rect, setRect] = useState(null);
  const [cardH, setCardH] = useState(240);
  const base = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    step.prepare?.(stage);
    base.current = snapshot(ctx);
    if (step.target === '[data-tour="composer-input"]') setTimeout(() => document.querySelector(step.target)?.focus(), 120);
  }, [i]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target && document.querySelector(step.target);
      if (el && step.target === ".page") el.closest(".canvas")?.scrollTo({ top: 0 });
      const r = el?.getBoundingClientRect();
      const box = r && r.width ? { x: r.left, y: r.top, w: r.width, h: Math.min(r.height, window.innerHeight - r.top - 8) } : null;
      setRect((old) => (JSON.stringify(old) === JSON.stringify(box) ? old : box));
      if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    };
    measure();
    const t = setInterval(measure, 200);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, [i]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !/TEXTAREA|INPUT/.test(document.activeElement?.tagName)) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const done = step.task && base.current ? step.task.done(ctx, base.current) : false;
  // Finishing a task moves on by itself after a beat.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setI((x) => (x === i ? Math.min(x + 1, steps.length - 1) : x)), 1300);
    return () => clearTimeout(t);
  }, [done, i]);

  const last = i === steps.length - 1;
  const pad = 6;
  const hole = rect && { left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2 };
  const pos = place(hole && { x: hole.left, y: hole.top, w: hole.width, h: hole.height }, cardH);

  return html`<div class="tour" role="dialog" aria-label="Unison walkthrough">
    <div class=${"tour-shade" + (hole ? " has-hole" : "")} style=${hole || {}} />
    <section class="tour-card" ref=${cardRef} style=${{ ...Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, v + "px"])), width: window.innerWidth < 640 ? "auto" : CARD_W + "px" }} key=${step.id}>
      <div class="tour-progress"><i style=${{ width: ((i + 1) / steps.length) * 100 + "%" }} /></div>
      ${step.art && html`<${WelcomeArt} />`}
      <div class="kicker">${i === 0 ? "Quick tour" : last ? "Done" : `Step ${i} of ${steps.length - 2}`}</div>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      ${step.task &&
      html`<div class=${"tour-task" + (done ? " is-done" : "")}>
        <span class="tour-check">${done ? html`<${Icon} name="check" size=${13} stroke=${2.4} />` : html`<${Icon} name="zap" size=${13} />`}</span>
        <span>${done ? "Nice, that worked." : html`<b>Try it:</b> ${step.task.text}`}</span>
        ${!done &&
        step.task.fill &&
        html`<button class="link-btn" onClick=${() => ctx.composerApi.current?.fill(step.task.fill)}>Fill it in</button>`}
      </div>`}
      <footer class="tour-foot">
        ${!last && html`<button class="btn btn--ghost btn--sm" onClick=${onClose}>Skip tour</button>`}
        <span class="grow" />
        ${i > 0 && !last && html`<button class="btn btn--sm" onClick=${() => setI(i - 1)}><${Icon} name="arrow-left" size=${14} /></button>`}
        <button
          class="btn btn--primary btn--sm"
          onClick=${() => {
            if (last) {
              onClose();
              ctx.canEdit && ctx.focusComposer();
            } else setI(i + 1);
          }}
        >
          ${i === 0 ? "Show me" : last ? (ctx.canEdit ? "Start writing" : "Done") : step.task && !done ? "Skip this step" : "Next"}
          ${!last && html`<${Icon} name="arrow-right" size=${14} />`}
        </button>
      </footer>
    </section>
  </div>`;
}

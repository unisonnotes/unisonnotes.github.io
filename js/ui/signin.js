// Sign-in page. Composition borrowed from omp's start screen in Tern: a centered
// mark, a single card on a dot grid, a horizon line and a soft glow beneath it.
import { html, useState, useRef, useEffect } from "./h.js";
import { Icon } from "./icons.js";
import { Logo, Avatar, toast } from "./kit.js";
import { ModeToggle } from "./theme-picker.js";

const GOOGLE = html`<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
</svg>`;

export function SignIn({ backend }) {
  const local = backend.auth.kind === "local";
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const nameRef = useRef(null);
  const known = local ? backend.auth.knownAccounts() : [];

  useEffect(() => {
    if (local) setTimeout(() => nameRef.current?.focus(), 700);
  }, []);

  const google = async () => {
    setBusy(true);
    try {
      await backend.auth.signIn();
    } catch (e) {
      if (e?.code !== "auth/popup-closed-by-user") toast(e?.message || "Sign-in failed", { icon: "triangle-alert", tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const submitLocal = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast("Enter an email so others can share docs with you", { icon: "mail", tone: "danger" });
      return;
    }
    setBusy(true);
    await backend.auth.signIn({ name, email });
  };

  return html`<main class="signin">
    <div class="signin-grid" aria-hidden="true" />
    <div class="signin-horizon" aria-hidden="true" />
    <a class="signin-back" href="#/"><${Icon} name="arrow-left" size=${15} /> Back</a>
    <div class="signin-corner"><${ModeToggle} /></div>

    <div class="signin-center">
      <a class="signin-brand" href="#/" title="Unison Notes home">
        <${Logo} size=${62} draw />
        <div>
          <h1>Unison<span>Notes</span></h1>
          <p class="mono">everyone writes · one doc</p>
        </div>
      </a>

      <div class="signin-card-wrap">
        <div class="card-meta mono"><span>${local ? "LOCAL MODE" : "SIGN IN"}</span><span>${local ? "data stays in this browser" : "free · no install"}</span></div>
        <section class="signin-card">
          <p class="signin-lede">
            Take notes in your own stream. Unison weaves everyone's into one clean, organized doc, with credit to each writer.
          </p>

          ${local
            ? html`<form class="signin-local" onSubmit=${submitLocal}>
                <label class="field-label">
                  <span>Name</span>
                  <input ref=${nameRef} class="field" placeholder="Ada Lovelace" value=${name} onInput=${(e) => setName(e.target.value)} autocomplete="name" />
                </label>
                <label class="field-label">
                  <span>Email</span>
                  <input class="field" type="email" placeholder="ada@school.edu" value=${email} onInput=${(e) => setEmail(e.target.value)} autocomplete="email" />
                </label>
                <button class="btn btn--primary btn--lg" disabled=${busy}>
                  Continue <${Icon} name="arrow-right" />
                </button>
              </form>
              ${known.length > 0 &&
              html`<div class="signin-known">
                <div class="kicker">Recent accounts in this browser</div>
                ${known.slice(0, 4).map(
                  (u) => html`<button class="known-acct" key=${u.uid} onClick=${() => backend.auth.signIn(u)}>
                    <${Avatar} ...${u} size=${26} />
                    <span><b>${u.name}</b><small>${u.email}</small></span>
                    <${Icon} name="chevron-right" />
                  </button>`,
                )}
              </div>`}`
            : html`<button class="btn btn--google btn--lg" onClick=${google} disabled=${busy}>
                ${GOOGLE} ${busy ? "Opening Google…" : "Continue with Google"}
              </button>`}

          <div class="signin-foot">
            <span class="dot-live" />
            ${local
              ? html`<span>No Firebase config yet. Open a second tab as someone else to try sharing.</span>`
              : html`<span>We only use your name and email to share docs.</span>`}
          </div>
        </section>
        <div class="card-glow" aria-hidden="true" />
      </div>
    </div>
  </main>`;
}

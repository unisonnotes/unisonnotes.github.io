import { html, render, useState, useEffect } from "./ui/h.js";
import "./themes.js";
import { firebaseConfig } from "./config.js";
import { createLocalBackend } from "./backend/local.js";
import { initStore, saveProfile, watchInvites, acceptInvite } from "./store.js";
import { Logo, ToastHost, DialogHost, toast } from "./ui/kit.js";
import { SignIn } from "./ui/signin.js";
import { Landing } from "./ui/landing.js";
import { Home } from "./ui/home.js";
import { DocPage } from "./ui/doc.js";

// Hash routes keep GitHub Pages happy (no server rewrites):
// #/ (main page, or your docs once signed in), #/about, #/signin, #/d/<docId>
function parseRoute() {
  const m = /^#\/d\/([^/?]+)/.exec(location.hash);
  if (m) return { name: "doc", docId: decodeURIComponent(m[1]) };
  if (/^#\/signin\b/.test(location.hash)) return { name: "signin" };
  if (/^#\/about\b/.test(location.hash)) return { name: "about" };
  return { name: "home" };
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const on = () => setRoute(parseRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

function Loading({ label = "Loading" }) {
  return html`<div class="boot">
    <${Logo} size=${52} draw />
    <span class="mono">${label}</span>
  </div>`;
}

function App({ backend }) {
  const [user, setUser] = useState(undefined);
  const route = useRoute();

  useEffect(() => backend.auth.onChange(setUser), []);

  useEffect(() => {
    if (!user) return;
    saveProfile(user).catch(() => {});
    // Invites wait under the invitee's email until their browser accepts them.
    return watchInvites(user.email, (invites) => {
      for (const [docId, inv] of Object.entries(invites)) {
        acceptInvite(user, docId, inv)
          .then(() => toast(html`<b>${inv.invitedBy || "Someone"}</b> shared “${inv.title || "a doc"}” with you`, { icon: "user-plus" }))
          .catch((e) => console.warn("invite accept failed", docId, e));
      }
    });
  }, [user?.uid]);

  // Signing in from #/signin lands on your docs.
  useEffect(() => {
    if (user && route.name === "signin") location.replace("#/");
  }, [user, route.name]);

  let page;
  if (user === undefined) page = html`<${Loading} />`;
  else if (route.name === "about" || (!user && route.name === "home")) page = html`<${Landing} signedIn=${!!user} />`;
  else if (!user) page = html`<${SignIn} backend=${backend} />`;
  else if (route.name === "doc") page = html`<${DocPage} key=${route.docId} user=${user} docId=${route.docId} backend=${backend} />`;
  else page = html`<${Home} user=${user} backend=${backend} />`;

  return html`${page}<${ToastHost} /><${DialogHost} />`;
}

async function boot() {
  const root = document.getElementById("app");
  let backend;
  // `?local` runs on this browser's storage even when Firebase is configured (testing).
  const forceLocal = new URLSearchParams(location.search).has("local");
  if (firebaseConfig.apiKey && !forceLocal) {
    try {
      const { createFirebaseBackend } = await import("./backend/firebase.js");
      backend = await createFirebaseBackend();
    } catch (e) {
      console.error(e);
      render(html`<div class="boot boot--error"><${Logo} size=${52} /><b>Couldn't reach Firebase</b><span class="mono">${String(e.message || e)}</span></div>`, root);
      return;
    }
  } else {
    backend = await createLocalBackend();
  }
  initStore(backend);
  document.documentElement.dataset.backend = backend.db.kind;
  render(html`<${App} backend=${backend} />`, root);
}

boot();

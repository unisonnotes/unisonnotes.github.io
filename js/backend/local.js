// Local mode: the same adapter surface as firebase.js, backed by one JSON tree in
// IndexedDB. Writes are readwrite transactions (serialized across tabs, so no lost
// updates) and a BroadcastChannel tells other tabs to re-read. Opening the app in two
// tabs as two different people exercises streams, presence and weaving for real.
// Security rules are not enforced here; database.rules.json does that on Firebase.

const IDB_NAME = "unison-local";
const ROOT = "root";
const USERS_KEY = "unison.local.users";
const SESSION_KEY = "unison.local.session";
const TS = { ".sv": "timestamp" };

const split = (path) => path.split("/").filter(Boolean);

function getAt(tree, path) {
  let node = tree;
  for (const k of split(path)) {
    if (node == null || typeof node !== "object") return null;
    node = node[k];
  }
  return node === undefined ? null : node;
}

function resolveTimestamps(value, now) {
  if (value && typeof value === "object") {
    if (value[".sv"] === "timestamp") return now;
    const out = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolveTimestamps(v, now);
      if (r !== null && r !== undefined) out[k] = r;
    }
    return Object.keys(out).length ? out : null;
  }
  return value;
}

function setAt(tree, path, value) {
  const keys = split(path);
  if (!keys.length) return value ?? {};
  const trail = [tree];
  let node = tree;
  for (const k of keys.slice(0, -1)) {
    if (node[k] == null || typeof node[k] !== "object") node[k] = {};
    node = node[k];
    trail.push(node);
  }
  const last = keys[keys.length - 1];
  if (value === null || value === undefined) delete node[last];
  else node[last] = value;
  // Prune empty parents, like the Realtime Database does.
  for (let i = keys.length - 2; i >= 0; i--) {
    if (Object.keys(trail[i + 1]).length) break;
    delete trail[i][keys[i]];
  }
  return tree;
}

let counter = 0;
function pushId() {
  const chars = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  let t = Date.now();
  let id = "";
  for (let i = 0; i < 8; i++) {
    id = chars[t % 64] + id;
    t = Math.floor(t / 64);
  }
  counter = (counter + 1) % 4096;
  id += chars[(counter >> 6) % 64] + chars[counter % 64];
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * 64)];
  return id;
}

async function hashUid(email) {
  const bytes = new TextEncoder().encode("unison-local:" + email);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "u" + [...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function openStore() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run fn(tree) in one transaction and resolve with its result. Readwrite transactions
 * are serialized across tabs by IndexedDB, so read-modify-write never loses updates.
 */
function transact(idb, fn, mode = "readwrite") {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("kv", mode);
    const kv = tx.objectStore("kv");
    let result;
    const get = kv.get(ROOT);
    get.onsuccess = () => {
      result = fn(get.result || {});
      if (mode === "readwrite") kv.put(result, ROOT);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const load = (idb) => transact(idb, (t) => t, "readonly");

export async function createLocalBackend() {
  const idb = await openStore();
  // Let another tab delete or upgrade the database instead of blocking it forever.
  idb.onversionchange = () => {
    idb.close();
    location.reload();
  };
  let tree = await load(idb);
  const subs = new Set();
  const channel = new BroadcastChannel(IDB_NAME);

  function notify() {
    for (const s of subs) {
      const value = getAt(tree, s.path);
      const json = JSON.stringify(value);
      if (json !== s.last) {
        s.last = json;
        s.cb(value === null ? null : JSON.parse(json));
      }
    }
  }

  async function commit(mutate) {
    tree = await transact(idb, (t) => {
      mutate(t, Date.now());
      return t;
    });
    channel.postMessage("changed");
    notify();
  }

  channel.onmessage = async () => {
    tree = await load(idb);
    notify();
  };

  const owned = new Set(); // presence paths to clear when this tab goes away
  window.addEventListener("pagehide", () => {
    if (owned.size) commit((t) => owned.forEach((p) => setAt(t, p, null)));
  });

  const db = {
    kind: "local",
    TIMESTAMP: TS,
    key: pushId,
    get: async (path) => structuredClone(getAt(tree, path)),
    set: (path, value) => commit((t, now) => setAt(t, path, resolveTimestamps(structuredClone(value), now))),
    update: (updates) =>
      commit((t, now) => {
        for (const [path, value] of Object.entries(updates)) setAt(t, path, resolveTimestamps(structuredClone(value), now));
      }),
    remove: (path) => commit((t) => setAt(t, path, null)),
    listen(path, cb) {
      const s = { path, cb, last: undefined };
      subs.add(s);
      queueMicrotask(() => {
        if (!subs.has(s)) return;
        const value = getAt(tree, path);
        s.last = JSON.stringify(value);
        cb(value === null ? null : structuredClone(value));
      });
      return () => subs.delete(s);
    },
    async presence(path, value) {
      owned.add(path);
      await db.set(path, value);
      return () => {
        owned.delete(path);
        return db.remove(path);
      };
    },
    onConnection(cb) {
      queueMicrotask(() => cb(true));
      return () => {};
    },
  };

  // ── Auth: pick a name + email; the uid is derived from the email so the same
  // person signing in from another tab is the same account.
  const authSubs = new Set();
  let user = null;
  try {
    user = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    user = null;
  }

  const emit = () => authSubs.forEach((cb) => cb(user));

  const auth = {
    kind: "local",
    onChange(cb) {
      authSubs.add(cb);
      queueMicrotask(() => cb(user));
      return () => authSubs.delete(cb);
    },
    /** Local mode only: `profile` comes from the sign-in form. */
    async signIn(profile) {
      const email = profile.email.trim().toLowerCase();
      const uid = await hashUid(email);
      user = { uid, name: profile.name.trim() || email.split("@")[0], email, photo: "" };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
      const known = JSON.parse(localStorage.getItem(USERS_KEY) || "{}");
      known[email] = user;
      localStorage.setItem(USERS_KEY, JSON.stringify(known));
      emit();
    },
    async signOut() {
      user = null;
      sessionStorage.removeItem(SESSION_KEY);
      emit();
    },
    knownAccounts() {
      try {
        return Object.values(JSON.parse(localStorage.getItem(USERS_KEY) || "{}"));
      } catch {
        return [];
      }
    },
  };

  return { auth, db };
}

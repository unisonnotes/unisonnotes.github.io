// Firebase backend: Google sign-in + Realtime Database behind the small adapter
// interface the store uses (see local.js for the same surface).
import { firebaseConfig, FIREBASE_SDK } from "../config.js";

export async function createFirebaseBackend() {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${FIREBASE_SDK}/firebase-app.js`),
    import(`${FIREBASE_SDK}/firebase-auth.js`),
    import(`${FIREBASE_SDK}/firebase-database.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const fauth = A.getAuth(app);
  const fdb = D.getDatabase(app);
  const r = (path) => D.ref(fdb, path);

  const toUser = (u) =>
    u && {
      uid: u.uid,
      name: u.displayName || u.email.split("@")[0],
      email: u.email.toLowerCase(),
      photo: u.photoURL || "",
    };

  const auth = {
    kind: "google",
    onChange(cb) {
      return A.onAuthStateChanged(fauth, (u) => cb(toUser(u)));
    },
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await A.signInWithPopup(fauth, provider);
    },
    signOut: () => A.signOut(fauth),
  };

  const db = {
    kind: "firebase",
    TIMESTAMP: D.serverTimestamp(),
    key: () => D.push(r("_ids")).key,
    get: async (path) => (await D.get(r(path))).val(),
    set: (path, value) => D.set(r(path), value),
    update: (updates) => D.update(D.ref(fdb), updates),
    remove: (path) => D.remove(r(path)),
    listen(path, cb, onError) {
      return D.onValue(r(path), (snap) => cb(snap.val()), (err) => onError?.(err));
    },
    /** Write `value` now and remove the path when this client disconnects. */
    async presence(path, value) {
      const node = r(path);
      await D.onDisconnect(node).remove();
      await D.set(node, value);
      return () => {
        D.onDisconnect(node).cancel();
        return D.remove(node);
      };
    },
    onConnection(cb) {
      return D.onValue(r(".info/connected"), (snap) => cb(snap.val() === true));
    },
  };

  return { auth, db };
}

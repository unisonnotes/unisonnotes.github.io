// Domain operations over the backend adapter. Paths follow the data model in
// README.md; database.rules.json enforces who may write each of them.

let db = null;
export function initStore(backend) {
  db = backend.db;
}

export const ROLES = ["owner", "editor", "viewer"];
export const canWrite = (role) => role === "owner" || role === "editor";

/** Database keys can't contain "." so emails are stored with "," instead. */
export const emailKey = (email) => email.trim().toLowerCase().replaceAll(".", ",");

const profileOf = (user) => ({ name: user.name, email: user.email, photo: user.photo || "" });

export function saveProfile(user) {
  return db.update({
    [`users/${user.uid}/name`]: user.name,
    [`users/${user.uid}/email`]: user.email,
    [`users/${user.uid}/photo`]: user.photo || "",
  });
}

// ───────────── Home ─────────────

export const watchMyDocs = (uid, cb) => db.listen(`users/${uid}/docs`, (v) => cb(v || {}));
export const watchDocMeta = (docId, cb, onError) => db.listen(`docs/${docId}/meta`, cb, onError);
export const watchMyDocEntry = (uid, docId, cb) => db.listen(`users/${uid}/docs/${docId}`, cb);
export const forgetDoc = (uid, docId) => db.remove(`users/${uid}/docs/${docId}`);
export const watchInvites = (email, cb) => db.listen(`invites/${emailKey(email)}`, (v) => cb(v || {}));

export function acceptInvite(user, docId, invite) {
  const key = emailKey(user.email);
  return db.update({
    [`docs/${docId}/members/${user.uid}`]: { role: invite.role, ...profileOf(user), joinedAt: db.TIMESTAMP },
    [`users/${user.uid}/docs/${docId}`]: { role: invite.role, lastOpened: db.TIMESTAMP, invitedBy: invite.invitedBy || "" },
    [`invites/${key}/${docId}`]: null,
    [`docs/${docId}/invites/${key}`]: null,
  });
}

export async function createDoc(user, { title, sections = [] }) {
  const docId = db.key();
  const updates = {
    [`docs/${docId}/meta`]: {
      title: title.trim() || "Untitled notes",
      owner: user.uid,
      ownerName: user.name,
      createdAt: db.TIMESTAMP,
    },
    [`docs/${docId}/members/${user.uid}`]: { role: "owner", ...profileOf(user), joinedAt: db.TIMESTAMP },
    [`users/${user.uid}/docs/${docId}`]: { role: "owner", lastOpened: db.TIMESTAMP },
  };
  Object.assign(updates, sectionUpdates(docId, user, sections, 0));
  await db.update(updates);
  return docId;
}

export const touchDoc = (uid, docId, role) =>
  db.update({ [`users/${uid}/docs/${docId}`]: { role, lastOpened: db.TIMESTAMP } });

export const renameDoc = (docId, title) => db.set(`docs/${docId}/meta/title`, title.trim() || "Untitled notes");

export function deleteDoc(uid, doc) {
  const updates = { [`docs/${doc.id}`]: null, [`users/${uid}/docs/${doc.id}`]: null };
  for (const key of Object.keys(doc.invites || {})) updates[`invites/${key}/${doc.id}`] = null;
  return db.update(updates);
}

export const leaveDoc = (uid, docId) =>
  db.update({
    [`docs/${docId}/members/${uid}`]: null,
    [`docs/${docId}/presence/${uid}`]: null,
    [`users/${uid}/docs/${docId}`]: null,
  });

// ───────────── Doc ─────────────

export const watchDoc = (docId, cb, onError) => db.listen(`docs/${docId}`, cb, onError);

export async function addSection(docId, user, title, order, extra = {}) {
  const id = extra.id || db.key();
  await db.set(`docs/${docId}/sections/${id}`, {
    title: title.trim(),
    createdBy: user.uid,
    createdAt: db.TIMESTAMP,
    order,
    ...(extra.tag ? { tag: extra.tag } : {}),
    ...(extra.parentId ? { parentId: extra.parentId } : {}),
  });
  return id;
}

function sectionUpdates(docId, user, titles, startOrder) {
  const updates = {};
  titles.forEach((title, i) => {
    updates[`docs/${docId}/sections/${db.key()}`] = {
      title: title.trim(),
      createdBy: user.uid,
      createdAt: db.TIMESTAMP,
      order: startOrder + i,
    };
  });
  return updates;
}

/** Add several sections in one write; they share a timestamp, so the first counts as latest. */
export const addSections = (docId, user, titles, startOrder) => db.update(sectionUpdates(docId, user, titles, startOrder));

export const renameSection = (docId, sid, title) => db.set(`docs/${docId}/sections/${sid}/title`, title.trim());
export const deleteSection = (docId, sid) => db.remove(`docs/${docId}/sections/${sid}`);

export const claimSection = (docId, sid, user) =>
  db.set(
    `docs/${docId}/sections/${sid}/claim`,
    user ? { uid: user.uid, name: user.name, at: db.TIMESTAMP } : null,
  );

/** Rewrite every section's order to match `ids` (orders can collide when people add at once). */
export const reorderSections = (docId, ids) =>
  db.update(Object.fromEntries(ids.map((id, i) => [`docs/${docId}/sections/${id}/order`, i])));

/** `parentId` makes the note a sub-point of another note (anyone's); `sectionId` should be that note's section. */
export async function addNote(docId, user, { text, sectionId, tags, parentId = null }) {
  const id = db.key();
  await db.set(`docs/${docId}/notes/${id}`, {
    author: user.uid,
    authorName: user.name,
    text,
    sectionId: sectionId || null,
    parentId: parentId || null,
    tags: tags.length ? tags : null,
    createdAt: db.TIMESTAMP,
  });
  return id;
}

export const editNote = (docId, noteId, text, tags) =>
  db.update({
    [`docs/${docId}/notes/${noteId}/text`]: text,
    [`docs/${docId}/notes/${noteId}/tags`]: tags.length ? tags : null,
    [`docs/${docId}/notes/${noteId}/editedAt`]: db.TIMESTAMP,
  });

/** Moving a note to a section also lifts it out from under any parent. */
export const moveNote = (docId, noteId, sectionId) =>
  db.update({
    [`docs/${docId}/notes/${noteId}/sectionId`]: sectionId || null,
    [`docs/${docId}/notes/${noteId}/parentId`]: null,
  });

/** Nest a note under `parentId` (null = make it a top-level point again). */
export const setNoteParent = (docId, noteId, parentId, sectionId) =>
  db.update({
    [`docs/${docId}/notes/${noteId}/parentId`]: parentId || null,
    [`docs/${docId}/notes/${noteId}/sectionId`]: sectionId || null,
  });

export const deleteNote = (docId, noteId) =>
  db.update({ [`docs/${docId}/notes/${noteId}`]: null, [`docs/${docId}/merges/${noteId}`]: null });

/** Hand-merge a paraphrase: `noteId` collapses into whatever group `targetId` is in. */
export const mergeNotes = (docId, noteId, targetId) => db.set(`docs/${docId}/merges/${noteId}`, targetId);
export const unmergeNote = (docId, noteId) => db.remove(`docs/${docId}/merges/${noteId}`);

// ───────────── Sharing ─────────────

export function invite(doc, inviter, email, role) {
  const key = emailKey(email);
  return db.update({
    [`invites/${key}/${doc.id}`]: {
      role,
      invitedBy: inviter.name,
      invitedByEmail: inviter.email,
      title: doc.meta.title,
      at: db.TIMESTAMP,
    },
    [`docs/${doc.id}/invites/${key}`]: { email: email.trim().toLowerCase(), role, at: db.TIMESTAMP },
  });
}

export const cancelInvite = (docId, key) =>
  db.update({ [`invites/${key}/${docId}`]: null, [`docs/${docId}/invites/${key}`]: null });

export const setRole = (docId, uid, role) => db.set(`docs/${docId}/members/${uid}/role`, role);
export const removeMember = (docId, uid) =>
  db.update({ [`docs/${docId}/members/${uid}`]: null, [`docs/${docId}/presence/${uid}`]: null });

// ───────────── Presence ─────────────

/** Announce this user in a doc. Returns {update(sectionId), leave()}. */
export function joinPresence(docId, user) {
  const path = `docs/${docId}/presence/${user.uid}`;
  let section = null;
  let release = null;
  let closed = false;
  const value = () => ({ name: user.name, section, at: db.TIMESTAMP });
  const announce = async () => {
    if (closed) return;
    release = await db.presence(path, value());
  };
  const stopConn = db.onConnection((up) => up && announce());
  const beat = setInterval(() => !closed && db.set(`${path}/at`, db.TIMESTAMP), 30_000);
  return {
    update(sectionId) {
      section = sectionId || null;
      if (!closed) db.set(`${path}/section`, section);
    },
    leave() {
      closed = true;
      clearInterval(beat);
      stopConn();
      release?.();
    },
  };
}

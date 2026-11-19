// Domain operations over the backend adapter. Paths follow the data model in
// README.md; database.rules.json enforces who may write each of them.

import { headingParent, nextOrder, extractTags, planOutline } from "./weave.js";

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
  const updates = { [`docs/${doc.id}`]: null, [`images/${doc.id}`]: null, [`users/${uid}/docs/${doc.id}`]: null };
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
    ...(extra.tabId && !extra.parentId ? { tabId: extra.tabId } : {}),
  });
  return id;
}

function sectionUpdates(docId, user, titles, startOrder, tabId = null) {
  const updates = {};
  titles.forEach((title, i) => {
    updates[`docs/${docId}/sections/${db.key()}`] = {
      title: title.trim(),
      createdBy: user.uid,
      createdAt: db.TIMESTAMP,
      order: startOrder + i,
      ...(tabId ? { tabId } : {}),
    };
  });
  return updates;
}

/** Add several sections in one write; they share a timestamp, so the first counts as latest. */
export const addSections = (docId, user, titles, startOrder, tabId = null) => db.update(sectionUpdates(docId, user, titles, startOrder, tabId));

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

/** Authors delete their own notes; the owner can remove anyone's. Pending suggestions go too. */
export const deleteNote = (docId, noteId) =>
  db.update({
    [`docs/${docId}/notes/${noteId}`]: null,
    [`docs/${docId}/merges/${noteId}`]: null,
    [`docs/${docId}/suggestions/${noteId}`]: null,
  });

// ───────────── Suggestions ─────────────
// Others can't edit your notes; they suggest. suggestions/{noteId}/{uid}: {kind: "edit"|"remove", text?, name, at}

export const suggest = (docId, noteId, user, { kind, text = null }) =>
  db.set(`docs/${docId}/suggestions/${noteId}/${user.uid}`, { kind, text: kind === "edit" ? text : null, name: user.name, at: db.TIMESTAMP });

export const dropSuggestion = (docId, noteId, uid) => db.remove(`docs/${docId}/suggestions/${noteId}/${uid}`);

export async function acceptSuggestion(docId, noteId, uid, s, tags = []) {
  if (s.kind === "remove") return deleteNote(docId, noteId);
  await db.update({
    [`docs/${docId}/notes/${noteId}/text`]: s.text,
    [`docs/${docId}/notes/${noteId}/tags`]: tags.length ? tags : null,
    [`docs/${docId}/notes/${noteId}/editedAt`]: db.TIMESTAMP,
    [`docs/${docId}/suggestions/${noteId}/${uid}`]: null,
  });
}

// ───────────── Page style & the editable doc ─────────────

export const setStyle = (docId, patch) =>
  db.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`docs/${docId}/style/${k}`, v])));

/** draft: {html, basedOn (newest note time it includes), updatedAt, updatedBy, updatedByName, lock: {uid, name, at}} */
export const saveDraft = (docId, user, html, extra = {}) =>
  db.update({
    [`docs/${docId}/draft/html`]: html,
    [`docs/${docId}/draft/updatedAt`]: db.TIMESTAMP,
    [`docs/${docId}/draft/updatedBy`]: user.uid,
    [`docs/${docId}/draft/updatedByName`]: user.name,
    [`docs/${docId}/draft/lock`]: { uid: user.uid, name: user.name, at: db.TIMESTAMP },
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`docs/${docId}/draft/${k}`, v])),
  });

export const lockDraft = (docId, user) => db.set(`docs/${docId}/draft/lock`, { uid: user.uid, name: user.name, at: db.TIMESTAMP });
export const unlockDraft = (docId) => db.remove(`docs/${docId}/draft/lock`);
export const discardDraft = (docId) => db.remove(`docs/${docId}/draft`);

/**
 * Add an imported outline (see planOutline): tabs, topics nested by rank, notes nested
 * by depth. Root topics of a plain paste nest by heading level under `contextSection`;
 * notes before any heading go to `contextSection`; new topics land in `tabId` unless
 * the outline brings its own tabs. `imageIds` maps importer image keys to stored ids.
 * Writes in chunks so huge docs stay under request limits; reports progress.
 */
export async function importOutline(
  docId,
  user,
  items,
  { sections = {}, tabs = {}, contextSection = null, tabId = null, imageIds = null, onProgress = null } = {},
) {
  const plan = planOutline(items);
  const local = { ...(sections || {}) };
  const ids = new Map(); // plan index → db id
  const structure = {};
  const notes = [];
  let tabOrder = nextOrder(tabs || {});
  // A doc without tabs that imports some: what it already had stays together in “Tab 1”.
  if (tabOrder === 0 && plan.some((it) => it.kind === "tab") && Object.keys(sections || {}).length)
    structure[`docs/${docId}/tabs/${db.key()}`] = { title: "Tab 1", createdBy: user.uid, createdAt: db.TIMESTAMP, order: tabOrder++ };
  let tick = Date.now();
  // Pictures that couldn't be stored are left out rather than shown broken.
  const fixImages = (text) =>
    imageIds ? text.replace(/!\[([^\]]*)\]\(img:([\w-]+)\)/g, (m, alt, key) => (imageIds.has(key) ? `![${alt}](img:${imageIds.get(key)})` : "")).trim() : text;
  const childOrder = new Map(); // parent tab id → next order among its children
  plan.forEach((it, i) => {
    if (it.kind === "tab") {
      const id = db.key();
      ids.set(i, id);
      const parentId = it.parent != null ? ids.get(it.parent) : null;
      let order = tabOrder;
      if (parentId) {
        order = childOrder.get(parentId) || 0;
        childOrder.set(parentId, order + 1);
      } else tabOrder++;
      structure[`docs/${docId}/tabs/${id}`] = { title: it.text, createdBy: user.uid, createdAt: db.TIMESTAMP, order, ...(parentId ? { parentId } : {}) };
      return;
    }
    if (it.kind === "section") {
      const parent = it.parent != null ? ids.get(it.parent) : it.level != null && it.tab == null ? headingParent(local, it.level, contextSection) : null;
      const tab = parent ? null : it.tab != null ? ids.get(it.tab) : tabId;
      const order = nextOrder(local, parent);
      const id = db.key();
      ids.set(i, id);
      structure[`docs/${docId}/sections/${id}`] = {
        title: it.text,
        createdBy: user.uid,
        createdAt: db.TIMESTAMP,
        order,
        ...(parent ? { parentId: parent } : {}),
        ...(tab ? { tabId: tab } : {}),
      };
      local[id] = { title: it.text, order, createdAt: tick++, ...(parent ? { parentId: parent } : {}) };
      return;
    }
    const text = fixImages(it.text);
    if (!text) {
      ids.set(i, it.noteParent != null ? ids.get(it.noteParent) : null); // its sub-points move up
      return;
    }
    const id = db.key();
    ids.set(i, id);
    const tags = extractTags(text);
    notes.push([
      `docs/${docId}/notes/${id}`,
      {
        author: user.uid,
        authorName: user.name,
        text,
        sectionId: it.section != null ? ids.get(it.section) : contextSection || null,
        parentId: (it.noteParent != null && ids.get(it.noteParent)) || null,
        tags: tags.length ? tags : null,
        createdAt: db.TIMESTAMP,
      },
    ]);
  });
  const CHUNK = 400;
  const total = notes.length;
  onProgress?.(0, total);
  const entries = Object.entries(structure);
  for (let i = 0; i < entries.length; i += CHUNK * 2) await db.update(Object.fromEntries(entries.slice(i, i + CHUNK * 2)));
  for (let i = 0; i < notes.length; i += CHUNK) {
    await db.update(Object.fromEntries(notes.slice(i, i + CHUNK)));
    onProgress?.(Math.min(total, i + CHUNK), total);
  }
  return { notes: total, sections: entries.filter(([p]) => p.includes("/sections/")).length, tabs: entries.filter(([p]) => p.includes("/tabs/")).length };
}

// ───────────── Tabs ─────────────

export async function addTab(docId, user, title, order, parentId = null) {
  const id = db.key();
  await db.set(`docs/${docId}/tabs/${id}`, {
    title: title.trim() || "Untitled tab",
    createdBy: user.uid,
    createdAt: db.TIMESTAMP,
    order,
    ...(parentId ? { parentId } : {}),
  });
  return id;
}
export const renameTab = (docId, tabId, title) => db.set(`docs/${docId}/tabs/${tabId}/title`, title.trim() || "Untitled tab");
/** Put tabs where they belong: moves = [{id, parentId, order}] (a drag, indent, outdent). */
export const arrangeTabs = (docId, moves) =>
  db.update(
    Object.fromEntries(
      moves.flatMap((m) => [
        [`docs/${docId}/tabs/${m.id}/parentId`, m.parentId || null],
        [`docs/${docId}/tabs/${m.id}/order`, m.order],
      ]),
    ),
  );
/**
 * Merge tabs into `intoId` in one write: their topics (with subtopics) and child tabs
 * move over, then the merged tabs are removed.
 */
export const mergeTabs = (docId, intoId, mergedIds, sectionMoves, childMoves) =>
  db.update(
    Object.fromEntries([
      ...sectionMoves.flatMap((m) => [
        [`docs/${docId}/sections/${m.id}/tabId`, intoId],
        [`docs/${docId}/sections/${m.id}/order`, m.order],
      ]),
      ...childMoves.flatMap((m) => [
        [`docs/${docId}/tabs/${m.id}/parentId`, m.parentId || null],
        [`docs/${docId}/tabs/${m.id}/order`, m.order],
      ]),
      ...mergedIds.map((id) => [`docs/${docId}/tabs/${id}`, null]),
    ]),
  );
/** Delete a tab, its child tabs and their topics; their notes fall back to Unsorted. */
export const deleteTab = (docId, tabIds, sectionIds) =>
  db.update(
    Object.fromEntries([
      ...tabIds.map((id) => [`docs/${docId}/tabs/${id}`, null]),
      ...sectionIds.map((id) => [`docs/${docId}/sections/${id}`, null]),
    ]),
  );
/** Move a topic (and its subtopics) to another tab. */
export const moveSectionToTab = (docId, sid, tabId, order) =>
  db.update({
    [`docs/${docId}/sections/${sid}/tabId`]: tabId,
    [`docs/${docId}/sections/${sid}/order`]: order,
  });

// ───────────── Images ─────────────

export async function saveImage(docId, user, { data, w, h }) {
  const id = db.key();
  await db.set(`images/${docId}/${id}`, { data, w, h, by: user.uid, at: db.TIMESTAMP });
  return id;
}
export const getImage = (docId, id) => db.get(`images/${docId}/${id}`);

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

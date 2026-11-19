# Unison Notes

Group notes where everyone writes alone and the app weaves one shared, organized doc.
Static site (no build step) on GitHub Pages, Firebase Auth + Realtime Database for data, no AI.

Live: https://unisonnotes.github.io

## How it works

- **Streams**: each person types in their own column. People only edit their own notes, so there is nothing to merge.
- **Spine**: the one shared outline. `#Topic` in the composer adds a topic for everyone, `##Subtopic` nests one inside the topic you're in (`###` goes one deeper). New notes go to the latest topic unless you pin another.
- **Bullets**: Enter sends a bullet, Tab nests the next one under it, Shift+Tab steps out. `+` on any point adds a sub-point under it. Pasting an indented list (or Markdown headings) keeps its structure. `**bold**`, `*italic*`, `++underline++`, `~~strike~~`, `==highlight==`, `` `code` ``, `[label](url)` and links render.
- **Tabs**: like Google Docs tabs, separate pages of one doc (Insert → Tab, or `+` in the spine). Each tab has its own topics; the spine lists tabs with the open tab's outline inside. Topics can move between tabs.
- **Pictures**: paste or drop an image into the composer. Images are shrunk in the browser (≤1400px WebP/JPEG) and stored in the database, since the free plan has no file storage.
- **Tour**: an interactive walkthrough opens the first time someone opens a doc; Help → Take the tour replays it.
- **Others' notes**: open a point to jump to the writer's stream, suggest an edit or removal (the author accepts or declines), or add a sub-point. The owner can delete any note. Click anything in a stream to find it in the woven doc, and vice versa.
- **Page style**: document font, text size and line spacing (shared, used for print too).
- **Edit mode**: a final copy of the woven notes you can rewrite like a word processor (headings, fonts, sizes, colors, lists, alignment, links). One editor at a time via a soft lock; others see changes live. New notes can be appended or the copy rebuilt.
- **Import**: `.docx` (Word / Google Docs download), `.html`, `.md`, `.txt`, or rich paste. Google Docs tabs become tabs. Structure is inferred the way a reader sees it: heading styles, big text, page/section breaks and short labels right before lists become topics; lists become nested notes; bold, italic, underline, strikethrough, highlight, links, sub/superscript, tables (one note per row) and pictures carry over; the doc's font and size become the page style. Big docs are written in chunks with progress.
- **Print**: Print / save as PDF produces a plain document (title, byline, headings, bullet lists) from the woven doc or the edited copy.
- **Hashtags**: a `#tag` used by 2+ people becomes a section and pulls those notes in.
- **Weaving** (in each browser, `js/weave.js`): duplicates collapse into one point with a ×N badge, points only one person wrote get a *solo* marker, similar notes with different numbers or dates are flagged, thin sections glow (gap heatmap) and can be claimed. Paraphrases the word matcher misses can be merged by hand.
- **Export**: Markdown with credits, or Print → PDF of the woven page.

## Run locally

```sh
npm run serve        # http://localhost:5173
npm test             # weave logic tests
```

With no Firebase config (`js/config.js` has an empty `apiKey`), or with `?local` in the URL, the app runs in **Local mode**: data lives in this browser's IndexedDB and syncs across tabs. Open a second tab, sign in with a different email, and share docs between them to try everything.

## Connect Firebase

1. Create a project at https://console.firebase.google.com (free Spark plan is enough).
2. **Authentication → Sign-in method**: enable **Google**. Under **Settings → Authorized domains** add `unisonnotes.github.io` (and `localhost` for testing).
3. **Realtime Database**: create a database, then paste `database.rules.json` into the **Rules** tab and publish, or run `npx firebase-tools deploy --only database --project <id>`.
4. **Project settings → Your apps → Web app**: copy the config into `js/config.js` (`apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId`). These values are public by design; the rules are what protect data.
5. Commit and push. GitHub Pages serves the repo root.

## Data model

```
users/{uid}                 name, email, photo, docs/{docId}: role, lastOpened
docs/{docId}
  meta                      title, owner, ownerName, createdAt
  members/{uid}             role (owner | editor | viewer), name, email, photo
  tabs/{id}                 title, createdBy, createdAt, order, parentId? (sub-tab)
  sections/{id}             title, createdBy, createdAt, order, parentId? (subtopic), tabId? (topics only; none = first tab), tag?, claim?
  notes/{id}                author, authorName, text, sectionId, parentId? (sub-point), tags, createdAt, editedAt?
  merges/{noteId}           targetNoteId (hand-merged paraphrases)
  presence/{uid}            name, section, at
  suggestions/{noteId}/{uid} kind (edit | remove), text?, name, at
  style                     font, size, spacing
  draft                     html, basedOn, updatedAt, updatedBy, updatedByName, lock {uid, name, at}
  invites/{emailKey}        email, role (pending invites, shown in the share dialog)
invites/{emailKey}/{docId}  role, invitedBy, title
images/{docId}/{id}         data (data:image/… URL ≤ 2,000,000 chars), w, h, by, at
```

Emails are keys with `.` replaced by `,`. An invite waits under the invitee's email; when they sign in their browser accepts it (adds them to `members`, adds the doc to their list, deletes the invite). Duplicates, conflicts and heat are computed in the browser, never stored.

`database.rules.json` enforces: only members read a doc and its images; only editors/owners write notes and only their own; editors add tabs, topics and images, and change only the ones they made; only the owner shares, changes roles, renames or deletes; you read only your own docs list and the invites for your verified email.

## Layout

```
index.html            entry, import map, theme bootstrap
css/tokens.css        themes (Light, Dark + Tern-inspired alternates)
css/app.css           components, print styles for PDF export
js/app.js             boot, router (#/ and #/d/<id>), invite acceptance
js/store.js           all database reads/writes
js/weave.js           placement, duplicates, conflicts, heat, tabs, structure inference, export
js/importer.js        .docx / .html / .md / .txt → outline with formatting and pictures
js/images.js          shrink, store and lazily load pictures
js/backend/           firebase.js and local.js behind the same adapter
js/ui/                Preact + htm components
vendor/, fonts/       Preact, htm, Geist (vendored, no CDN at runtime)
```

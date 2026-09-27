/**
 * The Drive sync job — every branch of spec D3, against an in-memory Drive.
 * Spec: docs/superpowers/specs/2026-09-25-drive-student-folders-design.md.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'drive-sync-'));
process.env.SITE_URL = 'https://site.test';
const E = await import('../../src/lib/server/entities.ts');
const DB = await import('../../src/lib/server/db.ts');
const M = await import('../../src/lib/server/materials.ts');
const S = await import('../../src/lib/server/drive/store.ts');
const { syncDrive } = await import('../../src/lib/server/drive/sync.ts');

/* Each test gets a fresh fake Drive, so the ids earlier tests recorded
   point at nothing — clear them, or every old lesson reads as "trashed". */
beforeEach(() => { DB.handle().exec('DELETE FROM drive_items'); });

/** What Google's Markdown export gives for the HTML we write — the same
 *  noise the production probe showed (bold headings, "> " list items). */
function exportOf(html) {
  const out = [];
  const tag = /<(h1|h2|li|p)[^>]*>(.*?)<\/\1>/g;
  let m, ordered = false;
  const text = (x) => x.replace(/<\/?(i|b)>/g, (t) => ({ '<i>': '*', '</i>': '*', '<b>': '**', '</b>': '**' }[t]))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const seg of html.split(/(?=<ol|<ul)/)) {
    ordered = seg.startsWith('<ol');
    while ((m = tag.exec(seg))) {
      if (m[1] === 'h1') out.push(`# **${text(m[2])}**`);
      else if (m[1] === 'h2') out.push(`## **${text(m[2])}**`);
      else if (m[1] === 'li') out.push(ordered ? `> 1. ${text(m[2])}` : `> * ${text(m[2])}  `);
      else out.push(text(m[2]));
    }
    tag.lastIndex = 0;
  }
  return out.join('\n\n');
}

/** A Drive that keeps files in memory. `edit(id, md)` is the tutor typing
 *  in Google Docs: new content, later modifiedTime. */
function fakeDrive() {
  let clock = 0;
  const t = () => new Date(Date.UTC(2027, 0, 1, 0, 0, clock++)).toISOString();
  const files = new Map();
  let seq = 0;
  const api = {
    calls: [],
    async createFolder(name, parentId) { const id = `F${++seq}`; files.set(id, { name, parentId, folder: true, modifiedTime: t(), trashed: false }); api.calls.push(['createFolder', name]); return { id, modifiedTime: files.get(id).modifiedTime }; },
    async createDoc(name, html, parentId) { const id = `D${++seq}`; files.set(id, { name, html, parentId, modifiedTime: t(), trashed: false }); api.calls.push(['createDoc', name]); return { id, modifiedTime: files.get(id).modifiedTime }; },
    async updateDoc(id, html) { const f = files.get(id); f.html = html; delete f.md; f.modifiedTime = t(); api.calls.push(['updateDoc', id]); return { modifiedTime: f.modifiedTime }; },
    async meta(id) { const f = files.get(id); return f ? { modifiedTime: f.modifiedTime, trashed: f.trashed } : null; },
    async rename(id, name) { files.get(id).name = name; api.calls.push(['rename', id]); },
    async exportMarkdown(id) { api.calls.push(['export', id]); const f = files.get(id); return f.md ?? exportOf(f.html ?? ''); },
  };
  return { api, files,
    edit(id, md) { const f = files.get(id); f.md = md; f.modifiedTime = t(); },
    /** Google's own post-processing: a later modifiedTime, same content. */
    touch(id) { files.get(id).modifiedTime = t(); },
    trash(id) { files.get(id).trashed = true; } };
}

const PLAN = (title, heading) => JSON.stringify({ title, gradeContext: 'כיתה ט',
  slides: [{ heading, bullets: ['נקודה'] }], examples: [], homework: [], games: { quiz: { title: 'q', subject: 's', questions: [] } } });

let seq = 0;
function lesson({ status = 'ready', plan = true } = {}) {
  seq += 1;
  const a = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
  const s = E.createStudent({ code: `ds${seq}`, name: `תלמידה ${seq}`, accountId: a.id, credential: 'x' });
  const start = `2027-0${1 + (seq % 8)}-1${seq % 9}T10:00:00+02:00`;
  DB.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (?, ?, ?, 90, '2027-01-01', 'confirmed')`)
    .run(s.id, start, start);
  const slug = `lesson-${seq}`;
  DB.createLesson({ slug, student: s.name, subject: 'מתמטיקה', level: 'כיתה ט', topic: 't', lessonAt: start });
  DB.finishLesson(slug, { status, title: `שיעור ${seq}` });
  if (plan) M.addMaterial({ slug, kind: 'plan', content: PLAN(`שיעור ${seq}`, 'שקף מקורי'), origin: 'generated', publish: true });
  return { student: s, slug };
}
/* The fake Drive's clock is in 2027, so "now" defaults to long after any
   edit — every edit is settled — unless a test says otherwise. */
const LATER = () => Date.parse('2030-01-01T00:00:00Z');
const run = (d, extra = {}) => { const told = []; return syncDrive({ api: d.api, notify: (m) => { told.push(m); }, now: LATER, ...extra }).then(r => ({ r, told })); };

test('not configured: nothing happens and it says so', async () => {
  assert.deepEqual(await syncDrive({ api: null, notify: () => {} }), { skipped: 'not configured' });
});

test('first run: root, the student\'s folder, the lesson doc and an index — once', async () => {
  const d = fakeDrive();
  const { slug, student } = lesson();
  await run(d);
  const doc = S.getItem(`lesson:${slug}`);
  assert.ok(doc, 'the lesson has a document');
  assert.match(d.files.get(doc.fileId).html, /שקף מקורי/);
  assert.ok(S.getItem(`student:${student.id}`) && S.getItem(`index:${student.id}`) && S.getItem('root'));
  const before = d.api.calls.length;
  await run(d);
  assert.equal(d.api.calls.filter(c => c[0].startsWith('create')).length, d.api.calls.slice(0, before).filter(c => c[0].startsWith('create')).length,
    'a second run creates nothing (Review Focus 3)');
});

test('a newer published plan updates the document; our own write is not read as her edit', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  M.addMaterial({ slug, kind: 'plan', content: PLAN('x', 'שקף מעודכן'), origin: 'edited', publish: true });
  await run(d);
  assert.match(d.files.get(S.getItem(`lesson:${slug}`).fileId).html, /שקף מעודכן/);
  const drafts = () => M.history(slug, 'plan').filter(v => !v.published_at).length;
  await run(d);
  assert.equal(drafts(), 0, 'no draft appeared from our own update (Review Focus 5)');
});

const DRIVE_EDIT = '# **שיעור ערוך**\n\n## **שקף מדרייב**\n\n> * נקודה חדשה\n';

test('an edit in Drive reaches the student: plan and deck published, and she is told', async () => {
  // Lior, 2026-09-26: Drive edits go straight to the student (full sync).
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  d.edit(S.getItem(`lesson:${slug}`).fileId, DRIVE_EDIT);
  const { told } = await run(d);
  const plan = M.latestPublished(slug, 'plan');
  assert.equal(JSON.parse(plan.content).slides[0].heading, 'שקף מדרייב');
  assert.equal(M.latest(slug, 'plan').version, plan.version, 'published, not a draft');
  assert.match(M.latestPublished(slug, 'slides').content, /שקף מדרייב/, 'the deck the student opens');
  assert.deepEqual(Object.keys(JSON.parse(plan.content).games), ['quiz'], 'games survive, as in the editor');
  assert.equal(told.length, 1);
  assert.match(told[0], /פורסמה לתלמיד/);
  const again = await run(d);
  assert.equal(again.told.length, 0, 'published once, not every run');
  const docId = S.getItem(`lesson:${slug}`).fileId;
  assert.equal(d.api.calls.filter(c => c[0] === 'updateDoc' && c[1] === docId).length, 0,
    'and nothing is pushed back over her document (the index may be rewritten: the title changed)');
});

test('while she is still typing, nothing reaches the student', async () => {
  // Google Docs saves every keystroke. An edit is published only once the
  // document has been left alone for 10 minutes.
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  d.edit(id, DRIVE_EDIT);
  const editedAt = Date.parse((await d.api.meta(id)).modifiedTime);
  const typing = await run(d, { now: () => editedAt + 60_000 });
  assert.equal(typing.r.pulled, 0);
  assert.equal(JSON.parse(M.latestPublished(slug, 'plan').content).slides[0].heading, 'שקף מקורי');
  const settled = await run(d, { now: () => editedAt + 11 * 60_000 });
  assert.equal(settled.r.pulled, 1);
});

test('her Drive edit wins over a newer site publish: nothing is pushed over it', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  d.edit(id, DRIVE_EDIT);
  M.addMaterial({ slug, kind: 'plan', content: PLAN('x', 'פרסום באתר'), origin: 'edited', publish: true });
  await run(d);
  assert.equal(d.api.calls.filter(c => c[0] === 'updateDoc' && c[1] === id).length, 0, 'Review Focus 1');
  assert.equal(JSON.parse(M.latest(slug, 'plan').content).slides[0].heading, 'שקף מדרייב');
  await run(d);
  assert.equal(d.api.calls.filter(c => c[0] === 'updateDoc' && c[1] === id).length, 0,
    'nor on the NEXT pass: the older site version must not replace her text in Drive');
  // Once she publishes (her draft, or anything newer), Drive follows.
  M.addMaterial({ slug, kind: 'plan', content: PLAN('x', 'פורסם אחרי העריכה'), origin: 'edited', publish: true });
  await run(d);
  assert.match(d.files.get(id).html, /פורסם אחרי העריכה/);
});

test('a Drive edit that does not parse into a lesson saves nothing and is reported once', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  d.edit(S.getItem(`lesson:${slug}`).fileId, 'just some text with no headings');
  const versions = M.history(slug, 'plan').length;
  const { told } = await run(d);
  assert.equal(M.history(slug, 'plan').length, versions);
  assert.equal(told.length, 1);
  assert.equal((await run(d)).told.length, 0, 'Review Focus 4');
});

test('a trashed document is recreated once, and she is told', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const old = S.getItem(`lesson:${slug}`).fileId;
  d.trash(old);
  const { told } = await run(d);
  assert.notEqual(S.getItem(`lesson:${slug}`).fileId, old);
  assert.equal(told.length, 1);
  assert.equal((await run(d)).told.length, 0, 'Review Focus 2');
});

test('lessons that did not generate, or have no plan version, are skipped', async () => {
  const d = fakeDrive();
  const failed = lesson({ status: 'failed' });
  const old = lesson({ plan: false });
  await run(d);
  assert.equal(S.getItem(`lesson:${failed.slug}`), null);
  assert.equal(S.getItem(`lesson:${old.slug}`), null);
});

test('two runs at once: the second stands down', async () => {
  const d = fakeDrive();
  lesson();
  const [a, b] = await Promise.all([syncDrive({ api: d.api, notify: () => {} }), syncDrive({ api: d.api, notify: () => {} })]);
  assert.ok([a, b].some(r => r.skipped === 'already running'));
});

test('one lesson failing does not stop the others', async () => {
  const d = fakeDrive();
  const a = lesson(); const b = lesson();
  const create = d.api.createDoc;
  let n = 0;
  d.api.createDoc = async (name, html, p) => { if (html.includes(`שיעור ${a.slug.split('-')[1]}<`) && n++ === 0) throw new Error('drive create doc failed: 500'); return create(name, html, p); };
  const { r } = await run(d);
  assert.ok(S.getItem(`lesson:${b.slug}`));
  assert.ok(r.failed >= 1);
});

test('Google bumping modifiedTime after our own write is not her edit', async () => {
  // Seen on production 2026-09-25: a freshly converted document's
  // modifiedTime moves again seconds AFTER creation, past our re-read. By
  // time alone that read as an edit and would have WhatsApped the tutor.
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  d.touch(S.getItem(`lesson:${slug}`).fileId);
  const versions = M.history(slug, 'plan').length;
  const { told, r } = await run(d);
  assert.equal(r.pulled, 0);
  assert.equal(told.length, 0);
  assert.equal(M.history(slug, 'plan').length, versions, 'no draft from our own content');
  assert.equal((await run(d)).r.pulled, 0, 'and the new time is recorded, so it is not re-examined');
});

test('the same holds after an update pushed from the site', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  M.addMaterial({ slug, kind: 'plan', content: PLAN('x', 'שקף מעודכן'), origin: 'edited', publish: true });
  await run(d);
  d.touch(S.getItem(`lesson:${slug}`).fileId);
  assert.equal((await run(d)).r.pulled, 0);
});

test('after pulling her edit, Google touching the document again does not pull it twice', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  d.edit(id, DRIVE_EDIT);
  assert.equal((await run(d)).told.length, 1);
  d.touch(id);
  const again = await run(d);
  assert.equal(again.r.pulled, 0);
  assert.equal(again.told.length, 0, 'one edit, one message');
});

/* ── Final review, Important 1–3 ─────────────────────────────────────── */

test('a lesson whose slot two students share is written to neither folder', async () => {
  // bookings_v2.start is the only link from a lesson to a student; a slot
  // cancelled by one student and re-booked by another matches both, and the
  // document would land in whichever student is listed first.
  const d = fakeDrive();
  const { slug } = lesson();
  const row = DB.handle().prepare(`SELECT lesson_at FROM lessons WHERE slug = ?`).get(slug);
  const a = E.createAccount({ name: 'other', phone: null, credential: 'x' });
  const other = E.createStudent({ code: `other${seq}`, name: 'אחר', accountId: a.id, credential: 'x' });
  DB.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (?, ?, ?, 90, '2027-01-01', 'confirmed')`)
    .run(other.id, row.lesson_at, row.lesson_at);
  await run(d);
  assert.equal(S.getItem(`lesson:${slug}`), null, 'ambiguous: not guessed at');
});

test('a cancelled booking in the same slot does not make it ambiguous', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  const row = DB.handle().prepare(`SELECT lesson_at FROM lessons WHERE slug = ?`).get(slug);
  const a = E.createAccount({ name: 'gone', phone: null, credential: 'x' });
  const gone = E.createStudent({ code: `gone${seq}`, name: 'ביטלה', accountId: a.id, credential: 'x' });
  DB.handle().prepare(`INSERT INTO bookings_v2 (student_id, start, "end", duration, at, status) VALUES (?, ?, ?, 90, '2027-01-01', 'cancelled')`)
    .run(gone.id, row.lesson_at, row.lesson_at);
  await run(d);
  assert.ok(S.getItem(`lesson:${slug}`));
  assert.equal(S.getItem(`student:${gone.id}`), null);
});

test('a Drive edit that could not be read is never overwritten by a later publish', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  d.edit(id, 'text she typed with no headings');
  await run(d);
  M.addMaterial({ slug, kind: 'plan', content: PLAN('x', 'פרסום אחרי'), origin: 'edited', publish: true });
  await run(d);
  assert.equal(d.files.get(id).md, 'text she typed with no headings', 'her text is the only copy — it stays');
  // Once she fixes it in Drive, it is read and the block lifts.
  d.edit(id, DRIVE_EDIT);
  assert.equal((await run(d)).r.pulled, 1);
});

test('our own write is judged by what Drive exported, not by re-parsing it', async () => {
  // A slide heading that starts with «דוגמה:» parses back as an example —
  // so comparing parsed content would call our own write her edit.
  const d = fakeDrive();
  const { slug } = lesson({ plan: false });
  M.addMaterial({ slug, kind: 'plan', origin: 'generated', publish: true, content: JSON.stringify({
    title: 't', gradeContext: 'g', homework: [], games: {}, examples: [],
    slides: [{ heading: 'דוגמה: שאלה מהמבחן', bullets: ['נקודה'] }] }) });
  await run(d);
  d.touch(S.getItem(`lesson:${slug}`).fileId);
  const { r, told } = await run(d);
  assert.equal(r.pulled, 0);
  assert.equal(told.length, 0);
});

/* Deferred from #132's review, closed 2026-09-28. */

test('a new title on the site renames the Drive file, and the index follows', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  M.addMaterial({ slug, kind: 'plan', content: PLAN('כותרת חדשה', 'שקף'), origin: 'edited', publish: true });
  await run(d);
  assert.equal(d.files.get(id).name, 'כותרת חדשה');
});

test('a title she changes in the document renames the file too', async () => {
  const d = fakeDrive();
  const { slug } = lesson();
  await run(d);
  const id = S.getItem(`lesson:${slug}`).fileId;
  d.edit(id, DRIVE_EDIT);
  await run(d);
  assert.equal(d.files.get(id).name, 'שיעור ערוך');
});

test('a trashed index comes back on the next pass, without waiting for a lesson change', async () => {
  const d = fakeDrive();
  const { student } = lesson();
  await run(d);
  const idx = S.getItem(`index:${student.id}`).fileId;
  d.trash(idx);
  await run(d);
  assert.notEqual(S.getItem(`index:${student.id}`).fileId, idx);
});

test('each folder is checked once per pass, however many lessons it holds', async () => {
  const d = fakeDrive();
  lesson(); lesson(); lesson();
  const metas = [];
  const meta = d.api.meta;
  d.api.meta = async (id) => { metas.push(id); return meta(id); };
  await run(d);
  const root = S.getItem('root').fileId;
  assert.ok(metas.filter(id => id === root).length <= 1, `root checked ${metas.filter(id => id === root).length} times`);
});

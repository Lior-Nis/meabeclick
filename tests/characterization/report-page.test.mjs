import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

/**
 * Books, plans, and ages the booking into the past so it is reportable.
 *
 * Aged two days behind the real clock, not to a fixed calendar date: the
 * dashboard queue this file also exercises (`lessonsAwaitingReport`) only
 * looks back 14 days from `new Date()` at request time, so a hardcoded past
 * date works today and silently drops out of that window as real time moves
 * on. Two days back is comfortably in the past (report filing only needs
 * the lesson to have ended) and comfortably inside the 14-day queue window
 * on every run, however long after this file was written.
 */
async function pastLesson(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  await fetch(`${baseUrl}/api/plans`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות' }),
  });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const start = new Date(Date.now() - TWO_DAYS_MS).toISOString();
  const end = new Date(Date.now() - TWO_DAYS_MS + 90 * 60 * 1000).toISOString();
  db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = ?`).run(start, end);
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();
  return { booked, cookie, bookingId };
}

test('the report page needs a tutor session', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId } = await pastLesson(baseUrl, dbPath);
    const anon = await fetch(`${baseUrl}/app/report/${bookingId}`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.match(anon.headers.get('location'), /^\/login\?next=/);

    const family = await familySession(booked.portal.link);
    const asFamily = await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: family }, redirect: 'manual' });
    assert.equal(asFamily.status, 302);
  } finally { await stop(); }
});

test('the form names the lesson and offers the plan’s skills', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /יובל כהן/);
    assert.match(html, /מתמטיקה/);
    assert.match(html, /מה עברתם/);
    assert.match(html, /חוקי חזקות|נגזרת|פונקציה/, 'at least one real skill from the template');
  } finally { await stop(); }
});

test('a cancelled lesson shows an explanation, not a fillable form', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE bookings_v2 SET status = 'cancelled' WHERE id = ?`).run(bookingId);
    db.close();

    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /בוטל/, 'names the lesson as cancelled');
    assert.doesNotMatch(html, /<textarea/, 'no note box — nothing here can ever be submitted');
    assert.doesNotMatch(html, /מה עברתם/, 'the skill-ticking section is not rendered either');
  } finally { await stop(); }
});

test('a future lesson shows an explanation, not a fillable form', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl); // booked in 2027 — never aged into the past
    const cookie = await login(baseUrl);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.close();

    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /טרם הסתיים|לא הסתיים/, 'names the lesson as not yet ended');
    assert.doesNotMatch(html, /<textarea/, 'no note box for a lesson that has not happened yet');
    assert.doesNotMatch(html, /מה עברתם/);
  } finally { await stop(); }
});

test('an unknown lesson is a 404', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/app/report/999999`, { headers: { Cookie: cookie } })).status, 404);
  } finally { await stop(); }
});

test('the dashboard lists lessons awaiting a report, and stops once one is filed', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);

    const before = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(before, /מחכים לדיווח|מחכה לדיווח/);
    assert.match(before, new RegExp(`/app/report/${bookingId}`));

    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'דווח', entries: [] }),
    });

    const after = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.doesNotMatch(after, new RegExp(`/app/report/${bookingId}`), 'a reported lesson leaves the queue');
  } finally { await stop(); }
});

test('the queue banner uses the singular for exactly one pending lesson', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie } = await pastLesson(baseUrl, dbPath);
    const html = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /שיעור אחד מחכה לדיווח/, 'one lesson gets the singular form');
    assert.doesNotMatch(html, /1 שיעורים/, 'never "1 שיעורים" — the plural noun with a singular count');
  } finally { await stop(); }
});

test('a filed report is shown for correction, not as a blank form', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'נתקעה בשברים', entries: [] }),
    });
    const html = await (await fetch(`${baseUrl}/app/report/${bookingId}`, { headers: { Cookie: cookie } })).text();
    // Matched against the textarea's OWN captured contents, not the whole
    // document: the page also embeds `data` (including the note) in its
    // hydration payload further down the HTML, so a bare `assert.match(html, ...)`
    // would pass even if the textarea itself rendered empty — it did, once,
    // and this test still went green. See the fix-round-1 report for the
    // failing-first proof.
    const textarea = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/);
    assert.ok(textarea, 'a note textarea is rendered');
    assert.match(textarea[1], /נתקעה בשברים/, 'the note she filed appears inside the textarea itself');
    assert.match(html, /תיקון/, 'the button says it corrects');
  } finally { await stop(); }
});

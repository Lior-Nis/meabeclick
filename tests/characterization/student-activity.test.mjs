// The endpoint the tutor's student card is now built from.
//
// The card used to read and write a localStorage blob (`tutor_dashboard_v2`),
// so the same student could show different figures in different browsers.
// Profile moved to the server in #59 and the activity layer — next lesson,
// payments, homework, lessons — followed in 5f1fac0. This endpoint is what
// that move landed on, and nothing tested it.
//
// Verified in a browser on 2026-09-21 with localStorage deliberately empty:
// both families, their payments, next lessons and homework all render, and
// localStorage stays empty across a reload. These pin the contract that
// makes that true, plus the two authorization properties the browser check
// cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'family-a@example.com', durationMin: 90,
    start: '2027-04-12T10:00:00+03:00', end: '2027-04-12T11:30:00+03:00', ...over,
  }),
}).then(r => r.json());

const SIBLINGLESS_B = {
  name: 'נועה לוי', email: 'family-b@example.com', subject: 'פיזיקה',
  level: 'כיתה ז', phone: '0529998888', durationMin: 45,
  start: '2027-04-13T09:00:00+03:00', end: '2027-04-13T09:45:00+03:00',
};

const activity = (baseUrl, code, cookie) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, {
    headers: cookie ? { Cookie: cookie } : {}, cache: 'no-store',
  });

const post = (baseUrl, code, cookie, body) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });

test('a student card carries no data to anyone without a tutor session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    // The card is the tutor's private view of a child: payments, homework,
    // next lesson. A family session must not open it either — only the
    // tutor's.
    assert.equal((await activity(baseUrl, a.portal.code, null)).status, 401);
    assert.equal((await activity(baseUrl, a.portal.code, 'maab_session=forged')).status, 401);
  } finally { await stop(); }
});

test('the card is served from the server, not from whatever the browser remembers', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);

    await fetch(`${baseUrl}/api/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        studentCode: a.portal.code, date: '2027-04-12', kind: 'double',
        amountAgorot: 21500, paid: true, note: 'שיעור ראשון',
      }),
    });
    await post(baseUrl, a.portal.code, cookie, { kind: 'homework', task: 'תרגילים 1-5', date: '2027-04-19' });

    const view = await (await activity(baseUrl, a.portal.code, cookie)).json();

    // The booking is the source of "next lesson" — not a field the tutor
    // retyped into her own browser.
    assert.equal(view.nextLesson.date, '2027-04-12');
    assert.equal(view.nextLesson.time, '10:00');
    assert.equal(view.nextLesson.type, 'כפול', '90 minutes is a double');

    assert.ok(view.sessions.some(s => s.amount === 215 && s.paid), 'the paid lesson must come back');
    assert.deepEqual(view.homework.map(h => h.task), ['תרגילים 1-5']);
  } finally { await stop(); }
});

test('the card lists the student\'s actual lessons', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);

    /* Generation is off in the harness, so write the row the way generation
       does — into the LEGACY `lessons` table, carrying the booked time.
       That is the point of the test: this list used to be read from
       lessons_v2, which nothing writes, so it was empty for every student
       while finished lessons sat in the other table. An empty list is
       indistinguishable from "no lessons yet", which is why it went
       unnoticed. */
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const booking = db.prepare('SELECT start FROM bookings_v2 ORDER BY id DESC LIMIT 1').get();
    db.prepare(`INSERT INTO lessons (slug, student, subject, level, topic, title, at, lesson_at, status)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('demo-lesson', 'יובל כהן', 'מתמטיקה', 'כיתה ט', 'שברים', 'חזרה על שברים',
           new Date().toISOString(), booking.start, 'ready');
    db.close();

    const view = await (await activity(baseUrl, a.portal.code, cookie)).json();
    const mine = view.lessons.find(l => l.slug === 'demo-lesson');
    assert.ok(mine, 'the lesson generation wrote must appear on the card');
    assert.equal(mine.title, 'חזרה על שברים');
    assert.equal(mine.status, 'ready');
  } finally { await stop(); }
});

test('a lesson is attributed by booking, never by the student\'s name', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    // A second child with the SAME display name on a different account —
    // production really does have two students called נוגה, and a name
    // match would put one family's lesson on the other's card.
    const b = await book(baseUrl, { email: 'namesake@example.com', phone: '0527778888',
      start: '2027-09-06T09:00:00+03:00', end: '2027-09-06T09:45:00+03:00', durationMin: 45 });
    assert.notEqual(a.portal.code, b.portal.code);
    const cookie = await login(baseUrl);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const bookingB = db.prepare('SELECT start FROM bookings_v2 ORDER BY id DESC LIMIT 1').get();
    db.prepare(`INSERT INTO lessons (slug, student, subject, level, topic, title, at, lesson_at, status)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('belongs-to-b', 'יובל כהן', 'מתמטיקה', 'כיתה ט', 'שברים', 'של ב בלבד',
           new Date().toISOString(), bookingB.start, 'ready');
    db.close();

    const viewA = await (await activity(baseUrl, a.portal.code, cookie)).json();
    assert.ok(!viewA.lessons.some(l => l.slug === 'belongs-to-b'),
      'same name, different child — the booking is what decides');

    const viewB = await (await activity(baseUrl, b.portal.code, cookie)).json();
    assert.ok(viewB.lessons.some(l => l.slug === 'belongs-to-b'));
  } finally { await stop(); }
});

test('one family\'s activity never appears on another family\'s card', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const b = await book(baseUrl, SIBLINGLESS_B);
    const cookie = await login(baseUrl);

    await post(baseUrl, a.portal.code, cookie, { kind: 'homework', task: 'רק של משפחה א', date: '2027-04-19' });

    const viewB = await (await activity(baseUrl, b.portal.code, cookie)).json();
    assert.equal(viewB.homework.length, 0, 'family B was set no homework');
    assert.equal(viewB.nextLesson.date, '2027-04-13', 'and keeps its own booking');
    assert.ok(!viewB.sessions.some(s => s.notes === 'שיעור ראשון'));
  } finally { await stop(); }
});

test('homework belonging to another student cannot be marked or deleted', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const b = await book(baseUrl, SIBLINGLESS_B);
    const cookie = await login(baseUrl);

    const afterAdd = await (await post(baseUrl, a.portal.code, cookie,
      { kind: 'homework', task: 'של א בלבד', date: '2027-04-19' })).json();
    const idOfA = Number(afterAdd.homework[0].id);

    /* The id is a plain integer in the URL/body, so "which student does this
       row belong to" has to be checked rather than assumed from the path.
       Without it, the path names one child and the id edits another's. */
    const patched = await fetch(`${baseUrl}/api/students/${b.portal.code}/activity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'homework', id: idOfA, grade: 'ok' }),
    });
    assert.equal(patched.status, 404, 'B\'s path must not reach A\'s homework');

    const deleted = await fetch(`${baseUrl}/api/students/${b.portal.code}/activity?id=${idOfA}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });
    assert.equal(deleted.status, 404);

    // And A's row is untouched by either attempt.
    const viewA = await (await activity(baseUrl, a.portal.code, cookie)).json();
    assert.equal(viewA.homework.length, 1);
    assert.equal(viewA.homework[0].graded, false);
    assert.equal(viewA.homework[0].submitted, false);
  } finally { await stop(); }
});

// Filing a report is the one write in the product that records a judgement
// about a child from outside the plan page, so these pin who may do it and
// what a malformed one does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const post = (url, body, cookie) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

/** A child's own session, which is what /app/student serves — a parent's
 *  account-level session is redirected to /app/parent instead. Mirrors
 *  sign-out.test.mjs's studentSession helper. */
async function studentSession(baseUrl, parentCookie, code) {
  const share = await (await fetch(`${baseUrl}/api/student-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
    body: JSON.stringify({ code }),
  })).json();
  return familySession(share.link);
}

/** Books a lesson IN THE PAST (so it is reportable), creates a plan, and
 *  returns the ids the tests need. The booking API refuses a past slot, so
 *  the row is aged with a direct UPDATE through the test's own DB path. */
async function pastLesson(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const created = await (await post(`${baseUrl}/api/plans`, {
    code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
  }, cookie)).json();

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z'`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();

  const skill = created.tree[0].branches[0].skills[0];
  return { booked, cookie, bookingId, skill, planId: created.plan.id };
}

/** Books a lesson in the past with NO enrollment on it at all — migration
 *  006's shape for a student with more than one subject, where the booking
 *  cannot be resolved to one enrollment. */
async function pastLessonWithNoEnrollment(baseUrl, dbPath) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.prepare(`UPDATE bookings_v2 SET start = '2026-01-05T10:00:00.000Z', "end" = '2026-01-05T11:30:00.000Z', enrollment_id = NULL`).run();
  const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  db.close();

  return { booked, cookie, bookingId };
}

test('the tutor files a report and the plan moves', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, {
      bookingId, note: 'נתקעה בשברים', entries: [{ nodeId: skill.id, status: 'guided' }],
    }, cookie);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.report.note, 'נתקעה בשברים');
    assert.equal(body.tree[0].branches[0].skills[0].status, 'guided');
    const written = body.events.filter(e => e.type === 'status');
    assert.equal(written.length, 1);
    assert.equal(written[0].source, 'report');
  } finally { await stop(); }
});

test('a note-only report is accepted', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLesson(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'שיחה בלבד', entries: [] }, cookie);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).report.note, 'שיחה בלבד');
  } finally { await stop(); }
});

test('a note-only report on an enrollment-less booking succeeds (item 1)', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLessonWithNoEnrollment(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'שיחה בלבד', entries: [] }, cookie);
    assert.equal(res.status, 200, 'a note-only report must land, not 500');
    assert.equal((await res.json()).report.note, 'שיחה בלבד');
  } finally { await stop(); }
});

test('the same enrollment-less booking with an entry is a 400, never a 500', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId } = await pastLessonWithNoEnrollment(baseUrl, dbPath);
    const res = await post(`${baseUrl}/api/reports`, {
      bookingId, note: null, entries: [{ nodeId: 1, status: 'guided' }],
    }, cookie);
    assert.equal(res.status, 400, 'no plan exists to validate the entry against');
    const body = await res.json();
    assert.doesNotMatch(JSON.stringify(body), new RegExp(String(bookingId)), 'the booking id must not leak into the response');
  } finally { await stop(); }
});

test('a lesson that has not happened yet cannot be reported', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
    }, cookie);
    // The booking is in 2027 and was never aged.
    const res = await post(`${baseUrl}/api/reports`, { bookingId: 1, note: 'מוקדם מדי', entries: [] }, cookie);
    assert.equal(res.status, 400);
  } finally { await stop(); }
});

test('a lesson recorded with a non-UTC offset end can be reported once it has passed', async () => {
  // /api/book stores start/end with the client's original offset, not
  // normalized to UTC. A naive string comparison against `new
  // Date().toISOString()` (always "Z") reads an offset-formatted end as
  // still in the future whenever its digits happen to sort later — exactly
  // what a true instant a couple of hours ago, expressed in +03:00, does.
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'בגרות',
    }, cookie);

    const offsetIso = (d, offsetHours = 3) =>
      `${new Date(d.getTime() + offsetHours * 3600 * 1000).toISOString().replace('Z', '')}+${String(offsetHours).padStart(2, '0')}:00`;
    const trueEnd = new Date(Date.now() - 2 * 60 * 60 * 1000);   // 2h ago, truly
    const trueStart = new Date(trueEnd.getTime() - 90 * 60 * 1000);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = ?`).run(offsetIso(trueStart), offsetIso(trueEnd));
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.close();

    const res = await post(`${baseUrl}/api/reports`, { bookingId, note: 'הסתיים לפני שעתיים', entries: [] }, cookie);
    assert.equal(res.status, 200, 'a lesson that truly ended must not read as still in progress');
  } finally { await stop(); }
});

test('malformed entries are refused, and nothing is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { cookie, bookingId, skill } = await pastLesson(baseUrl, dbPath);
    const url = `${baseUrl}/api/reports`;

    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id, status: 'mastered' }] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: skill.id }] }, cookie)).status, 400, 'a ticked skill with no status');
    assert.equal((await post(url, { bookingId, note: 'x'.repeat(2001), entries: [] }, cookie)).status, 400);
    assert.equal((await post(url, { bookingId: 999999, entries: [] }, cookie)).status, 404);
    assert.equal((await post(url, { bookingId, entries: [{ nodeId: 999999, status: 'guided' }] }, cookie)).status, 404);

    // After every refusal, the lesson is still unreported.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM lesson_reports`).get().n, 0);
    db.close();
  } finally { await stop(); }
});

test("a node from another student's plan is refused", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const mine = await pastLesson(baseUrl, dbPath);
    const theirs = await book(baseUrl, {
      name: 'דנה לוי', email: 'dana@example.com',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00',
    });
    const other = await (await post(`${baseUrl}/api/plans`, {
      code: theirs.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'בגרות',
    }, mine.cookie)).json();
    const foreign = other.tree[0].branches[0].skills[0];

    const res = await post(`${baseUrl}/api/reports`, {
      bookingId: mine.bookingId, entries: [{ nodeId: foreign.id, status: 'guided' }],
    }, mine.cookie);
    assert.equal(res.status, 404, "one lesson's report may not move another student's plan");
  } finally { await stop(); }
});

test('filing is tutor-only', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    const family = await familySession(booked.portal.link);
    for (const who of [undefined, family]) {
      assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, who)).status, 401);
    }
    assert.equal((await post(`${baseUrl}/api/reports`, { bookingId, entries: [] }, cookie)).status, 200);
  } finally { await stop(); }
});

test('no report reaches the family', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { booked, bookingId, cookie } = await pastLesson(baseUrl, dbPath);
    await post(`${baseUrl}/api/reports`, { bookingId, note: 'הערה פנימית', entries: [] }, cookie);
    const family = await familySession(booked.portal.link);
    const student = await studentSession(baseUrl, family, booked.portal.code);

    for (const { url, session } of [
      { url: `${baseUrl}/api/portal/${booked.portal.code}?kind=parent`, session: family },
      { url: `${baseUrl}/api/portal/${booked.portal.code}?kind=student`, session: family },
      { url: `${baseUrl}/app/parent`, session: family },
      { url: `${baseUrl}/app/student?s=${booked.portal.code}`, session: student },
    ]) {
      const text = await (await fetch(url, { headers: { Cookie: session } })).text();
      assert.doesNotMatch(text, /הערה פנימית/, `${url} leaked the report note`);
    }
  } finally { await stop(); }
});

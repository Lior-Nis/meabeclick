// tests/characterization/enrollment-isolation.test.mjs
//
// Enrollment writes the right rows, and a family can only ever reach its
// own. These are the scenarios the account/student model was built for
// (docs/superpowers/specs/2026-08-29-data-model-design.md) that no other
// file pins end to end: sibling on one account, a self-paying adult, name
// and code collisions, cross-family denial with a REAL other session,
// double submission, malformed email, a tampered link.
//
// Every assertion on "how many rows" reads the temp SQLite directly; a
// response saying ok proves nothing about what was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession, login } from './harness.mjs';

const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
});

const SIBLING = {
  name: 'נועה כהן', subject: 'פיזיקה', level: 'כיתה ז', durationMin: 45,
  start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T10:45:00+02:00',
};

const OTHER_FAMILY = {
  name: 'דנה לוי', email: 'dana@example.com', phone: '0529876543',
  start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00',
};

/** Row counts of every entity table, in one shot. */
function counts(dbPath) {
  const db = new DatabaseSync(dbPath);
  const n = t => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  const out = {
    accounts: n('accounts'), students: n('students_v2'), enrollments: n('enrollments'),
    bookings: n('bookings_v2'), payments: n('payments'),
  };
  db.close();
  return out;
}

function rows(dbPath, sql) {
  const db = new DatabaseSync(dbPath);
  const out = db.prepare(sql).all();
  db.close();
  return out;
}

const studentLink = (baseUrl, cookie, code) => fetch(`${baseUrl}/api/student-link`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ code }),
});

test('a second child on the same account adds one student, not one family', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const first = await (await book(baseUrl)).json();
    // The second child is booked by the parent, signed in: a booking by
    // email alone no longer hands anyone that family's details (see
    // booking-link-leak.test.mjs).
    const parentSession = await familySession(first.portal.link);
    const second = await (await book(baseUrl, SIBLING, { Cookie: parentSession })).json();

    assert.deepEqual(counts(dbPath), { accounts: 1, students: 2, enrollments: 2, bookings: 2, payments: 2 });
    const students = rows(dbPath, 'SELECT code, name, account_id FROM students_v2 ORDER BY id');
    assert.equal(students[0].account_id, students[1].account_id, 'both children hang off one account');
    assert.notEqual(students[0].code, students[1].code);

    // A link minted for child A opens A and only A.
    const parent = parentSession;
    const share = await (await studentLink(baseUrl, parent, first.portal.code)).json();
    const childA = await familySession(share.link);
    assert.equal((await fetch(`${baseUrl}/api/portal/${first.portal.code}`, { headers: { Cookie: childA } })).status, 200, 'own board');
    assert.equal((await fetch(`${baseUrl}/api/portal/${second.portal.code}`, { headers: { Cookie: childA } })).status, 401, "the sibling's board");
  } finally { await stop(); }
});

test('an adult self-learner is one account flagged self, one student, and lands on the board', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await book(baseUrl, { name: 'רון אברהם', email: 'ron@example.com', isSelf: true });
    assert.equal(r.status, 200);
    const { portal } = await r.json();

    assert.deepEqual(counts(dbPath), { accounts: 1, students: 1, enrollments: 1, bookings: 1, payments: 1 });
    const [account] = rows(dbPath, 'SELECT is_self, email FROM accounts');
    assert.equal(account.is_self, 1, 'the account is marked self-paying');
    assert.equal(account.email, 'ron@example.com');

    // The magic link opens the learner's own board directly — there is no
    // parent view for an account that is its own student.
    const enter = await fetch(portal.link, { redirect: 'manual' });
    assert.equal(enter.status, 303);
    assert.match(enter.headers.get('location'), /^\/app\/student\?s=/, `self-learner must land on the board, got ${enter.headers.get('location')}`);

    const cookie = await familySession(portal.link);
    assert.equal((await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: cookie } })).status, 200);
  } finally { await stop(); }
});

test('the same first name in two families is two students with two codes, each invisible to the other', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const a = await (await book(baseUrl, { name: 'יובל כהן', email: 'orit@example.com' })).json();
    const b = await (await book(baseUrl, { name: 'יובל לוי', email: 'dana@example.com',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T11:30:00+02:00' })).json();

    assert.deepEqual(counts(dbPath), { accounts: 2, students: 2, enrollments: 2, bookings: 2, payments: 2 });
    assert.notEqual(a.portal.code, b.portal.code, 'a shared first name must not share a code');
    /* No longer a numeric suffix, and deliberately so: an address is drawn
       fresh rather than derived from the name. `${code}2` sitting next to
       `${code}` tells anyone holding one link that the other exists, and a
       name-derived address collides for every pair of children whose names
       share a consonant skeleton — מאיה and מיה both reduced to "mi".
       What matters is that the two are distinct and neither is guessable
       from the other. */
    assert.doesNotMatch(b.portal.code, new RegExp(`^${a.portal.code}`),
      'the second address must not be the first with something appended');
    for (const c of [a.portal.code, b.portal.code]) {
      assert.ok(c.length >= 3, `${c} is too short to be an address`);
      assert.match(c, /^[a-z0-9-]+$/);
    }

    const cookieA = await familySession(a.portal.link);
    const cookieB = await familySession(b.portal.link);
    assert.equal((await fetch(`${baseUrl}/api/portal/${b.portal.code}`, { headers: { Cookie: cookieA } })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/portal/${a.portal.code}`, { headers: { Cookie: cookieB } })).status, 401);
  } finally { await stop(); }
});

test('a requested code that is already taken does not take it over', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const a = await (await book(baseUrl, { code: 'star' })).json();
    assert.equal(a.portal.code, 'star');
    const before = rows(dbPath, 'SELECT id, code, name, account_id FROM students_v2');

    const b = await (await book(baseUrl, { ...OTHER_FAMILY, code: 'star' })).json();
    /* The second family asked for a code that is taken. They get a different
       one — the mechanism is a fresh draw rather than `star2`, because a
       suffix leaks that `star` exists to whoever holds the new link. The
       property under test is that the request never becomes a takeover. */
    assert.notEqual(b.portal.code, 'star', 'a taken code must never be handed over twice');
    assert.doesNotMatch(b.portal.code, /^star/, 'and must not advertise the one it collided with');

    const after = rows(dbPath, 'SELECT id, code, name, account_id FROM students_v2 ORDER BY id');
    assert.deepEqual(after[0], before[0], 'the first student row is byte-identical');
    assert.equal(after.length, 2);
  } finally { await stop(); }
});

test("a real session from one family is refused another family's student, link and roster", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await (await book(baseUrl)).json();
    const theirs = await (await book(baseUrl, OTHER_FAMILY)).json();
    const cookie = await familySession(mine.portal.link);
    const H = { Cookie: cookie };

    // The other family's student: every view of it.
    for (const q of ['', '?kind=parent', '?kind=student']) {
      const r = await fetch(`${baseUrl}/api/portal/${theirs.portal.code}${q}`, { headers: H });
      assert.equal(r.status, 401, `portal ${q || '(default)'} must be denied`);
    }
    // Minting a child link for their student.
    assert.equal((await studentLink(baseUrl, cookie, theirs.portal.code)).status, 401);
    // The tutor-only roster and ledger, with a family cookie.
    assert.equal((await fetch(`${baseUrl}/api/students`, { headers: H })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/payments?student=${theirs.portal.code}`, { headers: H })).status, 401);

    // And the same calls for my own child succeed — so the denials above
    // are authorization, not a broken endpoint.
    assert.equal((await fetch(`${baseUrl}/api/portal/${mine.portal.code}?kind=parent`, { headers: H })).status, 200);
    assert.equal((await studentLink(baseUrl, cookie, mine.portal.code)).status, 200);
  } finally { await stop(); }
});

test('the same booking submitted twice at once writes one of everything', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const [a, b] = await Promise.all([book(baseUrl), book(baseUrl)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], 'one wins the hour, one is told it is taken');
    assert.deepEqual(counts(dbPath), { accounts: 1, students: 1, enrollments: 1, bookings: 1, payments: 1 });
  } finally { await stop(); }
});

test('a retry for a different hour reuses the account and student and adds one booking', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    const again = await book(baseUrl, { start: '2027-03-22T10:00:00+02:00', end: '2027-03-22T11:30:00+02:00' });
    assert.equal(again.status, 200);
    assert.deepEqual(counts(dbPath), { accounts: 1, students: 1, enrollments: 1, bookings: 2, payments: 2 });
  } finally { await stop(); }
});

test('a malformed email is refused before anything is written', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    for (const email of ['orit@', 'not-an-email', '   ', 'orit@example.com@twice']) {
      const r = await book(baseUrl, { email });
      assert.notEqual(r.status, 200, `"${email}" must not book`);
    }
    assert.deepEqual(counts(dbPath), { accounts: 0, students: 0, enrollments: 0, bookings: 0, payments: 0 });
  } finally { await stop(); }
});

test('a tampered magic link signs nobody in and lands on the expired notice', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await (await book(baseUrl)).json();
    const url = new URL(portal.link);
    const token = url.searchParams.get('t');
    assert.ok(token, 'the link carries a token');
    url.searchParams.set('t', token.slice(0, -2) + 'xx');

    const r = await fetch(url, { redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), '/portal?expired=1');
    assert.ok(!r.headers.getSetCookie().some(c => c.startsWith('maab_family=')), 'no session cookie for a tampered link');
  } finally { await stop(); }
});

// tests/characterization/booking.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, login, familySession } from './harness.mjs';

// The repo's own portal/ directory — never where a test's fabricated
// bookings should land. See server/enroll.mjs's PORTAL_DIR override. It is
// no longer tracked (student records left git on 2026-09-25), so a fresh
// checkout has no such directory at all: absent counts as empty, and a
// booking that created it would still show up as new entries.
const REAL_PORTAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'portal');
const portalEntries = () => existsSync(REAL_PORTAL_DIR) ? readdirSync(REAL_PORTAL_DIR).sort() : [];

/** A fixed future slot. Dates are literals so the test never depends on "now". */
const SLOT = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T10:45:00+02:00' };

// `email` is required since the family-access rebuild: it is the address
// the portal link is sent to, and identity for a returning family. See the
// 'booking-requires-email' entry in expected-changes.mjs.
const booking = (over = {}) => ({
  name: 'דנה כהן', subject: 'מתמטיקה', request: 'פונקציות',
  phone: '0501234567', email: 'dana@example.com', level: 'כיתה י', durationMin: 45,
  ...SLOT, ...over,
});

test('rejects a booking missing required fields', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'דנה' }),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'חסרים פרטים' });
  } finally { await stop(); }
});

test('books an hour and falls back to email when no calendar is configured', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, false, 'no service account → not a calendar write');
    assert.equal(body.fallback, true);
    assert.equal(body.emailed, false, 'no GMAIL_* → email skipped, not attempted');
    assert.equal(body.familyEmailed, false, 'the family email is skipped for the same reason');

    // The handoff is what the success screen renders, and it must be
    // present even when mail is unavailable — an unreachable family is the
    // exact failure this replaced.
    assert.ok(body.portal, 'a booking must hand back a portal link');
    assert.ok(body.portal.link.includes('/enter?t='), 'the handoff must be a magic link');
    assert.equal(body.portal.studentName, 'דנה כהן');
    assert.equal(body.portal.isNewFamily, true);

    // A booking that never records which enrollment it is for can never be
    // reported on later (the lesson-report feature resolves its plan
    // through this exact column) — assert it directly here, where the
    // booking is made, rather than three features downstream.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`SELECT enrollment_id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();
    assert.ok(row.enrollment_id != null, 'a booking must record which enrollment it belongs to');
  } finally { await stop(); }
});

test("a parent's lesson request is persisted with its source, linked to the booking and student", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ request: 'לתרגל משוואות ריבועיות לקראת המבחן' })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT id, student_id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    const row = db.prepare(`SELECT * FROM lesson_requests ORDER BY id DESC LIMIT 1`).get();
    db.close();

    assert.ok(row, 'the request must be persisted, not survive only in an email');
    assert.equal(row.source, 'parent');
    assert.equal(row.text, 'לתרגל משוואות ריבועיות לקראת המבחן');
    assert.equal(row.booking_id, b.id);
    assert.equal(row.student_id, b.student_id);
  } finally { await stop(); }
});

test('an empty request writes no lesson_requests row', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ request: '' })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM lesson_requests`).get().n;
    db.close();
    assert.equal(count, 0, 'an empty request must not be recorded as if it were a real one');
  } finally { await stop(); }
});

test('a non-string request does not 500 the booking — it succeeds and stores the coerced text', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    // BookBody is only a compile-time shape over an unvalidated JSON body,
    // and isComplete() never inspects request/topic — a bare `.trim()` on
    // this used to throw mid-booking, after the family was already
    // enrolled and the hour claimed, leaving a cancelled booking and a
    // voided charge behind a 500. It must not, for an optional field.
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ request: 5 })),
    });
    assert.equal(r.status, 200, 'a non-string request must not crash the booking');
    const responseBody = await r.json();
    assert.equal(responseBody.ok, false, 'no service account → fallback path, same as any other booking');

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT id, status FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    const row = db.prepare(`SELECT text FROM lesson_requests ORDER BY id DESC LIMIT 1`).get();
    db.close();

    assert.equal(b.status, 'confirmed', 'the booking must not be cancelled for an optional field');
    assert.ok(row, 'the coerced request must still be recorded');
    assert.equal(row.text, '5', 'String(b.request) is what gets stored, not a thrown error');
  } finally { await stop(); }
});

test("an older client still sending `topic` is accepted as a deprecated alias for the request", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const rest = booking();
    delete rest.request;
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, topic: 'נגזרות' }),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`SELECT text, source FROM lesson_requests ORDER BY id DESC LIMIT 1`).get();
    db.close();
    assert.equal(row.text, 'נגזרות', 'a pre-rename client posting `topic` must not lose the note');
    assert.equal(row.source, 'parent');
  } finally { await stop(); }
});

test('a booking with no email is refused rather than enrolling an unreachable family', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { email, ...noEmail } = booking();
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(noEmail),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /מייל/);
  } finally { await stop(); }
});

test('booking twice with the same email is one family, not two', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const post = (over, cookie) => fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(booking(over)),
    }).then(r => r.json());

    // Same child, same address in a different case — the returning-family
    // path that used to depend on a "have you booked before?" toggle
    // defaulting to "no", and on a globally unique password. Booked signed
    // in: a booking by email alone no longer hands over the family's
    // details (booking-link-leak.test.mjs).
    const first = await post({});
    const session = await familySession(first.portal.link);
    const second = await post({
      email: 'DANA@Example.com  ',
      start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T10:45:00+02:00',
    }, session);
    assert.equal(second.portal.code, first.portal.code, 'a returning family must not fork into a second student');
    assert.equal(second.portal.isNewFamily, false);

    // A sibling on the same account is a new student, not a new family.
    const sibling = await post({
      name: 'יונתן כהן',
      start: '2027-03-17T10:00:00+02:00', end: '2027-03-17T10:45:00+02:00',
    }, session);
    assert.notEqual(sibling.portal.code, first.portal.code);
    assert.equal(sibling.portal.isNewFamily, false);

    // And one link reaches both children.
    const cookie = await familySession(first.portal.link);
    for (const code of [first.portal.code, sibling.portal.code]) {
      const r = await fetch(`${baseUrl}/api/portal/${code}`, { headers: { Cookie: cookie } });
      assert.equal(r.status, 200, `the account link must open ${code}`);
    }
  } finally { await stop(); }
});

test('the same hour cannot be booked twice', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ name: 'יוסי לוי', phone: '0527654321' })),
    });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'השעה הזו כבר תפוסה' });
  } finally { await stop(); }
});

test('two simultaneous bookings of one hour produce exactly one winner', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const post = name => fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ name })),
    });

    const [a, b] = await Promise.all([post('הורה א'), post('הורה ב')]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one booking must win the hour');
  } finally { await stop(); }
});

test('a booking writes no files into the real portal directory', async () => {
  const before = portalEntries();
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);
  } finally { await stop(); }
  const after = portalEntries();
  assert.deepEqual(after, before, 'a booking must never write into the tracked portal/ directory');
});

// ── Attribution (marketing funnel, task 3) ──────────────────────────────
//
// The booking's own `attribution` (first-touch UTM + visitorId, sent by
// src/lib/marketing.ts's attribution()) and `heardFrom` (the optional
// self-report question) land on the bookings_v2 row itself, and the
// server writes its own `lesson_scheduled` event carrying that SAME
// attribution — see the doc comment on the recordEvent call in
// src/routes/api/book/+server.ts for why that write is guarded rather than
// transactional with the booking insert.

// 36 hex/dash characters — what crypto.randomUUID() (src/lib/marketing.ts's
// initMarketing) actually mints, and the shape VISITOR_ID_RE requires.
const VALID_VISITOR_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

test('a booking with attribution stores source_utm and heard_from, and writes a lesson_scheduled event', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        attribution: {
          utm: { source: 'google', medium: 'cpc', campaign: 'back-to-school', content: 'ad1' },
          visitorId: VALID_VISITOR_ID,
        },
        heardFrom: 'instagram',
      })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT id, source_utm, heard_from FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();

    assert.equal(b.heard_from, 'instagram');
    assert.ok(b.source_utm, 'attribution must be stored on the booking row');
    const stored = JSON.parse(b.source_utm);
    assert.equal(stored.utm.source, 'google');
    assert.equal(stored.utm.medium, 'cpc');
    assert.equal(stored.utm.campaign, 'back-to-school');
    assert.equal(stored.utm.content, 'ad1');
    assert.equal(stored.visitorId, VALID_VISITOR_ID);
  } finally { await stop(); }
});

test('a visitorId that does not look like a minted uuid is dropped, not stored as given', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        attribution: { utm: { source: 'google' }, visitorId: 'forged-visitor-id' },
      })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT source_utm FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();
    const stored = JSON.parse(b.source_utm);
    assert.equal(stored.utm.source, 'google', 'the rest of attribution must still be stored');
    assert.equal(stored.visitorId, null, 'a malformed visitorId must not be stored as given');
  } finally { await stop(); }
});

test('an unknown heardFrom is stored as NULL', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ heardFrom: 'carrier-pigeon' })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT heard_from FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();
    assert.equal(b.heard_from, null, 'an unrecognised answer must not be stored as if it were real');
  } finally { await stop(); }
});

test('a lesson_scheduled event is written with the booking id and its attribution UTM', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        attribution: {
          utm: { source: 'newsletter', medium: 'email' },
          visitorId: VALID_VISITOR_ID,
        },
      })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    const ev = db.prepare(`SELECT * FROM marketing_events WHERE event = 'lesson_scheduled' ORDER BY id DESC LIMIT 1`).get();
    db.close();

    assert.ok(ev, 'a lesson_scheduled event must be written');
    assert.equal(ev.booking_id, b.id);
    assert.equal(ev.utm_source, 'newsletter');
    assert.equal(ev.utm_medium, 'email');
    assert.equal(ev.visitor_id, VALID_VISITOR_ID);
  } finally { await stop(); }
});

test('a lesson_scheduled event is not written when the tutor books for a family herself', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM marketing_events WHERE event = 'lesson_scheduled'`).get().n;
    db.close();
    assert.equal(n, 0, "the tutor booking for a family herself is not a visitor's own funnel step");
  } finally { await stop(); }
});

test('heardFrom is ignored when the request carries a family session, even if the client still sends one', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const first = await (await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ heardFrom: 'instagram' })),
    })).json();
    assert.equal(first.portal.isNewFamily, true);

    const cookie = await familySession(first.portal.link);
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(booking({
        name: 'ילד שני', durationMin: 45,
        start: '2027-04-10T10:00:00+02:00', end: '2027-04-10T10:45:00+02:00',
        heardFrom: 'google',
      })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT heard_from FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();
    assert.equal(b.heard_from, null, 'a returning family session must never carry a heard_from answer, even a forged one');
  } finally { await stop(); }
});

test('a booking without attribution still succeeds, and its lesson_scheduled event carries no UTM', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT id, source_utm, heard_from FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    const ev = db.prepare(`SELECT * FROM marketing_events WHERE event = 'lesson_scheduled' ORDER BY id DESC LIMIT 1`).get();
    db.close();

    assert.equal(b.source_utm, null);
    assert.equal(b.heard_from, null);
    assert.ok(ev, 'an untracked booking must still be counted in the funnel');
    assert.equal(ev.booking_id, b.id);
    assert.equal(ev.utm_source, null);
    assert.equal(ev.visitor_id, null);
  } finally { await stop(); }
});

test('an oversize attribution field is trimmed, never crashes the booking', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const longSource = 'x'.repeat(500);
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        attribution: { utm: { source: longSource }, visitorId: 'v' },
      })),
    });
    assert.equal(r.status, 200);

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const b = db.prepare(`SELECT source_utm FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get();
    db.close();
    const stored = JSON.parse(b.source_utm);
    assert.ok(stored.utm.source.length <= 100, 'attribution strings must be capped, same limit as marketing.ts');
  } finally { await stop(); }
});

test('a booked student can be read back through their own portal page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ name: 'תלמיד בדיקה', email: 'reach@example.com' })),
    });
    assert.equal(r.status, 200);
    const { portal } = await r.json();

    // The family reaches their page from the booking response itself. This
    // is the whole point of the rebuild: the link used to exist only in the
    // tutor's inbox, so this test had to log in AS THE TUTOR and read the
    // student's password out of her dashboard to check that a family could
    // get in. That it needed the tutor's session to prove a family's access
    // was the bug, stated as a test.
    const cookie = await familySession(portal.link);
    const portalRes = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: cookie } });
    assert.equal(portalRes.status, 200);
    assert.equal((await portalRes.json()).name, 'תלמיד בדיקה');

    // And the tutor still sees the enrolment on her own roster.
    const tutor = await login(baseUrl);
    const { students } = await (await fetch(`${baseUrl}/api/students`, { headers: { Cookie: tutor } })).json();
    const enrolled = students.find(s => s.name === 'תלמיד בדיקה');
    assert.ok(enrolled, 'the booking must have enrolled a student findable by name');
    assert.equal(enrolled.email, 'reach@example.com');
  } finally { await stop(); }
});

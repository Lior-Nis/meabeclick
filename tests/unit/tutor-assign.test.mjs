// tests/unit/tutor-assign.test.mjs
//
// Choosing the tutor at submit: calendars read first, the choice made
// synchronously against the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'assign-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const C = await import('../../src/lib/server/tutor-candidates.ts');
const A = await import('../../src/lib/server/tutor-assign.ts');

const [nikol, lior] = E.listTeachers();
for (const t of [nikol, lior]) {
  S.updateTutorSettings(t.id, { calendarId: `t${t.id}@group.calendar.google.com`, busyIcs: [`https://feeds.example.test/${t.id}.ics`] });
}
// Mondays at 10:00–11:30 Israel (UTC+2).
const MON = (d) => ({ start: `2030-03-${d}T08:00:00.000Z`, end: `2030-03-${d}T09:30:00.000Z` });
const newFamily = (email) => C.bookingCandidates({ email, name: 'חדש', subject: 'מתמטיקה' });

test("a returning family's busy tutor, with another tutor free, is TUTOR_BUSY", () => {
  const at = MON('04');
  const account = E.createAccount({ name: 'כהן', credential: 'x', email: 'cohen@example.com' });
  const s = E.createStudent({ code: 'ta1', name: 'דנה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: nikol.id });
  E.reserveBooking({ studentId: s.id, ...at, durationMin: 90, teacherId: nikol.id });
  const c = C.bookingCandidates({ email: 'cohen@example.com', name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(A.assignTutor(c, at.start, at.end, new Map()), { tutor: null, tutorBusy: true });
  assert.equal(A.assignTutor(newFamily('new@example.com'), at.start, at.end, new Map()).tutor.id, lior.id,
    'a new family at that hour gets Lior');
});

test('busy in her calendar counts as busy', () => {
  const at = MON('11');
  assert.equal(A.assignTutor(newFamily('a@example.com'), at.start, at.end, new Map([[nikol.id, [at]]])).tutor.id, lior.id);
});

test('nobody free and nobody else: a plain refusal', () => {
  const at = MON('18');
  assert.deepEqual(A.assignTutor(newFamily('b@example.com'), at.start, at.end, new Map([[nikol.id, [at]], [lior.id, [at]]])),
    { tutor: null, tutorBusy: false });
});

test("a returning family's calendars to read include the other tutors, for TUTOR_BUSY", () => {
  const c = C.bookingCandidates({ email: 'cohen@example.com', name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(A.tutorsToAsk(c).map(t => t.id), [nikol.id, lior.id]);
  assert.deepEqual(A.tutorsToAsk(C.heldCandidates(lior.id)).map(t => t.id), [lior.id]);
});

const ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@test\r\nDTSTAMP:20300101T000000Z\r\nDTSTART:20300325T080000Z\r\nDTEND:20300325T090000Z\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test('a feed that cannot be read counts as free, and says so without the address', async () => {
  const original = globalThis.fetch;
  const saved = console.error;
  const errors = [];
  globalThis.fetch = async () => { throw new Error('request to https://feeds.example.test/1.ics failed'); };
  console.error = (...a) => errors.push(a.map(String).join(' '));
  try {
    const busy = await A.calendarBusyAround([E.getTeacher(nikol.id)], MON('25').start, MON('25').end);
    assert.deepEqual(busy.get(nikol.id), []);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0], /feeds\.example/);
  } finally {
    globalThis.fetch = original;
    console.error = saved;
  }
});

test("each tutor's busy times come from their own feeds", async () => {
  const original = globalThis.fetch;
  const realNow = Date.now;
  globalThis.fetch = async (url) => new Response(String(url).endsWith(`/${nikol.id}.ics`) ? ICS : 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  // Past the two minutes a failed feed is not asked again: the test above failed Nikol's.
  Date.now = () => realNow() + 2 * 60 * 1000 + 1000;
  try {
    const busy = await A.calendarBusyAround([E.getTeacher(nikol.id), E.getTeacher(lior.id)], MON('25').start, MON('25').end);
    assert.equal(busy.get(nikol.id).length, 1);
    assert.equal(busy.get(lior.id).length, 0);
  } finally {
    globalThis.fetch = original;
    Date.now = realNow;
  }
});

/* The write itself is tested with Google faked (lesson-calendar.test.mjs);
   the harness has no service account, so this pins which calendar the route
   hands it. */
test("the booking route writes the event into the booking tutor's calendar, and no other", () => {
  const route = readFileSync(new URL('../../src/routes/api/book/+server.ts', import.meta.url), 'utf8');
  assert.match(route, /insertLessonEvent\(sa, tutor\.calendar_id, event\)/);
  assert.doesNotMatch(route, /process\.env\.CALENDAR_ID/);
});

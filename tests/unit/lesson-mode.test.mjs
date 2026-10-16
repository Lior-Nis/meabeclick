// tests/unit/lesson-mode.test.mjs
//
// Online or in person (Todoist 6hmR35WgcWp7Mj2q, designed with Lior on
// 2026-10-16). A family picks one at booking. In person is only ever at the
// office, never at the student's home. Online is the teacher's own fixed
// Google Meet room, kept on the teachers row (the repo is public), and it
// reaches the calendar event, the emails and the reminder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'mode-')), 'results.db');
const { isLessonMode, lessonPlace, meetUrl, MODE_LABEL } = await import('../../src/lib/lesson-mode.ts');
const { OFFICE_ADDRESS, OFFICE_NAV_LINK } = await import('../../src/lib/contact.ts');
const { bookingEvent } = await import('../../src/lib/server/booking-event.ts');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/reminders.ts');
const { handle } = await import('../../src/lib/server/db.ts');
/** A teacher's room, as a finished setup (tutor-setup.ts) leaves it. */
const setRoom = (id, url) => handle().prepare(`UPDATE teachers SET meet_url = ? WHERE id = ?`).run(url, id);

const ROOM = 'https://meet.google.com/abc-defg-hij';

test('the office is one address, and navigation goes to it', () => {
  assert.equal(OFFICE_ADDRESS, 'שלמה אפשטיין 10, קרית גת');
  assert.ok(OFFICE_NAV_LINK.startsWith('https://waze.com/ul?q='));
  assert.ok(OFFICE_NAV_LINK.includes(encodeURIComponent(OFFICE_ADDRESS)));
});

test('a lesson is online or in person, and nothing else', () => {
  assert.equal(isLessonMode('online'), true);
  assert.equal(isLessonMode('in_person'), true);
  for (const v of ['home', '', null, undefined, 1, 'ONLINE']) assert.equal(isLessonMode(v), false, String(v));
  assert.deepEqual(MODE_LABEL, { online: 'אונליין', in_person: 'פנים מול פנים' });
});

test('only an https link is a Meet room; anything else is no room', () => {
  assert.equal(meetUrl(ROOM), ROOM);
  assert.equal(meetUrl(`  ${ROOM}  `), ROOM);
  assert.equal(meetUrl('javascript:alert(1)'), null);
  assert.equal(meetUrl('meet.google.com/abc'), null);
  assert.equal(meetUrl(''), null);
  assert.equal(meetUrl(null), null);
});

test('online with a room: the room is where, and the link', () => {
  const p = lessonPlace('online', ROOM);
  assert.deepEqual(p, { mode: 'online', label: 'אונליין (Google Meet)', where: ROOM, href: ROOM });
});

test('online without a room: no link is invented', () => {
  const p = lessonPlace('online', null);
  assert.equal(p.where, null);
  assert.equal(p.href, null);
});

test('in person is always the office, whatever the room', () => {
  const p = lessonPlace('in_person', ROOM);
  assert.deepEqual(p, { mode: 'in_person', label: 'פנים מול פנים', where: OFFICE_ADDRESS, href: OFFICE_NAV_LINK });
});

test('a booking that never said (made before the choice existed) says so', () => {
  assert.deepEqual(lessonPlace(null, ROOM), { mode: null, label: 'לא צוין', where: null, href: null });
});

const booking = {
  name: 'דנה', subject: 'מתמטיקה', request: '', level: 'כיתה ח', phone: '0501234567',
  email: 'p@example.com', start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T11:30:00+03:00', durationMin: 90,
};

test('the calendar event says the mode in its title and puts the room in its location', () => {
  const ev = bookingEvent(booking, lessonPlace('online', ROOM));
  assert.equal(ev.summary, 'שיעור — דנה — מתמטיקה — אונליין');
  assert.equal(ev.location, ROOM);
  assert.ok(ev.description.includes(`📍 אונליין (Google Meet) — ${ROOM}`));
  assert.deepEqual(ev.start, { dateTime: booking.start, timeZone: 'Asia/Jerusalem' });
});

test('an in-person event is located at the office', () => {
  const ev = bookingEvent(booking, lessonPlace('in_person', null));
  assert.equal(ev.summary, 'שיעור — דנה — מתמטיקה — פנים מול פנים');
  assert.equal(ev.location, OFFICE_ADDRESS);
});

test('an event with nowhere to point has no location, and its title is unchanged', () => {
  const ev = bookingEvent(booking, lessonPlace(null, null));
  assert.equal(ev.summary, 'שיעור — דנה — מתמטיקה');
  assert.equal('location' in ev, false);
});

// ── The database ────────────────────────────────────────────────────────

let seq = 0;
function seed(teacherId) {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, credential: 'x', email: `mode${seq}@example.com` });
  const student = E.createStudent({ code: `m${seq}`, name: 'נועה', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה ח', teacherId });
  return { student, enr };
}

test('a booking keeps its mode', () => {
  const { student, enr } = seed(null);
  const id = E.reserveBooking({ studentId: student.id, enrollmentId: enr.id, start: '2027-01-01T10:00:00Z', end: '2027-01-01T11:00:00Z', durationMin: 45, mode: 'in_person' });
  assert.equal(handle().prepare(`SELECT mode FROM bookings_v2 WHERE id = ?`).get(id).mode, 'in_person');
  const old = E.reserveBooking({ studentId: student.id, enrollmentId: enr.id, start: '2027-01-02T10:00:00Z', end: '2027-01-02T11:00:00Z', durationMin: 45 });
  assert.equal(handle().prepare(`SELECT mode FROM bookings_v2 WHERE id = ?`).get(old).mode, null);
});

test('the database refuses any mode but the two', () => {
  const { student, enr } = seed(null);
  assert.throws(() => E.reserveBooking({ studentId: student.id, enrollmentId: enr.id, start: '2027-01-03T10:00:00Z', end: '2027-01-03T11:00:00Z', durationMin: 45, mode: 'home' }));
});

test("the room is the lesson's teacher's; with no teacher on it, the default teacher's", () => {
  const [first] = E.listTeachers();
  const other = E.createTeacher({ name: 'שלישית' });
  setRoom(first.id, ROOM);
  setRoom(other.id, 'https://meet.google.com/zzz-zzzz-zzz');
  assert.equal(E.lessonTeacher(other.id).meet_url, 'https://meet.google.com/zzz-zzzz-zzz');
  assert.equal(E.lessonTeacher(null).id, E.defaultTeacher().id);
  assert.equal(E.lessonTeacher(null).meet_url, ROOM);
});

test('the reminder carries the mode and the room', () => {
  const NOW = '2027-03-01T09:00:00.000Z';
  const start = new Date(Date.parse(NOW) + 20 * 3600e3).toISOString();
  const [first] = E.listTeachers();
  setRoom(first.id, ROOM);
  const { student, enr } = seed(first.id);
  const id = E.reserveBooking({ studentId: student.id, enrollmentId: enr.id, start, end: start, durationMin: 45, mode: 'online' });
  const due = R.pendingReminders(NOW).find((b) => b.id === id);
  assert.ok(due, 'due a reminder');
  assert.equal(due.mode, 'online');
  assert.equal(due.meetUrl, ROOM);
});

// ── The terms ───────────────────────────────────────────────────────────

test('the terms name the one office, from contact.ts, and no second city', async () => {
  const src = await readFile(new URL('../../src/routes/terms/+page.svelte', import.meta.url), 'utf8');
  assert.ok(!src.includes('אשקלון'), 'there is no Ashkelon office');
  assert.match(src, /import \{[^}]*OFFICE_ADDRESS[^}]*\} from '\$lib\/contact\.ts'/);
  assert.ok(src.includes('{OFFICE_ADDRESS}'), 'the address is printed from the constant');
  assert.ok(src.includes('לא בבית התלמיד'), 'never at the student’s home');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'report-store-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/plans/store.ts');
const R = await import('../../src/lib/server/reports/store.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{ key: 't', title: 'נושא', branches: [{ key: 't.b', title: 'ענף', skills: [
    { key: 't.b.a', title: 'חוקי חזקות', requires: [] },
    { key: 't.b.b', title: 'כלל המנה', requires: ['t.b.a'] },
  ] }] }],
};

let seq = 0;
/** A student with a plan and one booking at the given times. */
function scenario({ start, end, status = 'confirmed' }) {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 90, '2026-05-01T00:00:00.000Z', ?)`
  ).run(student.id, enrollment.id, start, end, status);
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  const planId = P.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const skills = P.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { student, enrollment, bookingId, planId, skills };
}

const NOW = '2026-06-01T18:00:00.000Z';
const past = { start: '2026-06-01T14:00:00.000Z', end: '2026-06-01T15:30:00.000Z' };
const future = { start: '2026-06-02T14:00:00.000Z', end: '2026-06-02T15:30:00.000Z' };
const WINDOW = '2026-05-18T00:00:00.000Z'; // 14 days back
// /api/book stores start/end with the client's original offset, not
// normalized to UTC. True instant here is 2026-06-01T17:00:00Z — one hour
// before NOW — but its digits ("20:00") sort AFTER NOW's ("18:00") as plain
// strings, so a lexicographic (non-datetime()) comparison would wrongly see
// this lesson as not yet ended.
const offsetPast = {
  start: '2026-06-01T19:00:00.000+03:00', // true 16:00Z
  end: '2026-06-01T20:00:00.000+03:00',   // true 17:00Z
};

test('a finished lesson with no report is awaiting one', () => {
  const s = scenario(past);
  const pending = R.lessonsAwaitingReport(WINDOW, NOW);
  assert.ok(pending.some(p => p.bookingId === s.bookingId));
});

test('a future lesson, a cancelled one, and a reported one are not', () => {
  const soon = scenario(future);
  const cancelled = scenario({ ...past, status: 'cancelled' });
  const done = scenario(past);
  R.fileReport({ bookingId: done.bookingId, note: null, entries: [] });

  const ids = R.lessonsAwaitingReport(WINDOW, NOW).map(p => p.bookingId);
  assert.ok(!ids.includes(soon.bookingId), 'a lesson that has not happened yet');
  assert.ok(!ids.includes(cancelled.bookingId), 'a cancelled lesson');
  assert.ok(!ids.includes(done.bookingId), 'a lesson already reported');
});

test('filing writes the report and one event per skill, in one transaction', () => {
  const s = scenario(past);
  const reportId = R.fileReport({
    bookingId: s.bookingId,
    note: 'נתקעה בשברים',
    entries: [
      { nodeId: s.skills[0].id, status: 'independent' },
      { nodeId: s.skills[1].id, status: 'guided' },
    ],
  });

  const report = R.reportForBooking(s.bookingId);
  assert.equal(report.id, reportId);
  assert.equal(report.note, 'נתקעה בשברים');

  const events = P.planData(s.planId).events.filter(e => e.type === 'status');
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.equal(e.source, 'report');
    assert.equal(e.report_id, reportId);
    assert.equal(e.evidence, 'lesson');
  }
});

test('a lesson recorded with a non-UTC offset is correctly seen as finished', () => {
  const s = scenario(offsetPast);
  const pending = R.lessonsAwaitingReport(WINDOW, NOW).map(p => p.bookingId);
  assert.ok(pending.includes(s.bookingId), 'awaiting report despite the +03:00 offset');

  const candidates = R.promptCandidates(NOW).map(p => p.bookingId);
  assert.ok(candidates.includes(s.bookingId), 'a prompt candidate despite the +03:00 offset');
});

test('a note-only report is valid and moves nothing', () => {
  const s = scenario(past);
  R.fileReport({ bookingId: s.bookingId, note: 'שיחה על חרדת מבחנים', entries: [] });
  assert.ok(R.reportForBooking(s.bookingId));
  assert.equal(P.planData(s.planId).events.filter(e => e.type === 'status').length, 0);
});

test('a correction appends events and never deletes', () => {
  const s = scenario(past);
  R.fileReport({ bookingId: s.bookingId, note: 'ראשון', entries: [{ nodeId: s.skills[0].id, status: 'guided' }] });
  R.fileReport({ bookingId: s.bookingId, note: 'תיקון', entries: [{ nodeId: s.skills[0].id, status: 'needs_review' }] });

  const events = P.planData(s.planId).events.filter(e => e.type === 'status');
  assert.equal(events.length, 2, 'both judgements survive');
  assert.equal(events.at(-1).status, 'needs_review');
  assert.equal(R.reportForBooking(s.bookingId).note, 'תיקון');
  assert.equal(handle().prepare(`SELECT COUNT(*) AS n FROM lesson_reports WHERE booking_id = ?`).get(s.bookingId).n, 1);
});

test('a failed filing leaves neither the report nor its events', () => {
  const s = scenario(past);
  assert.throws(() => R.fileReport({
    bookingId: s.bookingId, note: null,
    entries: [{ nodeId: s.skills[0].id, status: 'guided' }, { nodeId: 999999, status: 'guided' }],
  }));
  assert.equal(R.reportForBooking(s.bookingId), null);
  assert.equal(P.planData(s.planId).events.filter(e => e.type === 'status').length, 0);
});

test('prompt candidates respect the 30-minute and 3-day windows', () => {
  const justEnded = scenario({ start: '2026-06-01T17:00:00.000Z', end: '2026-06-01T17:50:00.000Z' }); // 10 min ago
  const ready = scenario(past);                                                                        // 2.5 h ago
  const stale = scenario({ start: '2026-05-20T14:00:00.000Z', end: '2026-05-20T15:30:00.000Z' });      // 12 days ago

  const ids = R.promptCandidates(NOW).map(p => p.bookingId);
  assert.ok(!ids.includes(justEnded.bookingId), 'a lesson that may still be running');
  assert.ok(ids.includes(ready.bookingId));
  assert.ok(!ids.includes(stale.bookingId), 'too old to chase');
});

test('a lesson is offered for prompting once', () => {
  const s = scenario(past);
  assert.ok(R.promptCandidates(NOW).some(p => p.bookingId === s.bookingId));
  R.markPrompted(s.bookingId, NOW);
  assert.ok(!R.promptCandidates(NOW).some(p => p.bookingId === s.bookingId));
});

test('pending lessons carry what the queue and the email need', () => {
  const s = scenario(past);
  const row = R.lessonsAwaitingReport(WINDOW, NOW).find(p => p.bookingId === s.bookingId);
  assert.equal(row.studentCode, s.student.code);
  assert.equal(row.studentName, s.student.name);
  assert.equal(row.subject, 'מתמטיקה');
  assert.equal(row.enrollmentId, s.enrollment.id);
  assert.equal(row.end, past.end);
});

test('a node from a different student\'s plan is refused, and neither student\'s plan is affected', () => {
  const s1 = scenario(past);
  const s2 = scenario(past);
  // Try to attach s2's skill to s1's booking
  assert.throws(() => R.fileReport({
    bookingId: s1.bookingId, note: null,
    entries: [{ nodeId: s2.skills[0].id, status: 'independent' }],
  }));
  // Neither student's plan should have a new event, and no report should exist
  assert.equal(R.reportForBooking(s1.bookingId), null);
  assert.equal(R.reportForBooking(s2.bookingId), null);
  const s1Events = P.planData(s1.planId).events.filter(e => e.type === 'status').length;
  const s2Events = P.planData(s2.planId).events.filter(e => e.type === 'status').length;
  assert.equal(s1Events, 0);
  assert.equal(s2Events, 0);
});

test('a booking whose enrollment has no plan: note-only report succeeds, entries-based report fails', () => {
  // Create a student with an enrollment but no plan
  const account = E.createAccount({ name: 'no-plan', phone: null, credential: 'x' });
  const student = E.createStudent({ code: 'noplan', name: 'no plan', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'ביולוגיה', level: 'כיתה ח', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  // Note: we don't create a plan for this enrollment

  handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 90, '2026-05-01T00:00:00.000Z', 'confirmed')`
  ).run(student.id, enrollment.id, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z');
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);

  // Note-only report should succeed
  const reportId = R.fileReport({ bookingId, note: 'note only', entries: [] });
  assert.ok(reportId);
  assert.equal(R.reportForBooking(bookingId).note, 'note only');

  // Entries-based report should throw (enrollment has no plan)
  assert.throws(() => R.fileReport({
    bookingId, note: 'with entries',
    entries: [{ nodeId: 1, status: 'independent' }],
  }));
});

test('a booking with NO enrollment at all (migration 006\'s ambiguous-subject case): note-only succeeds, an entry throws', () => {
  // Mirrors what migration 006 leaves behind for a student with more than
  // one enrollment: bookings_v2.enrollment_id is NULL, not just "an
  // enrollment with no plan yet" (the scenario above). This is the exact
  // shape the whole-branch review's item 1 is about.
  const account = E.createAccount({ name: 'multi-subject', phone: null, credential: 'x' });
  const student = E.createStudent({ code: 'multisub', name: 'no enrollment', accountId: account.id, credential: 'x' });

  handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, NULL, ?, ?, 90, '2026-05-01T00:00:00.000Z', 'confirmed')`
  ).run(student.id, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z');
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);

  // A note-only report on an enrollment-less booking must land, not throw —
  // recording that the lesson happened is worth having even with no plan.
  const reportId = R.fileReport({ bookingId, note: 'שיחה קצרה', entries: [] });
  assert.ok(reportId);
  const report = R.reportForBooking(bookingId);
  assert.equal(report.note, 'שיחה קצרה');
  assert.equal(report.enrollment_id, null, 'lesson_reports.enrollment_id is nullable since migration 007');

  // An entry on the same booking has no plan to validate against and must
  // still throw — the API maps this to 400, never a 500.
  assert.throws(() => R.fileReport({
    bookingId, note: null,
    entries: [{ nodeId: 1, status: 'independent' }],
  }));
});

test('a correction\'s note history is appended, never rewritten, and every status event carries its filing\'s note', () => {
  const s = scenario(past);
  const first = R.fileReport({
    bookingId: s.bookingId, note: 'ראשון',
    entries: [{ nodeId: s.skills[0].id, status: 'guided' }],
  });
  const second = R.fileReport({
    bookingId: s.bookingId, note: 'תיקון',
    entries: [{ nodeId: s.skills[0].id, status: 'needs_review' }],
  });
  assert.equal(first, second, 'a correction updates the same report row');

  const notes = R.notesForReport(first);
  assert.equal(notes.length, 2, 'both filings survive in the history table');
  assert.equal(notes[0].note, 'ראשון');
  assert.equal(notes[1].note, 'תיקון');
  assert.ok(notes[0].id < notes[1].id, 'in filing order');

  // lesson_reports.note itself only ever keeps the latest.
  assert.equal(R.reportForBooking(s.bookingId).note, 'תיקון');

  // The plan's own history explains itself: each status event carries the
  // note filed alongside it, not a hard-coded NULL.
  const events = P.planData(s.planId).events.filter(e => e.type === 'status');
  assert.equal(events.length, 2);
  assert.equal(events[0].note, 'ראשון');
  assert.equal(events[1].note, 'תיקון');
});

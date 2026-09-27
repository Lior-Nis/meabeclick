// tests/unit/report-records-coverage.test.mjs
//
// Filing a report is how the system learns what was actually TAUGHT.
//
// Migration 011 added `covered` events — "this was taught, regardless of
// how it went" — and the plan page already renders «נלמד, טרם נבדק» from
// them. But nothing on the main path wrote one: addCoveredEvent was
// reachable only from the plan's own events API, a separate manual action
// the tutor has no reason to take after filing a report.
//
// So the fact the whole design rests on was never recorded. Todoist
// id:6hRhqRvfX7VHgh9q step 1 — "produce suggestions only from material
// actually taught" — is unreachable without it: the plan knows what was
// PLANNED, and only a report knows what happened.
//
// A report entry is the tutor saying she assessed that skill in that
// lesson, which means she taught or practised it. That is exactly what
// `covered` records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'report-cov-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const R = await import('../../src/lib/server/reports/store.ts');
const V = await import('../../src/lib/server/plans/view.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון',
    branches: [{
      key: 'calc.r', title: 'כללי גזירה',
      skills: [
        { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.r.b', title: 'כלל המנה', requires: [] },
      ],
    }],
  }],
};

let seq = 0;
function fresh() {
  seq += 1;
  const account = E.createAccount({ name: `מ ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `ת ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
  const past = new Date(Date.now() - 3 * 3600e3).toISOString();
  const b = handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 45, ?, 'confirmed')`
  ).run(student.id, enrollment.id, past, past, past);
  return { student, planId, nodes, bookingId: Number(b.lastInsertRowid) };
}

const coveredEvents = (planId, nodeId) =>
  S.planData(planId).events.filter(e => e.type === 'covered' && e.node_id === nodeId);

test('filing a report records that each reported skill was taught', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: 'עברנו חזקות', entries: [{ nodeId: nodes[0].id, status: 'guided' }] });

  assert.equal(coveredEvents(planId, nodes[0].id).length, 1);
  assert.equal(coveredEvents(planId, nodes[1].id).length, 0, 'only what was reported');
});

test('coverage does not move the skill', () => {
  // The entire reason coverage is its own event type: a lesson that went
  // badly must not be recordable as progress.
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  const { events } = S.planData(planId);
  assert.equal(V.currentStatus(events, nodes[0].id), 'started');
});

test('the covered event carries the report it came from', () => {
  const { planId, nodes, bookingId } = fresh();
  const reportId = R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'guided' }] });
  assert.equal(coveredEvents(planId, nodes[0].id)[0].report_id, reportId,
    'so a correction can tell its own coverage apart from another lesson’s');
});

test('correcting a report does not record a second teaching', () => {
  // Re-filing is the SAME lesson. The status history appends — that is the
  // point of a correction — but the child was not taught it twice, and a
  // second covered row would say she was.
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  R.fileReport({ bookingId, note: 'תיקון', entries: [{ nodeId: nodes[0].id, status: 'guided' }] });
  assert.equal(coveredEvents(planId, nodes[0].id).length, 1);
});

test('a note-only report records no coverage', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: 'התלמידה לא הגיעה', entries: [] });
  assert.equal(coveredEvents(planId, nodes[0].id).length, 0);
  assert.equal(coveredEvents(planId, nodes[1].id).length, 0);
});

test('the plan shows a taught-but-unassessed skill as taught', () => {
  const { planId, nodes, bookingId } = fresh();
  R.fileReport({ bookingId, note: null, entries: [{ nodeId: nodes[0].id, status: 'started' }] });
  const { nodes: n, prereqs, events } = S.planData(planId);
  const skills = V.buildTree(n, prereqs, events, null).flatMap(t => t.branches).flatMap(b => b.skills);
  assert.ok(skills.find(s => s.id === nodes[0].id).coveredAt, 'coveredAt must now be set');
});

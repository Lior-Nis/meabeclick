import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'plan-store-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 3, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון דיפרנציאלי',
    branches: [{
      key: 'calc.rules', title: 'כללי גזירה',
      skills: [
        { key: 'calc.rules.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.rules.b', title: 'כלל המנה', requires: ['calc.rules.a'] },
        { key: 'calc.rules.c', title: 'נגזרת שורש', requires: ['calc.rules.b'] },
      ],
    }],
  }],
};

let seq = 0;
/** A fresh student + enrollment for each test, so plans never collide. */
function freshEnrollment() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  return { student, enrollment };
}

const create = (enrollment, student) => S.createPlan({
  studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות 5 יח״ל',
});

test('creating a plan copies every node, keeping keys and order', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const { plan, nodes, prereqs, events } = S.planData(planId);

  assert.equal(plan.template_id, 'demo');
  assert.equal(plan.template_version, 3, 'the plan records which version it copied');
  assert.equal(nodes.length, 5, '1 topic + 1 branch + 3 skills');
  assert.deepEqual(
    nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position).map(n => n.key),
    ['calc.rules.a', 'calc.rules.b', 'calc.rules.c'],
  );
  assert.equal(prereqs.length, 2, 'both requires edges survive the copy');
  assert.equal(events.filter(e => e.type === 'created').length, 1);
});

test('a second plan for the same enrollment is refused', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  assert.throws(() => create(enrollment, student), /UNIQUE/i);
});

test('a failed copy leaves no rows behind', () => {
  const { student, enrollment } = freshEnrollment();
  const broken = { ...template, topics: [{ ...template.topics[0], branches: [{
    key: 'calc.rules', title: 'כללי גזירה',
    skills: [{ key: 'calc.rules.a', title: 'א' }, { key: 'calc.rules.a', title: 'כפול' }],
  }] }] };
  assert.throws(() => S.createPlan({
    studentId: student.id, enrollmentId: enrollment.id, template: broken, goal: 'x',
  }));
  assert.equal(S.planForEnrollment(enrollment.id), null, 'the transaction must have rolled back');
});

test('a status event is appended and readable', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const skill = S.planData(planId).nodes.find(n => n.key === 'calc.rules.a');

  S.addStatusEvent(planId, skill.id, 'guided', { note: 'עבדנו על זה בשיעור', evidence: 'lesson' });
  S.addStatusEvent(planId, skill.id, 'independent', { evidence: 'homework' });

  const statusEvents = S.planData(planId).events.filter(e => e.type === 'status');
  assert.equal(statusEvents.length, 2, 'history is kept, not overwritten');
  assert.equal(statusEvents.at(-1).status, 'independent');
  assert.equal(statusEvents[0].note, 'עבדנו על זה בשיעור');
  assert.equal(statusEvents[0].source, 'teacher');
});

test('a status event refuses a topic or branch — spec §5, "status only on skills"', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const { nodes } = S.planData(planId);
  const topic = nodes.find(n => n.kind === 'topic');
  const branch = nodes.find(n => n.kind === 'branch');

  assert.throws(() => S.addStatusEvent(planId, topic.id, 'guided'));
  assert.throws(() => S.addStatusEvent(planId, branch.id, 'guided'));
  assert.equal(S.planData(planId).events.filter(e => e.type === 'status').length, 0, 'neither call left an event behind');
});

test('visibility changes are applied and logged', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const skill = S.planData(planId).nodes.find(n => n.key === 'calc.rules.c');

  S.setVisibility(planId, skill.id, 'hidden');
  const after = S.planData(planId);
  assert.equal(after.nodes.find(n => n.id === skill.id).visibility, 'hidden');
  assert.equal(after.events.filter(e => e.type === 'visibility').length, 1);
});

test('moving swaps a node with its neighbour and logs the move', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const before = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position);

  S.moveNode(planId, before[2].id, 'up');
  const after = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position);
  assert.deepEqual(after.map(n => n.key), ['calc.rules.a', 'calc.rules.c', 'calc.rules.b']);
  assert.equal(S.planData(planId).events.filter(e => e.type === 'move').length, 1);
});

test('moving past the edge changes nothing and logs nothing', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const first = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position)[0];

  S.moveNode(planId, first.id, 'up');
  const after = S.planData(planId);
  assert.deepEqual(
    after.nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position).map(n => n.key),
    ['calc.rules.a', 'calc.rules.b', 'calc.rules.c'],
  );
  assert.equal(after.events.filter(e => e.type === 'move').length, 0);
});

test('nodeInPlan refuses a node from another plan', () => {
  const one = freshEnrollment();
  const two = freshEnrollment();
  const planA = create(one.enrollment, one.student);
  const planB = create(two.enrollment, two.student);
  const nodeB = S.planData(planB).nodes[0];

  assert.equal(S.nodeInPlan(planA, nodeB.id), null);
  assert.ok(S.nodeInPlan(planB, nodeB.id));
});

test('the goal edit is stored and logged', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);

  S.updateGoal(planId, 'בגרות 5 יח״ל — מועד קיץ', '2027-06-12', 'חקירת פונקציה רציונלית');
  const { plan, events } = S.planData(planId);
  assert.equal(plan.exam_date, '2027-06-12');
  assert.equal(plan.focus, 'חקירת פונקציה רציונלית');
  assert.equal(events.filter(e => e.type === 'goal').length, 1);
});

test('lastLessonAt takes the most recent booking that has already started', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  const db = handle();
  const book = (start) => db.prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, end, duration, at, status)
     VALUES (?, ?, ?, ?, 90, '2026-01-01T00:00:00.000Z', 'confirmed')`
  ).run(student.id, enrollment.id, start, start);

  assert.equal(S.lastLessonAt(student.id, '2026-04-01T00:00:00.000Z'), null, 'no bookings yet');

  book('2026-03-01T10:00:00.000Z');
  book('2026-03-20T10:00:00.000Z');
  book('2026-05-01T10:00:00.000Z'); // still in the future
  assert.equal(S.lastLessonAt(student.id, '2026-04-01T00:00:00.000Z'), '2026-03-20T10:00:00.000Z');
});

test('a student holding a plan cannot be deleted', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  assert.throws(() => E.deleteStudentCascade(student.code), /FOREIGN KEY|constraint/i);
});

// tests/unit/lesson-skill-link.test.mjs
//
// The link that makes practice into evidence about a skill.
//
// Spec §2: results_v2 and homework already carry everything an assessment
// wants — score, tries, hints, seconds, whether the work was done — and
// neither is connected to a skill. Every suggestion rule in §3.2 dies here.
//
// The link is made by the PIPELINE, never by the model. The generator is
// told a skill's TITLE; the node id stays on the server and is what the
// rows are tagged with. A model asked for an id can return one that does
// not exist or belongs to another student's plan.
//
// Two links, because there are two kinds of practice, and the code already
// settled which is which: generated homework is OFFLINE work written with
// dataId: null (appendToPortal removed the game link deliberately — every
// task used to point at the lesson's first game, so one quiz ticked four
// pen-and-paper exercises). A lesson's games are published separately and
// are not homework rows. So homework carries node_id, and game_skills says
// which skill a published game practises for one student.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'skill-link-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון',
    branches: [{
      key: 'calc.r', title: 'כללי גזירה',
      skills: [
        { key: 'calc.r.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.r.b', title: 'כלל המנה', requires: ['calc.r.a'] },
      ],
    }],
  }],
};

let seq = 0;
function freshStudent() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  return { student, enrollment };
}

test('a student with a plan gets the first unblocked skill as the lesson target', () => {
  const { student, enrollment } = freshStudent();
  S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });

  const target = T.targetSkillFor(student.code, 'מתמטיקה');
  assert.ok(target, 'a student with a plan must have a target');
  assert.equal(target.title, 'חוקי חזקות', 'the second skill is blocked by the first');
});

test('a student with no plan targets nothing, and that is not an error', () => {
  // The overwhelmingly common case today: nobody has a plan until the tutor
  // builds one. Generation must carry on exactly as before and simply
  // produce no evidence link.
  const { student } = freshStudent();
  assert.equal(T.targetSkillFor(student.code, 'מתמטיקה'), null);
});

test('a subject with no enrollment targets nothing rather than another subject\'s plan', () => {
  const { student, enrollment } = freshStudent();
  S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  assert.equal(T.targetSkillFor(student.code, 'פיזיקה'), null,
    "a physics lesson must not be tagged with a maths plan's skill");
});

test('an unknown student code targets nothing', () => {
  assert.equal(T.targetSkillFor('nobody', 'מתמטיקה'), null);
});

test('homework records the skill it practises', () => {
  const { student, enrollment } = freshStudent();
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const nodeId = S.planData(planId).nodes.find(n => n.key === 'calc.r.a').id;

  const id = L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId });
  const row = handle().prepare('SELECT node_id FROM homework WHERE id = ?').get(id);
  assert.equal(row.node_id, nodeId);
});

test('homework with no skill is null, not zero', () => {
  // Null means "this practice is not evidence about any skill". Zero would
  // be a node id, and node 0 does not exist — a falsy id that reads as
  // "unset" in one place and as a lookup in another is how this codebase
  // has produced silent wrong answers before.
  const { student } = freshStudent();
  const id = L.addHomework({ studentId: student.id, task: 'תרגיל' });
  const row = handle().prepare('SELECT node_id FROM homework WHERE id = ?').get(id);
  assert.equal(row.node_id, null);
});

test('a published game records the skill it practises, per student', () => {
  const a = freshStudent();
  const b = freshStudent();
  const planA = S.createPlan({ studentId: a.student.id, enrollmentId: a.enrollment.id, template, goal: 'ב' });
  const planB = S.createPlan({ studentId: b.student.id, enrollmentId: b.enrollment.id, template, goal: 'ב' });
  const nodeA = S.planData(planA).nodes.find(n => n.key === 'calc.r.a').id;
  const nodeB = S.planData(planB).nodes.find(n => n.key === 'calc.r.b').id;

  // The SAME data_id, assigned to two children. This is the real shape:
  // a data id identifies a game, not a child's copy of it.
  T.linkGameToSkill(a.student.id, 'shared-data-1', nodeA);
  T.linkGameToSkill(b.student.id, 'shared-data-1', nodeB);

  assert.equal(T.skillForGame(a.student.id, 'shared-data-1'), nodeA);
  assert.equal(T.skillForGame(b.student.id, 'shared-data-1'), nodeB,
    "one child's game must never resolve to another child's skill");
});

test('re-publishing the same game for the same student does not duplicate the link', () => {
  const { student, enrollment } = freshStudent();
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');

  T.linkGameToSkill(student.id, 'd1', nodes[0].id);
  T.linkGameToSkill(student.id, 'd1', nodes[1].id);

  const count = handle().prepare(
    'SELECT COUNT(*) AS n FROM game_skills WHERE student_id = ? AND data_id = ?'
  ).get(student.id, 'd1').n;
  assert.equal(count, 1, 'one row per (student, game)');
  assert.equal(T.skillForGame(student.id, 'd1'), nodes[1].id, 'the latest link wins');
});

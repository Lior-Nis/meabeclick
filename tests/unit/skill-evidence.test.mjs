// tests/unit/skill-evidence.test.mjs
//
// Gathering what a skill actually has behind it.
//
// This is the read half of the link added in #98: game plays reach a skill
// through game_skills (student_id, data_id), written work through
// homework.node_id. The engine in plans/suggest.ts is pure and takes this
// as input; this file is where the SQL that feeds it is held to the one
// rule that matters — evidence belongs to the child who produced it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'skill-ev-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');
const EV = await import('../../src/lib/server/plans/evidence.ts');
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
function freshPlan() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { student, planId, nodes };
}

const addResult = (studentId, dataId, at, score, total) =>
  handle().prepare(
    `INSERT INTO results_v2 (student_id, at, data_id, template, score, total) VALUES (?, ?, ?, 'quiz', ?, ?)`
  ).run(studentId, at, dataId, score, total);

test('a skill with nothing behind it gathers nothing', () => {
  const { student, nodes } = freshPlan();
  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.deepEqual(ev, { plays: [], homework: [] });
});

test('plays of a linked game become evidence for its skill', () => {
  const { student, nodes } = freshPlan();
  T.linkGameToSkill(student.id, 'game-a', nodes[0].id);
  addResult(student.id, 'game-a', '2026-09-01', 8, 10);
  addResult(student.id, 'game-a', '2026-09-03', 9, 10);

  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.plays.length, 2);
  assert.deepEqual(ev.plays.map(p => p.score), [8, 9]);
  assert.equal(ev.plays[0].at, '2026-09-01', 'oldest first, so a trend reads forwards');
});

test('a play of an unlinked game is evidence for nothing', () => {
  const { student, nodes } = freshPlan();
  addResult(student.id, 'not-linked', '2026-09-01', 10, 10);
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).plays.length, 0);
});

test("one child's play never becomes evidence about another child", () => {
  // The whole reason game_skills is keyed on (student_id, data_id). A data
  // id identifies a GAME, and the same game goes to many children.
  const a = freshPlan();
  const b = freshPlan();
  T.linkGameToSkill(a.student.id, 'shared', a.nodes[0].id);
  T.linkGameToSkill(b.student.id, 'shared', b.nodes[0].id);
  addResult(b.student.id, 'shared', '2026-09-01', 10, 10);

  assert.equal(EV.evidenceForSkill(a.student.id, a.nodes[0].id).plays.length, 0,
    "child A has no plays; B's must not appear under A's skill");
  assert.equal(EV.evidenceForSkill(b.student.id, b.nodes[0].id).plays.length, 1);
});

test('plays of a game linked to a different skill do not leak across skills', () => {
  const { student, nodes } = freshPlan();
  T.linkGameToSkill(student.id, 'game-b', nodes[1].id);
  addResult(student.id, 'game-b', '2026-09-01', 10, 10);
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).plays.length, 0);
  assert.equal(EV.evidenceForSkill(student.id, nodes[1].id).plays.length, 1);
});

test('homework tagged with the skill becomes evidence, with its grade', () => {
  const { student, nodes } = freshPlan();
  const id = L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId: nodes[0].id });
  L.gradeHomework(id, 'ok');

  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.homework.length, 1);
  assert.equal(ev.homework[0].grade, 'ok');
  assert.equal(ev.homework[0].submitted, true, 'grading establishes the work exists');
});

test('untagged homework is evidence for no skill', () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'תרגיל' });
  assert.equal(EV.evidenceForSkill(student.id, nodes[0].id).homework.length, 0);
});

test('ungraded homework arrives ungraded rather than as a pass', () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'תרגיל', nodeId: nodes[0].id });
  const ev = EV.evidenceForSkill(student.id, nodes[0].id);
  assert.equal(ev.homework[0].grade, null);
  assert.equal(ev.homework[0].submitted, false);
});

/**
 * What a child is told about how they are doing.
 *
 * The page used to show "{progress}% התקדמות" from a hand-typed integer on
 * students_v2. Measured on production 2026-09-22: **0 for every student,
 * and always**. Nobody had ever typed it. So a child with a lesson, four
 * homework tasks and three games opened their page and was told they were
 * at zero percent.
 *
 * Two rules, from the progress design note:
 *   count rather than blend, so a figure traces to rows someone can look at;
 *   never show a number whose meaning is undefined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'prog-')), 'results.db');

const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const P = await import('../../src/lib/server/plans/store.ts');
const { progressFor } = await import('../../src/lib/server/progress.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון',
    branches: [{
      key: 'calc.rules', title: 'כללים',
      skills: [
        { key: 'a', title: 'חוקי חזקות', requires: [] },
        { key: 'b', title: 'כלל המנה', requires: [] },
        { key: 'c', title: 'נגזרת שורש', requires: [] },
        { key: 'd', title: 'כלל השרשרת', requires: [] },
      ],
    }],
  }],
};

let seq = 0;
function freshStudent() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  return student;
}
function withPlan(student) {
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = P.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const skills = P.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { planId, skills };
}

test('a brand-new student is told there is nothing to measure yet', () => {
  const s = freshStudent();
  const p = progressFor(s.code);
  assert.equal(p.kind, 'none');
  assert.equal(p.total, 0);
  // Not 0% of something. There is no something.
  assert.equal(p.percent, 0);
});

test('homework handed in is counted, and it moves when the child acts', () => {
  const s = freshStudent();
  const a = L.addHomework({ studentId: s.id, task: 'תרגיל 1' });
  L.addHomework({ studentId: s.id, task: 'תרגיל 2' });

  assert.deepEqual(pick(progressFor(s.code)), { kind: 'homework', done: 0, total: 2, percent: 0 });

  L.setHomeworkSubmitted(a, true, 'student');
  assert.deepEqual(pick(progressFor(s.code)), { kind: 'homework', done: 1, total: 2, percent: 50 });
});

test('graded work counts as done even if the submission was never recorded', () => {
  const s = freshStudent();
  const a = L.addHomework({ studentId: s.id, task: 'תרגיל' });
  L.gradeHomework(a, 'ok', 'teacher');
  assert.equal(progressFor(s.code).done, 1);
});

test('skills win over homework once the plan has anything assessed', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  L.addHomework({ studentId: s.id, task: 'תרגיל' });

  // A plan with nothing marked is a plan, not progress information — so it
  // must not push the child to 0% of a tree nobody has looked at.
  assert.equal(progressFor(s.code).kind, 'homework');

  P.addStatusEvent(planId, skills[0].id, 'with_help', { evidence: 'lesson' });
  const p = progressFor(s.code);
  assert.equal(p.kind, 'skills', 'understanding beats diligence once it is known');
  assert.deepEqual(pick(p), { kind: 'skills', done: 1, total: 4, percent: 25 });
});

test('"done with help" counts and "needs review" does not — the same rule the tutor sees', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addStatusEvent(planId, skills[0].id, 'with_help');
  P.addStatusEvent(planId, skills[1].id, 'independent');
  P.addStatusEvent(planId, skills[2].id, 'needs_review');
  P.addStatusEvent(planId, skills[3].id, 'guided');

  // Two of four. If this disagreed with the plan page, the same child would
  // be at two different places depending on who was looking.
  assert.deepEqual(pick(progressFor(s.code)), { kind: 'skills', done: 2, total: 4, percent: 50 });
});

test('a hidden skill is not counted against the child', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addStatusEvent(planId, skills[0].id, 'independent');
  P.setVisibility(planId, skills[3].id, 'hidden');

  const p = progressFor(s.code);
  assert.equal(p.total, 3, 'a skill the tutor put away is not part of the denominator');
  assert.equal(p.done, 1);
});

test('the percentage is always derivable from the two counts', () => {
  // The whole objection to the old number was that it could not be checked.
  const s = freshStudent();
  for (let i = 0; i < 3; i++) L.addHomework({ studentId: s.id, task: `t${i}` });
  const rows = L.homeworkForStudent(s.id);
  L.setHomeworkSubmitted(rows[0].id, true, 'student');

  const p = progressFor(s.code);
  assert.equal(p.percent, Math.round((p.done / p.total) * 100));
});

test('one student\'s progress never reflects another\'s', () => {
  const a = freshStudent();
  const b = freshStudent();
  const t = L.addHomework({ studentId: a.id, task: 'רק של א' });
  L.setHomeworkSubmitted(t, true, 'student');

  assert.equal(progressFor(a.code).done, 1);
  assert.equal(progressFor(b.code).kind, 'none');
});

test('an unknown code answers nothing rather than throwing', () => {
  const p = progressFor('no-such-student');
  assert.equal(p.kind, 'none');
  assert.equal(p.note, null);
});

/* PRODUCT.md, "Progress parents can see": a parent's page shows what was
   COVERED and what the child UNDERSTOOD. The percentage above answers only
   the second, and only as a count. `seen` names the skills. */

test('a skill taught in a lesson is listed as covered, before anyone has judged it', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addCoveredEvent(planId, skills[1].id);

  const { seen } = progressFor(s.code);
  assert.deepEqual(seen.covered, ['כלל המנה']);
  assert.deepEqual(seen.understood, []);
});

test('an understood skill leaves the covered list and carries its label', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addCoveredEvent(planId, skills[0].id);
  P.addCoveredEvent(planId, skills[1].id);
  P.addStatusEvent(planId, skills[0].id, 'independent');
  P.addStatusEvent(planId, skills[2].id, 'with_help');   // understood without a recorded lesson

  const { seen } = progressFor(s.code);
  assert.deepEqual(seen.covered, ['כלל המנה']);
  assert.deepEqual(seen.understood, [
    { title: 'חוקי חזקות', label: 'בוצע עצמאית' },
    { title: 'נגזרת שורש', label: 'בוצע עם עזרה' },
  ]);
});

test('covered and needing review stays "covered" — the family is not shown a verdict the tutor wrote for herself', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addCoveredEvent(planId, skills[3].id);
  P.addStatusEvent(planId, skills[3].id, 'needs_review');

  const { seen } = progressFor(s.code);
  assert.deepEqual(seen.covered, ['כלל השרשרת']);
  assert.doesNotMatch(JSON.stringify(seen), /needs_review|דורש חזרה/);
});

test('a hidden skill is not listed either way', () => {
  const s = freshStudent();
  const { planId, skills } = withPlan(s);
  P.addCoveredEvent(planId, skills[0].id);
  P.addStatusEvent(planId, skills[1].id, 'independent');
  P.setVisibility(planId, skills[0].id, 'hidden');
  P.setVisibility(planId, skills[1].id, 'hidden');

  assert.deepEqual(progressFor(s.code).seen, { covered: [], understood: [] });
});

test('no plan, no lists — null rather than two empty promises', () => {
  const s = freshStudent();
  L.addHomework({ studentId: s.id, task: 'תרגיל' });
  assert.equal(progressFor(s.code).seen, null);
  assert.equal(progressFor('no-such-student').seen, null);
});

const pick = (p) => ({ kind: p.kind, done: p.done, total: p.total, percent: p.percent });

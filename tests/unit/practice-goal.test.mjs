// tests/unit/practice-goal.test.mjs
//
// Each activity says what it practises. Step 2 of Todoist 6hRhqRvfX7VHgh9q
// asks for a practice goal per activity; the link to the skill already
// exists (homework.node_id, and game_skills for games, migration 014), so
// the goal is the skill's own name, not a new field for generation to fill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'goal-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');

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
  const student = E.createStudent({ code: `goal${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const nodes = S.planData(planId).nodes.filter(n => n.kind === 'skill');
  return { student, planId, nodes };
}

const skillOf = (studentId, task) => L.homeworkForStudent(studentId).find(h => h.task === task)?.skill;

test('homework names the skill it practises, and nothing when it has none', () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'תרגול מנה', nodeId: nodes[1].id });
  L.addHomework({ studentId: student.id, task: 'בלי מיומנות' });
  assert.equal(skillOf(student.id, 'תרגול מנה'), 'כלל המנה');
  assert.equal(skillOf(student.id, 'בלי מיומנות'), null);
});

test("a game finds its skill through the game's own link", () => {
  const { student, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'משחק', template: 'quiz', dataId: 'goal-g1' });
  T.linkGameToSkill(student.id, 'goal-g1', nodes[0].id);
  assert.equal(skillOf(student.id, 'משחק'), 'חוקי חזקות');
  assert.equal(T.practiceGoal(student.id, 'goal-g1'), 'חוקי חזקות');
  assert.equal(T.practiceGoal(student.id, 'no-such-game'), null);
});

test("a game is linked per student: another child's link names nothing here", () => {
  const a = freshPlan();
  const b = freshPlan();
  T.linkGameToSkill(a.student.id, 'goal-shared', a.nodes[0].id);
  assert.equal(T.practiceGoal(b.student.id, 'goal-shared'), null);
});

test('a skill the tutor hid from the plan is not named', () => {
  const { student, planId, nodes } = freshPlan();
  L.addHomework({ studentId: student.id, task: 'מוסתר', nodeId: nodes[1].id });
  T.linkGameToSkill(student.id, 'goal-g2', nodes[1].id);
  S.setVisibility(planId, nodes[1].id, 'hidden');
  assert.equal(skillOf(student.id, 'מוסתר'), null);
  assert.equal(T.practiceGoal(student.id, 'goal-g2'), null);
});

test('the families see it: both boards and the game page', () => {
  assert.match(read('src/lib/family-homework.ts'), /skill\?: string \| null;/);
  assert.match(read('src/routes/api/portal/[code]/+server.ts'), /skill: h\.skill \?\? null,/);
  assert.match(read('src/routes/app/student/+page.svelte'), /מתרגלים: \{h\.skill\}/);
  assert.match(read('src/routes/app/parent/+page.svelte'), /מתרגלים: \{h\.skill\}/);
  assert.match(read('src/routes/app/play/[template]/+page.server.ts'), /practiceGoal\(/);
  assert.match(read('src/lib/games/GameShell.svelte'), /מה מתרגלים: \{skill\}/);
});

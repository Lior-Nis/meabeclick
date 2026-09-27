// tests/unit/practice-help.test.mjs
//
// How much help a play needed, recorded and then USED.
//
// Todoist id:6hRhqRvfX7VHgh9q: «ניקוד ומהירות לבדם אינם הוכחה להבנה» —
// score and speed alone are not proof of understanding. A child who
// answered everything correctly after revealing every hint produced a
// perfect score and demonstrated something quite different from a child who
// answered cold, and until now nothing in the schema could tell them apart.
//
// This is also the input #100 had to do without: the design's own rule
// («≥2 plays, ≥80%, no hints on the last») was dropped there because there
// was no hints column and `tries` is not one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'help-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');
const EV = await import('../../src/lib/server/plans/evidence.ts');
const R = await import('../../src/lib/server/results.ts');
const { suggestStatus } = await import('../../src/lib/server/plans/suggest.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5', reviewed: null,
  topics: [{ key: 't', title: 'ת', branches: [{ key: 't.b', title: 'ב',
    skills: [{ key: 't.b.a', title: 'מיומנות', requires: [] }] }] }],
};

let seq = 0;
function fresh() {
  seq += 1;
  const account = E.createAccount({ name: `מ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `k${seq}`, name: `ת${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'י', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'ב' });
  const node = S.planData(planId).nodes.find(n => n.kind === 'skill');
  return { student, node };
}

test('a result records how much help it needed', () => {
  const { student } = fresh();
  R.writeResult({ studentId: student.id, dataId: 'd', template: 'matching', score: 5, total: 5, hints: 3 });
  const row = handle().prepare(`SELECT hints FROM results_v2 WHERE student_id = ?`).get(student.id);
  assert.equal(row.hints, 3);
});

test('a play that measured nothing stores null, not zero', () => {
  // Null is "we did not measure"; zero is "needed no help". A play from a
  // template with no hints to offer, or from before this column existed,
  // must not read as unaided.
  const { student } = fresh();
  R.writeResult({ studentId: student.id, dataId: 'd', template: 'quiz', score: 5, total: 5 });
  const row = handle().prepare(`SELECT hints FROM results_v2 WHERE student_id = ?`).get(student.id);
  assert.equal(row.hints, null);
});

test('evidence carries help usage through to the engine', () => {
  const { student, node } = fresh();
  T.linkGameToSkill(student.id, 'd1', node.id);
  R.writeResult({ studentId: student.id, dataId: 'd1', template: 'matching', score: 9, total: 10, hints: 2 });
  const ev = EV.evidenceForSkill(student.id, node.id);
  assert.equal(ev.plays[0].hints, 2);
});

// ── The rule #100 had to drop, restored ─────────────────────────────────

const play = (at, score, hints) => ({ at, score, total: 10, hints });

test('strong plays needing no help still reach with_help', () => {
  const s = suggestStatus({ plays: [play('2026-09-01', 9, 0), play('2026-09-03', 10, 0)], homework: [] });
  assert.equal(s.status, 'with_help');
});

test('help on the latest play blocks independent', () => {
  // Two contexts agreeing is what independent rests on. A play that needed
  // hints is not the second context — it is the first one again, with more
  // support.
  const s = suggestStatus({
    plays: [play('2026-09-01', 9, 0), play('2026-09-03', 10, 2)],
    homework: [{ at: '2026-09-04', grade: 'ok', submitted: true }],
  });
  assert.equal(s.status, 'with_help');
  assert.match(s.why, /רמז/, 'and it must say why, or the tutor cannot check it');
});

test('help on an EARLIER play does not block independent', () => {
  // Needing a hint and then not needing one is what learning looks like.
  const s = suggestStatus({
    plays: [play('2026-09-01', 9, 3), play('2026-09-03', 10, 0)],
    homework: [{ at: '2026-09-04', grade: 'ok', submitted: true }],
  });
  assert.equal(s.status, 'independent');
});

test('a template that offers no hints does not block independent', () => {
  // My first version of this rule treated null as "we do not know" and
  // blocked. That was wrong, and an existing test caught it: most
  // templates offer no hints at all, so null is the normal case and the
  // rule would have made independent unreachable for every quiz ever
  // played — a guard that never lets anything through is not a guard.
  //
  // A child cannot use help that was never on offer. Only help ACTUALLY
  // used blocks, and independent still additionally requires a graded
  // piece of homework, so it never rests on this signal alone.
  const s = suggestStatus({
    plays: [play('2026-09-01', 9, 0), { at: '2026-09-03', score: 10, total: 10, hints: null }],
    homework: [{ at: '2026-09-04', grade: 'ok', submitted: true }],
  });
  assert.equal(s.status, 'independent');
});

// ── The template that actually offers help ──────────────────────────────

test('matching offers a hint on demand and counts it', () => {
  const src = readFileSync(new URL('../../src/lib/games/Matching.svelte', import.meta.url), 'utf8');
  assert.match(src, /hintsUsed/, 'the count must exist');
  assert.match(src, /hints: hintsUsed/, 'and must reach the result payload');
  // A hint the child asks for, not one shown after they answer — the
  // existing `hint` field was only ever explanatory feedback AFTER a
  // correct match, which measures nothing about what they needed.
  assert.match(src, /onclick=\{[^}]*revealHint/, 'reached by the child pressing it');
});

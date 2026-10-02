/**
 * What a filed lesson report does to that lesson's held homework (spec D3,
 * D4): replace it with homework from what was taught, release it as it is,
 * or — when it has already gone out — nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'report-hw-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const { handle } = await import('../../src/lib/server/db.ts');
const { afterReport } = await import('../../src/lib/server/reports/after.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{ key: 't', title: 'נושא', branches: [{ key: 't.b', title: 'ענף', skills: [
    { key: 't.b.a', title: 'חוקי חזקות', requires: [] },
    { key: 't.b.b', title: 'כלל המנה', requires: [] },
  ] }] }],
};

const HELD = '2099-01-01T00:00:00.000Z';
let seq = 0;
function lesson() {
  seq += 1;
  const account = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `rh${seq}`, name: `s${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`
  ).run(student.id, enrollment.id);
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  const planId = P.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const skills = P.planData(planId).nodes.filter(n => n.kind === 'skill');
  L.addHomework({ studentId: student.id, task: 'planned', bookingId, heldUntil: HELD });
  return { student, bookingId, skills };
}
const visible = (s) => L.homeworkForStudent(s.id).map(h => h.task);

test('a report with covered skills replaces the planned homework with taught homework', async () => {
  const { student, bookingId, skills } = lesson();
  let seen;
  const outcome = await afterReport(
    { bookingId, note: 'התקשתה', nodeIds: [skills[1].id] },
    { generate: async (ctx) => { seen = ctx; return [{ task: 'מנה 1', nodeId: skills[1].id }]; } },
  );
  assert.equal(outcome, 'replaced');
  assert.deepEqual(visible(student), ['מנה 1']);
  assert.equal(L.homeworkForStudent(student.id)[0].node_id, skills[1].id);
  assert.deepEqual(seen.skills, [{ key: 't.b.b', title: 'כלל המנה', nodeId: skills[1].id }]);
  assert.equal(seen.note, 'התקשתה');
  assert.equal(seen.level, 'כיתה יא');
});

test('a failed generation sends the planned homework and tells the tutor', async () => {
  const { student, bookingId, skills } = lesson();
  const told = [];
  const outcome = await afterReport(
    { bookingId, note: null, nodeIds: [skills[0].id] },
    { generate: async () => { throw new Error('engine down'); }, notify: (t) => { told.push(t); } },
  );
  assert.equal(outcome, 'released-after-failure');
  assert.deepEqual(visible(student), ['planned']);
  assert.equal(told.length, 1);
  assert.match(told[0], /נשלחו שיעורי הבית שהוכנו מראש/);
});

test('a note-only report sends the planned homework as it is', async () => {
  const { student, bookingId } = lesson();
  let called = false;
  const outcome = await afterReport({ bookingId, note: 'שיעור טוב', nodeIds: [] },
    { generate: async () => { called = true; return []; } });
  assert.equal(outcome, 'released');
  assert.equal(called, false);
  assert.deepEqual(visible(student), ['planned']);
});

test('a second filing after a replace does not write a second set', async () => {
  const { student, bookingId, skills } = lesson();
  const generate = async () => [{ task: 'once', nodeId: skills[0].id }];
  await afterReport({ bookingId, note: null, nodeIds: [skills[0].id] }, { generate });
  const again = await afterReport({ bookingId, note: 'תיקון', nodeIds: [skills[0].id] }, { generate });
  assert.equal(again, 'none');
  assert.deepEqual(visible(student), ['once']);
});

test('a report after the planned homework already went out changes nothing', async () => {
  const { student, bookingId, skills } = lesson();
  let called = false;
  const outcome = await afterReport(
    { bookingId, note: null, nodeIds: [skills[0].id] },
    { generate: async () => { called = true; return []; }, now: '2099-01-02T00:00:00.000Z' },
  );
  assert.equal(outcome, 'none');
  assert.equal(called, false);
  assert.deepEqual(L.homeworkForStudent(student.id, { includeHeld: true }).map(h => h.task), ['planned']);
});

test('the reports route runs it after a filing, without making the tutor wait', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(join(process.cwd(), 'src/routes/api/reports/+server.ts'), 'utf8');
  const filed = route.indexOf('fileReport({');
  const call = route.indexOf('afterReport(');
  assert.ok(filed > 0 && call > filed, 'only after fileReport has committed');
  assert.doesNotMatch(route, /await\s+afterReport\(/, 'an agent run must not hold the response');
  assert.match(route.slice(call, call + 300), /nodeIds:\s*entries\.map\(e => e\.nodeId\)/);
  assert.match(route.slice(call, call + 300), /\.catch\(/);
});

/* Final review, Important 1 and 2: the "still held?" check ran BEFORE a
   generation that can take minutes, and the replace did not repeat it. */

test('two filings in quick succession write one set, not two', async () => {
  const { student, bookingId, skills } = lesson();
  const slow = async () => { await new Promise(r => setTimeout(r, 30)); return [{ task: 'taught', nodeId: skills[0].id }]; };
  const outcomes = await Promise.all([
    afterReport({ bookingId, note: null, nodeIds: [skills[0].id] }, { generate: slow }),
    afterReport({ bookingId, note: 'typo fixed', nodeIds: [skills[0].id] }, { generate: slow }),
  ]);
  assert.deepEqual(outcomes.sort(), ['none', 'replaced']);
  assert.deepEqual(visible(student), ['taught']);
});

test('a release that lands while generating wins; the taught set is not added on top', async () => {
  const { student, bookingId, skills } = lesson();
  const outcome = await afterReport({ bookingId, note: null, nodeIds: [skills[0].id] }, {
    generate: async () => { L.releaseHeld(bookingId); return [{ task: 'taught', nodeId: skills[0].id }]; },
  });
  assert.equal(outcome, 'none');
  assert.deepEqual(visible(student), ['planned']);
});

test('a replace never deletes homework the family can already see', () => {
  const { student, bookingId, skills } = lesson();
  const after = '2099-01-02T00:00:00.000Z'; // past held_until: it has gone out
  assert.equal(L.replaceHeld(bookingId, student.id, [{ task: 'late', nodeId: skills[0].id }], after), false);
  assert.deepEqual(L.homeworkForStudent(student.id, { now: after }).map(h => h.task), ['planned']);
});

/* While the engine is down (production's Codex, 30.9–12.10), every report's
   generation fails. A covered skill with a ready library lesson already has
   homework written for exactly that skill, with its answer key — so the
   child gets that, not the homework planned before the lesson. */
function master(skillKey, homework) {
  const now = new Date().toISOString();
  const slug = `lib-demo-${skillKey.replace(/\./g, '-')}-${seq}`;
  handle().prepare(`INSERT OR REPLACE INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('demo', ?, ?, 'ready', ?)`).run(skillKey, slug, now);
  handle().prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, 'plan', 1, ?, 'generated', ?, ?)`)
    .run(slug, JSON.stringify({ title: 't', gradeContext: 'c', slides: [], examples: [], homework, games: {} }), now, now);
}

test('when generation fails, a covered skill\'s library lesson supplies the homework, with its answer key', async () => {
  const { student, bookingId, skills } = lesson();
  master('t.b.b', [{ task: 'מנה מהספרייה 1', why: 'w', answer: 'ק1' }, { task: 'מנה מהספרייה 2', why: 'w', answer: 'ק2' }]);
  const told = [];
  const outcome = await afterReport(
    { bookingId, note: null, nodeIds: [skills[1].id] },
    { generate: async () => { throw new Error('engine down'); }, notify: (t) => { told.push(t); } },
  );
  assert.equal(outcome, 'replaced-from-library');
  assert.deepEqual(visible(student), ['מנה מהספרייה 1', 'מנה מהספרייה 2']);
  const rows = L.homeworkForStudent(student.id);
  assert.ok(rows.every(r => r.node_id === skills[1].id), 'linked to the skill it practises');
  assert.deepEqual(handle().prepare(`SELECT answer FROM homework WHERE student_id = ? ORDER BY id`).all(student.id).map(r => r.answer), ['ק1', 'ק2']);
  assert.equal(told.length, 1);
  assert.match(told[0], /מהספרייה/);
  assert.doesNotMatch(told[0], /⚠️/, 'not an alarm: the child got homework for what was taught');
});

test('from the library: at most five tasks across the covered skills, and only skills with a ready lesson', async () => {
  const { student, bookingId, skills } = lesson();
  master('t.b.a', [1, 2, 3, 4].map(n => ({ task: `חזקות ${n}`, why: 'w' })));
  master('t.b.b', [1, 2, 3, 4].map(n => ({ task: `מנה ${n}`, why: 'w' })));
  const outcome = await afterReport(
    { bookingId, note: null, nodeIds: [skills[0].id, skills[1].id] },
    { generate: async () => { throw new Error('engine down'); } },
  );
  assert.equal(outcome, 'replaced-from-library');
  const tasks = visible(student);
  assert.equal(tasks.length, 5);
  assert.ok(tasks.some(t => t.startsWith('חזקות')) && tasks.some(t => t.startsWith('מנה')), 'both skills get some');
});

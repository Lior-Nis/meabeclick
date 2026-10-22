/**
 * scripts/skills-covered.mjs: which skills were marked covered, across
 * students, with names and counts only. Read-only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'skills-covered-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');   // legacy tables + migrations
handle();
const { skillsCovered, parseArgs } = await import('../../scripts/skills-covered.mjs');

const NOW = new Date('2026-10-22T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const db = new DatabaseSync(process.env.DB_PATH);
db.exec(`
  INSERT INTO accounts (id, name, credential, created_at) VALUES (1, 'a', 'x', '${daysAgo(90)}');
  INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
    (1, 's1', 'Noa', 1, 'x', '${daysAgo(90)}'),
    (2, 's2', 'Yael', 1, 'x', '${daysAgo(90)}'),
    (3, 's3', 'Omer', 1, 'x', '${daysAgo(90)}');
  INSERT INTO enrollments (id, student_id, subject) VALUES
    (1, 1, 'מתמטיקה'), (2, 2, 'מתמטיקה'), (3, 3, 'מתמטיקה');
  INSERT INTO plans (id, student_id, enrollment_id, template_id, template_version, goal, created_at) VALUES
    (1, 1, 1, 'math-4u', 1, 'g', '${daysAgo(60)}'),
    (2, 2, 2, 'math-4u', 1, 'g', '${daysAgo(60)}'),
    (3, 3, 3, 'math-3u', 1, 'g', '${daysAgo(60)}');
`);

/* Every plan is its own copy of the template: same keys, different ids. */
const node = db.prepare(
  `INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position) VALUES (?, ?, ?, ?, ?, 0)`);
const ids = {};
for (const plan of [1, 2, 3]) {
  const topic = Number(node.run(plan, 'alg', null, 'topic', 'אלגברה').lastInsertRowid);
  const branch = Number(node.run(plan, 'alg.eq', topic, 'branch', 'משוואות').lastInsertRowid);
  ids[plan] = {
    linear: Number(node.run(plan, 'alg.eq.linear', branch, 'skill', 'משוואה ממעלה ראשונה').lastInsertRowid),
    quad: Number(node.run(plan, 'alg.eq.quad', branch, 'skill', 'משוואה ריבועית').lastInsertRowid),
  };
}

const ev = db.prepare(
  `INSERT INTO plan_events (plan_id, node_id, type, status, source, at) VALUES (?, ?, ?, ?, ?, ?)`);
ev.run(1, ids[1].linear, 'covered', null, 'report', daysAgo(2));
ev.run(1, ids[1].linear, 'covered', null, 'teacher', daysAgo(1));   // same student again: 2 times, 1 student
ev.run(2, ids[2].linear, 'covered', null, 'report', daysAgo(3));
ev.run(1, ids[1].quad, 'covered', null, 'report', daysAgo(4));      // one student only
ev.run(2, ids[2].quad, 'status', 'guided', 'report', daysAgo(4));  // status is not coverage
ev.run(2, ids[2].quad, 'covered', null, 'report', daysAgo(20));     // outside 7 days, inside 30
ev.run(3, ids[3].linear, 'covered', null, 'report', daysAgo(2));    // another template: its own skill
ev.run(1, ids[1].quad, 'covered', null, 'report', daysAgo(-1));     // future: excluded

test('counts distinct students and times per template skill, last 7 days, ≥ 2 students', () => {
  const r = skillsCovered(db, NOW);
  assert.deepEqual(r.rows, [
    { template: 'math-4u', topic: 'אלגברה', skill: 'משוואה ממעלה ראשונה', students: 2, times: 3 },
  ]);
  assert.deepEqual(r.totals, { events: 5, skills: 3, students: 3, belowThreshold: 2 });
});

test('30 days and a lower threshold widen the window and the rows', () => {
  const r = skillsCovered(db, NOW, { days: 30, minStudents: 1 });
  assert.deepEqual(r.rows.map((x) => [x.template, x.skill, x.students, x.times]), [
    ['math-4u', 'משוואה ממעלה ראשונה', 2, 3],
    ['math-4u', 'משוואה ריבועית', 2, 2],
    ['math-3u', 'משוואה ממעלה ראשונה', 1, 1],
  ]);
});

test('the output names no student', () => {
  const text = JSON.stringify(skillsCovered(db, NOW, { days: 30, minStudents: 1 }));
  for (const s of ['Noa', 'Yael', 'Omer', 's1', 's2', 's3', 'student_id']) assert.ok(!text.includes(s), s);
});

test('parseArgs: defaults, flags, and refusals', () => {
  assert.deepEqual(parseArgs([]), { days: 7, minStudents: 2, json: false });
  assert.deepEqual(parseArgs(['--days', '30', '--min-students', '1', '--json']), { days: 30, minStudents: 1, json: true });
  assert.throws(() => parseArgs(['--days', '0']));
  assert.throws(() => parseArgs(['--min-students', 'x']));
});

test('runs piped to `node -` like over ssh, read-only', () => {
  const before = db.prepare(`SELECT COUNT(*) n FROM plan_events`).get().n;
  const out = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-', '--json', '--days', '3650'], {
    input: readFileSync('scripts/skills-covered.mjs'),
    env: { ...process.env, DB_PATH: process.env.DB_PATH },
  }).toString();
  const r = JSON.parse(out);
  assert.equal(r.days, 3650);
  assert.equal(r.rows[0].skill, 'משוואה ממעלה ראשונה');
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM plan_events`).get().n, before);
});

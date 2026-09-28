// tests/unit/homework-answer-key.test.mjs
//
// An answer key for written homework, for the tutor only — Lior agreed
// 2026-09-28 (Todoist 6hRhqRvfX7VHgh9q, "separate the solutions for the
// tutor"). Both generators ask for it: the one at booking (prep.ts) and the
// one from what was taught (lesson/homework.ts). It is stored with the task
// and reaches the tutor's dashboard — never a family's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'answer-key-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const H = await import('../../src/lib/server/lesson/homework.ts');
const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');

const skills = [{ key: 'alg.eq', title: 'משוואות', nodeId: 11 }];

test('homework from what was taught asks for an answer key, apart from the task', () => {
  const prompt = H.buildHomeworkPrompt({ subject: 'מתמטיקה', level: 'כיתה ח', note: '', skills });
  assert.match(prompt, /"answer":/);
  assert.match(prompt, /למורה בלבד/);
});

test('the answer is kept apart from the task, and missing or overlong answers are handled', () => {
  const raw = JSON.stringify({ homework: [
    { task: 'פתרו 2x+3=11', why: 'תרגול', skillKey: 'alg.eq', answer: 'x=4' },
    { task: 'פתרו 5x=20', why: '', skillKey: 'alg.eq' },
    { task: 'פתרו x-1=0', why: '', skillKey: 'alg.eq', answer: 'א'.repeat(5000) },
  ] });
  const tasks = H.parseTaughtHomework(raw, skills);
  assert.equal(tasks[0].answer, 'x=4');
  assert.doesNotMatch(tasks[0].task, /x=4/, 'the answer is not in the task the child reads');
  assert.equal(tasks[1].answer, null);
  assert.equal(tasks[2].answer.length, 1000);
});

test('the answer is stored with the task, both at booking and when the report replaces it', () => {
  const account = E.createAccount({ name: 'משפחה', phone: null, credential: 'x' });
  const student = E.createStudent({ code: 'key1', name: 'נוגה', accountId: account.id, credential: 'x' });
  L.addHomework({ studentId: student.id, task: 'דף עבודה', answer: '1) 4  2) 7', bookingId: 900, heldUntil: '2999-01-01T00:00:00.000Z' });
  assert.equal(L.homeworkForStudent(student.id, { includeHeld: true })[0].answer, '1) 4  2) 7');

  assert.equal(L.replaceHeld(900, student.id, [{ task: 'מה שנלמד', nodeId: null, answer: 'x=3' }]), true);
  const rows = L.homeworkForStudent(student.id, { includeHeld: true });
  assert.deepEqual(rows.map(r => [r.task, r.answer]), [['מה שנלמד', 'x=3']]);
});

test('the booking-time lesson asks for it too, and a lesson without one still publishes', () => {
  const prep = read('src/lib/server/lesson/prep.ts');
  assert.match(prep, /required: \['task', 'why', 'answer'\]/);
  assert.match(prep, /תשובון למורה/);
  assert.match(read('src/lib/server/lesson/queue.ts'), /answer: h\.answer \?\? null/);
});

test('the tutor sees it; no family route carries it', () => {
  assert.match(read('src/lib/tutor-homework.ts'), /answer: string \| null;/);
  assert.match(read('src/routes/api/students/[code]/activity/+server.ts'), /answer: h\.answer \?\? null,/);
  assert.match(read('src/routes/app/dashboard/+page.svelte'), /🔑 תשובון/);
  assert.doesNotMatch(read('src/lib/family-homework.ts'), /answer/);
  for (const f of ['src/routes/api/portal/[code]/+server.ts', 'src/routes/api/portal/[code]/homework/+server.ts']) {
    assert.doesNotMatch(read(f), /\bh\.answer\b|\banswer:/, f);
  }
});

/**
 * After a report, the child gets games for what was actually taught.
 *
 * A lesson's games come from the skill it was planned for. When the report
 * says another skill was covered, and that skill has a ready library
 * lesson, its games are copied into this lesson (new ids — a published game
 * file is never rewritten) and linked to the skill they practise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'report-games-'));
process.env.DATA_DIR = dir;
process.env.DB_PATH = join(dir, 'results.db');
process.env.PORTAL_DIR = join(dir, 'portal');
const { mkdir, writeFile: write } = await import('node:fs/promises');
await mkdir(process.env.PORTAL_DIR, { recursive: true });
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/plans/store.ts');
const L = await import('../../src/lib/server/lessons.ts');
const { handle, createLesson, finishLesson, readLessons } = await import('../../src/lib/server/db.ts');
const { afterReport } = await import('../../src/lib/server/reports/after.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '4 יח״ל', reviewed: null,
  topics: [{ key: 't', title: 'נושא', branches: [{ key: 't.b', title: 'ענף', skills: [
    { key: 't.b.a', title: 'חוקי חזקות', requires: [] },
    { key: 't.b.b', title: 'כלל המנה', requires: [] },
    { key: 't.b.c', title: 'כלל השרשרת', requires: [] },
  ] }] }],
};

let seq = 0;
async function lesson() {
  seq += 1;
  const account = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `rg${seq}`, name: `נוגה ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const start = `2026-06-0${seq}T14:00:00.000Z`;
  handle().prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status) VALUES (?, ?, ?, ?, 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(student.id, enrollment.id, start, start);
  const bookingId = Number(handle().prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
  const planId = P.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });
  const skills = P.planData(planId).nodes.filter(n => n.kind === 'skill');
  /* The child's page reads its games from this file (queue.ts appendToPortal). */
  await write(join(process.env.PORTAL_DIR, `${student.code}.json`), JSON.stringify({ name: student.name, games: [{ title: 'own', template: 'quiz', dataId: 'x-quiz' }] }));
  const slug = `noga-${seq}-lesson`;
  createLesson({ slug, student: student.name, subject: 'מתמטיקה', level: 'כיתה יא', topic: 't', lessonAt: start });
  finishLesson(slug, { status: 'ready', title: 't', games: [{ title: 'own', template: 'quiz', dataId: `${slug}-quiz` }] });
  return { student, bookingId, skills, slug };
}

function master(skillKey, games) {
  const now = new Date().toISOString();
  const slug = `lib-demo-${skillKey.replace(/\./g, '-')}-${seq}`;
  handle().prepare(`INSERT OR REPLACE INTO library_items (template_id, skill_key, slug, status, updated_at) VALUES ('demo', ?, ?, 'ready', ?)`).run(skillKey, slug, now);
  handle().prepare(`INSERT INTO lesson_materials (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, 'plan', 1, ?, 'generated', ?, ?)`)
    .run(slug, JSON.stringify({ title: 't', gradeContext: 'c', slides: [], examples: [], homework: [], games }), now, now);
  return slug;
}

const twoTruths = (s) => ({ title: `שתיים ${s}`, subject: 'm', rounds: [{ statements: [`${s}1`, `${s}2`, `${s}3`], lieIndex: 1, why: '', hint: '' }] });
const sequence = (s) => ({ title: `סדר ${s}`, subject: 'm', steps: [`${s}א`, `${s}ב`, `${s}ג`] });
const quiz = (s) => ({ title: `חידון ${s}`, subject: 'm', questions: [{ q: s, options: ['a', 'b'], answer: 0, why: '', hint: '' }] });

const gamesOf = (slug) => readLessons().find(l => l.slug === slug).games;
const fail = { generate: async () => { throw new Error('engine down'); } };

test("a covered skill's library games join the lesson, linked to that skill", async () => {
  const { student, bookingId, skills, slug } = await lesson();
  master('t.b.b', { twoTruths: twoTruths('מנה'), sequence: sequence('מנה'), quiz: quiz('מנה') });
  await afterReport({ bookingId, note: null, nodeIds: [skills[1].id] }, fail);

  const games = gamesOf(slug);
  assert.equal(games[0].title, 'own', "the lesson's own games stay first");
  const added = games.slice(1);
  assert.equal(added.length, 2, 'two per skill');
  for (const g of added) {
    assert.notEqual(g.dataId, `${slug}-quiz`);
    const file = join(dir, 'games-data', `${g.dataId}.json`);
    assert.ok(existsSync(file), `${g.dataId} written`);
    assert.match(await readFile(file, 'utf8'), /מנה/);
    const link = handle().prepare(`SELECT node_id FROM game_skills WHERE student_id = ? AND data_id = ?`).get(student.id, g.dataId);
    assert.equal(link?.node_id, skills[1].id, 'linked to the skill it practises');
  }
  const portal = JSON.parse(await readFile(join(process.env.PORTAL_DIR, `${student.code}.json`), 'utf8'));
  assert.deepEqual(portal.games.map(g => g.dataId), [...added.map(g => g.dataId), 'x-quiz'], "on the child's page, newest first");
});

test('a skill without a ready lesson adds nothing; nor does the master this lesson was copied from', async () => {
  const { bookingId, skills, slug } = await lesson();
  const source = master('t.b.a', { twoTruths: twoTruths('חזקות') });
  handle().prepare(`INSERT INTO library_uses (lesson_slug, master_slug, template_id, skill_key, at) VALUES (?, ?, 'demo', 't.b.a', ?)`)
    .run(slug, source, new Date().toISOString());
  await afterReport({ bookingId, note: null, nodeIds: [skills[0].id, skills[2].id] }, fail);
  assert.equal(gamesOf(slug).length, 1, 'only its own game');
});

test('a second filing does not add the same games again', async () => {
  const { bookingId, skills, slug } = await lesson();
  master('t.b.c', { twoTruths: twoTruths('שרשרת') });
  await afterReport({ bookingId, note: null, nodeIds: [skills[2].id] }, fail);
  await afterReport({ bookingId, note: null, nodeIds: [skills[2].id] }, fail);
  assert.equal(gamesOf(slug).length, 2);
});

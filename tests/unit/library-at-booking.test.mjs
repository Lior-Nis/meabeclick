// tests/unit/library-at-booking.test.mjs
//
// A booking whose target skill has a ready library item gets a copy of the
// master, with no engine run: see
// docs/superpowers/specs/2026-09-28-prepared-library-design.md.
// No engine credentials exist here on purpose. A lesson that arrives
// anyway can only have come from the library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'lib-booking-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
process.env.PORTAL_DIR = join(dataDir, 'portal');
process.env.CODEX_HOME = join(dataDir, 'no-codex');
delete process.env.OPENAI_API_KEY;
await mkdir(process.env.PORTAL_DIR, { recursive: true });

const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const T = await import('../../src/lib/server/lesson/targeting.ts');
const P = await import('../../src/lib/server/library/prepare.ts');
const U = await import('../../src/lib/server/library/use.ts');
const HW = await import('../../src/lib/server/lessons.ts');
const DB = await import('../../src/lib/server/db.ts');
const { templateById } = await import('../../src/lib/server/plans/templates.ts');
const { triggerForBooking } = await import('../../src/lib/server/lesson/queue.ts');

const plan = (title) => ({
  title,
  gradeContext: 'כיתה ח',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['נקודה'] })),
  examples: [{ problem: '2+2', steps: ['מחברים'], answer: '4' }],
  homework: [{ task: 'תרגיל מהספרייה', why: 'תרגול', answer: 'x=4' }, { task: 'תרגיל שני', why: 'תרגול', answer: 'x=5' }],
  games: {
    quiz: { title: 'חידון', questions: [
      { q: 'שאלה 1', options: ['א', 'ב', 'ג'], answer: 0 },
      { q: 'שאלה 2', options: ['א', 'ב', 'ג'], answer: 1 },
      { q: 'שאלה 3', options: ['א', 'ב', 'ג'], answer: 2 },
    ] },
    sequence: { title: 'סדר', steps: ['ראשון', 'שני', 'שלישי'] },
  },
});

let seq = 0;
async function studentWithPlan() {
  seq += 1;
  const code = `libkid${seq}`;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code, name: 'נוגה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה ח', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template: templateById('math-8'), goal: 'כיתה ח' });
  await writeFile(join(process.env.PORTAL_DIR, `${code}.json`), JSON.stringify({ name: 'נוגה', lessons: [], homework: [], games: [] }));
  return { code, student };
}

function collector() {
  let resolve;
  const first = new Promise(r => { resolve = r; });
  return { first, notify: (t) => resolve(t) };
}
const booking = { name: 'נוגה', subject: 'מתמטיקה', level: 'כיתה ח', start: '2027-01-10T10:00:00+02:00', end: '2027-01-10T11:30:00+02:00', durationMin: 90 };

test("the target names its template and skill key, so the library can be asked", async () => {
  const { code } = await studentWithPlan();
  const target = T.targetSkillFor(code, 'מתמטיקה');
  assert.equal(target.templateId, 'math-8');
  assert.equal(typeof target.key, 'string');
  assert.ok(templateById('math-8').topics.some(t => t.branches.some(b => b.skills.some(s => s.key === target.key && s.title === target.title))));
});

test('with a ready library item, the booking gets a copy of the master — no engine, straight to the child', async () => {
  const { code, student } = await studentWithPlan();
  const target = T.targetSkillFor(code, 'מתמטיקה');
  const master = await P.prepareSkill('math-8', target.key, { generate: async () => plan('שיעור מהספרייה') });
  assert.equal(master.status, 'ready');

  const c = collector();
  const r = triggerForBooking(booking, { notify: c.notify, enrolledCode: code, bookingId: 501 });
  assert.equal(r.started, true, 'no credentials, and still started: nothing needs the engine');
  assert.match(await c.first, /מהספרייה/);

  const lesson = DB.readLessons().find(l => l.slug === r.slug);
  assert.equal(lesson.status, 'ready');
  assert.equal(lesson.title, 'שיעור מהספרייה');
  assert.notEqual(r.slug, master.slug, 'a copy, with its own slug');
  assert.equal(U.librarySourceOf(r.slug), master.slug);

  const portal = JSON.parse(await readFile(join(process.env.PORTAL_DIR, `${code}.json`), 'utf8'));
  assert.equal(portal.lessons[0].slug, r.slug);
  const hw = HW.homeworkForStudent(student.id, { includeHeld: true });
  assert.deepEqual(hw.map(h => [h.task, h.answer]).sort(), [['תרגיל מהספרייה', 'x=4'], ['תרגיל שני', 'x=5']]);
  assert.ok(hw.every(h => h.node_id != null), 'tagged with the skill, as a generated lesson would be');
});

test("the copy follows the master's published edits", async () => {
  const { code } = await studentWithPlan();
  const target = T.targetSkillFor(code, 'מתמטיקה');
  const master = U.readyMaster('math-8', target.key);
  assert.ok(master, 'the master prepared above');
  const { addMaterial } = await import('../../src/lib/server/materials.ts');
  const edited = { ...plan('שיעור מהספרייה, בעריכה'), homework: [{ task: 'תרגיל ערוך', why: '', answer: '7' }, { task: 'עוד', why: '', answer: '8' }] };
  addMaterial({ slug: master.slug, kind: 'plan', content: JSON.stringify(edited), origin: 'edited', publish: true });

  const c = collector();
  const r = triggerForBooking({ ...booking, start: '2027-01-11T10:00:00+02:00', end: '2027-01-11T11:30:00+02:00' }, { notify: c.notify, enrolledCode: code, bookingId: 502 });
  await c.first;
  assert.equal(DB.readLessons().find(l => l.slug === r.slug).title, 'שיעור מהספרייה, בעריכה');
});

test('a copy that fails validation is held — and still recorded as a copy, never as an engine run', async () => {
  const { code } = await studentWithPlan();
  const target = T.targetSkillFor(code, 'מתמטיקה');
  const master = U.readyMaster('math-8', target.key);
  const { addMaterial } = await import('../../src/lib/server/materials.ts');
  // A published edit that broke it: one game where two are required.
  const broken = { ...plan('שבור'), games: { quiz: plan('x').games.quiz } };
  addMaterial({ slug: master.slug, kind: 'plan', content: JSON.stringify(broken), origin: 'edited', publish: true });

  const c = collector();
  const r = triggerForBooking({ ...booking, start: '2027-01-12T10:00:00+02:00', end: '2027-01-12T11:30:00+02:00' }, { notify: c.notify, enrolledCode: code, bookingId: 503 });
  await c.first;
  assert.equal(DB.readLessons().find(l => l.slug === r.slug).status, 'held');
  assert.equal(U.librarySourceOf(r.slug), master.slug, 'held, and still a copy: the gate must not count it');
});

test('without a ready item, nothing changes: no credentials still means no lesson', async () => {
  const { code } = await studentWithPlan();
  const target = T.targetSkillFor(code, 'מתמטיקה');
  const { setItem } = await import('../../src/lib/server/library/store.ts');
  setItem({ templateId: 'math-8', skillKey: target.key, status: 'held', problem: 'x' });
  const r = triggerForBooking(booking, { notify: () => {}, enrolledCode: code });
  assert.equal(r.skipped, 'no credentials');
});

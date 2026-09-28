// tests/unit/maths-only-autopilot.test.mjs
//
// Physics, Hebrew, programming and "other" are booked and taught, but not
// prepared automatically: the plans and the generation are maths only
// (PRODUCT.md non-goal). Lior's decision, 2026-09-28 (Todoist 6hfCvVrg8gVQwMjq):
// keep the subjects, without lesson generation.
//
// "Without" means nothing at all happens for them — not a failed lesson on
// the dashboard, not a WhatsApp alarm, and not a row that breaks the gate's
// run of clean generations (scripts/vision-metrics.mjs counts `lessons`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'maths-only-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
delete process.env.OPENAI_API_KEY;
process.env.CODEX_HOME = join(dataDir, 'no-codex');

const SUBJ = await import('../../src/lib/subjects.ts');
const { triggerForBooking } = await import('../../src/lib/server/lesson/queue.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const lessonRows = () => handle().prepare('SELECT COUNT(*) AS n FROM lessons').get().n;
const booking = (subject) => ({
  name: 'נוגה', subject, level: 'כיתה ח', phone: '0501234567',
  start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00', durationMin: 90,
});

test('only maths is prepared automatically', () => {
  assert.equal(SUBJ.autopilotCovers('מתמטיקה'), true);
  assert.equal(SUBJ.autopilotCovers(' מתמטיקה '), true);
  for (const s of ['פיזיקה', 'עברית', 'תכנות', 'אחר', '']) assert.equal(SUBJ.autopilotCovers(s), false, s);
  assert.deepEqual([...SUBJ.SUBJECTS], ['מתמטיקה', 'פיזיקה', 'עברית', 'תכנות', 'אחר']);
});

test('a physics booking starts nothing, records nothing and alarms no one', () => {
  const before = lessonRows();
  const told = [];
  const r = triggerForBooking(booking('פיזיקה'), { notify: (t) => told.push(t) });
  assert.deepEqual(r, { skipped: 'not maths' });
  assert.equal(lessonRows(), before, 'no lesson row, so no failed lesson and no broken streak');
  assert.deepEqual(told, []);
});

test('a maths booking is still attempted (here: no credentials, said as before)', () => {
  const r = triggerForBooking(booking('מתמטיקה'), { notify: () => {} });
  assert.equal(r.skipped, 'no credentials');
});

test('the booking form offers the declared subjects, and the tutor is told which lessons are hers to prepare', async () => {
  const page = await readFile(join(process.cwd(), 'src/routes/booking/+page.svelte'), 'utf8');
  assert.match(page, /\{#each SUBJECTS as s\}<option>\{s\}<\/option>\{\/each\}/);
  assert.doesNotMatch(page, /<option>פיזיקה<\/option>/, 'not typed twice');
  const email = await readFile(join(process.cwd(), 'src/lib/server/email.ts'), 'utf8');
  assert.match(email, /autopilotCovers\(b\.subject\)/);
});

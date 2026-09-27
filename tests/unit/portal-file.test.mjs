import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'portal-'));
await mkdir(dir, { recursive: true });
process.env.PORTAL_DIR = dir;

const { readPortalSummary } = await import('../../src/lib/server/portal-file.ts');

const write = (code, data) => writeFile(join(dir, `${code}.json`), JSON.stringify(data), 'utf8');

test('summarises a portal file for an overview card', async () => {
  await write('yuval', {
    name: 'יובל', emoji: '🎒', subject: 'מתמטיקה', level: 'כיתה ט',
    nextLesson: { date: '2026-09-10', time: '16:15', type: '' },
    lessons: [{ date: '2026-09-01', topic: 'נגזרות' }],
    homework: [
      { task: 'תרגיל 1', done: false },
      { task: 'תרגיל 2', done: true },
      { task: 'תרגיל 3', done: false },
    ],
  });

  const s = readPortalSummary('yuval');
  assert.equal(s.subject, 'מתמטיקה');
  assert.equal(s.level, 'כיתה ט');
  assert.equal(s.lessonCount, 1);
  assert.equal(s.openHomework, 2, 'only the undone ones count');
  assert.deepEqual(s.nextLesson, { date: '2026-09-10', time: '16:15' });
});

test('a day-one file summarises to zeroes, not to nulls', async () => {
  // What enroll.ts writes on a first booking: every list empty, nextLesson
  // present but blank. The overview must render "0", not "—" or a crash.
  await write('noa', {
    name: 'נועה', emoji: '🎓', subject: 'פיזיקה', level: 'כיתה ז',
    nextLesson: { date: '', time: '', type: '' },
    lessons: [], homework: [], games: [],
  });

  const s = readPortalSummary('noa');
  assert.equal(s.openHomework, 0);
  assert.equal(s.lessonCount, 0);
  assert.equal(s.nextLesson, null, 'a blank date is no next lesson at all');
});

test('a missing or unreadable file yields null rather than throwing', async () => {
  // A student can exist in the database with no portal file — the overview
  // renders every sibling, so one broken file must not blank the page.
  assert.equal(readPortalSummary('nobody'), null);

  await writeFile(join(dir, 'broken.json'), '{not json', 'utf8');
  assert.equal(readPortalSummary('broken'), null);
});

test('a code that is not a slug is refused without touching the disk', () => {
  // The code reaches this from a session-scoped student row, but the
  // traversal guard costs nothing and this function builds a path.
  assert.equal(readPortalSummary('../../etc/passwd'), null);
  assert.equal(readPortalSummary(''), null);
});

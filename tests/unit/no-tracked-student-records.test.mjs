// tests/unit/no-tracked-student-records.test.mjs
//
// Real student records never live in git (CLAUDE.md; the 2026-09-18
// student-records spec). portal/noga.json was the last one: a real
// student's portal file, tracked since the Express days as a bootstrap
// seed. Production never read it — it reads PORTAL_DIR under the data
// mount, which the backups cover — so it only ever sat in every clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tracked = (...paths) =>
  execFileSync('git', ['ls-files', '--', ...paths], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);

test('no portal record is tracked', () => {
  assert.deepEqual(tracked('portal/*.json'), []);
});

test('the knowledgebase student and payment folders stay untracked', () => {
  assert.deepEqual(tracked('mea-beclick-kb/students', 'mea-beclick-kb/pricing'), []);
});

test('catalog examples named after students are not files in git', () => {
  assert.deepEqual(tracked('seed/games-data'), ['seed/games-data/nikol-derivrules-speed.json']);
  assert.deepEqual(tracked('seed/games-data/noga-integrals-quiz.json', 'seed/games-data/yonatan-fractions-numberline.json'), []);
});

test('the unused gavriel images are not tracked and nothing references them', () => {
  assert.deepEqual(tracked(
    'static/images/gavriel.png',
    'static/images/gavriel-modified.png',
    'static/images/gavriel_acc.jpeg',
  ), []);
  let hits = '';
  try {
    hits = execFileSync('git', ['grep', '-I', '-l', 'gavriel'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    if (err.status !== 1) throw err;
  }
  // The only mention left is this test, which lists the paths so a
  // later reference fails it. Nothing in the app loads the files.
  assert.deepEqual(hits.trim().split('\n').filter(Boolean), [
    'tests/unit/no-tracked-student-records.test.mjs',
  ]);
});

test('the portal directory itself still exists in a fresh clone', () => {
  // paths.ts defaults PORTAL_DIR to ./portal and boot-checks.ts refuses to
  // start when it is missing, so local `npm run dev` needs the directory
  // even though no record in it may be tracked.
  assert.deepEqual(tracked('portal'), ['portal/.gitkeep']);
});

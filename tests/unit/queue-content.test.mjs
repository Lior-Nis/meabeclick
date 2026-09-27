// Round-trip test between the write side (src/lib/server/lesson/queue.ts)
// and the read side (src/lib/server/content.ts) of generated content.
//
// Task 11 ported queue.ts before DATA_DIR existed, so it kept writing
// lessons/games-data/drafts to a SITE_ROOT-relative location while content.ts
// (Task 12) was later defined against DATA_DIR — write and read silently
// disagreed. Nothing caught it: the characterization suite disables
// generation, and click-through only exercised game data that had already
// been moved to the new location by hand. This test would have failed
// against that state — it write through the real publish()/publishDraftOnly()
// functions queue.ts actually calls, then reads the result back through
// readContent(), for lessons, games-data and drafts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before importing queue.ts: it transitively imports db.ts, which
// resolves its DB_PATH from DATA_DIR once, at module load — same pattern
// as tests/characterization/harness.mjs. Setting it here, rather than
// inside a test body, keeps this test from ever touching the repo's real
// ./data/ directory.
process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'queue-content-'));

const { readContent } = await import('../../src/lib/server/content.ts');
const { publish, publishDraftOnly } = await import('../../src/lib/server/lesson/queue.ts');

/** A minimal but schema-valid LessonPlan — just enough to exercise the
 *  file-writing code, no lesson generation (no network call) involved. */
function fixturePlan() {
  return {
    title: 'בדיקה',
    gradeContext: 'י\'',
    slides: [{ heading: 'a', bullets: ['b'] }],
    examples: [{ problem: 'p', steps: ['s'], answer: 'a' }],
    homework: [{ task: 't', why: 'w' }],
    games: {
      memory: { title: 'm', subject: 'מתמטיקה', pairs: [{ a: '1', b: '2' }] },
    },
  };
}

const meta = { subject: 'מתמטיקה', level: 'י\'', topic: 'נגזרות', student: 'בדיקה' };

test('publish() writes lessons and games-data where readContent() reads them', async () => {
  const slug = 'roundtrip-lesson';

  const published = await publish(slug, fixturePlan(), meta);

  const slides = await readContent('lessons', slug);
  assert.ok(slides.toString('utf8').includes('בדיקה'), 'slides.html should be readable through readContent');

  assert.equal(published.games.length, 1);
  const [game] = published.games;
  const data = await readContent('games-data', game.dataId);
  assert.ok(data.length > 0, 'game data should be readable through readContent');
});

test('publishDraftOnly() writes drafts where readContent() reads them', async () => {
  const slug = 'roundtrip-draft';

  await publishDraftOnly(slug, fixturePlan(), meta);

  const slides = await readContent('drafts', slug, 'slides.html');
  assert.ok(slides.toString('utf8').includes('בדיקה'));

  const plan = await readContent('drafts', slug, 'lesson.json');
  assert.equal(JSON.parse(plan.toString('utf8')).title, 'בדיקה');
});

test('a published game is never rewritten under the results that point at it', async () => {
  // Todoist 6hRhqRvfX7VHgh9q, step 4: every answer belongs to the version
  // it answered. A game result names its game by dataId (results_v2), and
  // the file behind a dataId is the only record of which questions were
  // asked. So a dataId must name ONE version forever: changing a game means
  // a new dataId, never an overwrite. Slugs carry a timestamp, so this has
  // held by construction; now it is enforced, before a game editor exists
  // to break it.
  const slug = 'pinned-lesson';
  const first = await publish(slug, fixturePlan(), meta);
  const before = (await readContent('games-data', first.games[0].dataId)).toString('utf8');

  const changed = fixturePlan();
  changed.games.memory.pairs = [{ a: 'NEW', b: 'QUESTION' }];
  await assert.rejects(() => publish(slug, changed, meta), /EEXIST/);

  const after = (await readContent('games-data', first.games[0].dataId)).toString('utf8');
  assert.equal(after, before, 'the questions a child already answered are still the ones on file');
});

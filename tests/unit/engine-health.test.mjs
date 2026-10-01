// Whether the lesson engine is down, and until when — so the tutor reads it
// on her dashboard instead of learning it from a booking that failed.
//
// On 2026-09-30 production's Codex account ran out of usage; Codex said when
// it would be back ("try again at Oct 12th, 2026 7:26 PM"), and the app threw
// that away: the log said "codex exited 1", the dashboard said nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'engine-health-'));
const H = await import('../../src/lib/server/lesson/engine-health.ts');
const { spawnAgent } = await import('../../src/lib/server/lesson/spawn.ts');
const { createLesson, finishLesson } = await import('../../src/lib/server/db.ts');
const { messageForFailure } = await import('../../src/lib/server/lesson/queue.ts');
const { LessonGenerationError } = await import('../../src/lib/server/lesson/engine.ts');

test("the reset time is read from Codex's own words, and nothing else is", () => {
  const now = new Date('2026-10-01T09:00:00');
  assert.equal(H.parseRetryAt("You've hit your usage limit ... or try again at Oct 12th, 2026 7:26 PM.", now),
    new Date('Oct 12, 2026 7:26 PM').toISOString());
  assert.equal(H.parseRetryAt('... or try again at 7:38 PM.', now), new Date('2026-10-01T19:38:00').toISOString(), 'a time alone is today');
  assert.equal(H.parseRetryAt('... or try again at 8:05 AM.', now), new Date('2026-10-02T08:05:00').toISOString(), 'unless it has passed: tomorrow');
  assert.equal(H.parseRetryAt('codex exited 1', now), null);
  assert.equal(H.parseRetryAt('try again at <script>alert(1)</script>', now), null);
});

test('a quota or sign-in failure marks the engine down; a success marks it up', () => {
  H.noteEngineFailure('codex', 'engine-quota', 'try again at Oct 12th, 2026 7:26 PM.');
  const down = H.engineDown('codex');
  assert.equal(down.kind, 'engine-quota');
  assert.equal(down.until, new Date('Oct 12, 2026 7:26 PM').toISOString());
  H.noteEngineSuccess('codex');
  assert.equal(H.engineDown('codex'), null);

  H.noteEngineFailure('codex', 'bad-output', 'not JSON');
  assert.equal(H.engineDown('codex'), null, 'one bad lesson is not the engine down');
});

/** A fake codex that says `out` on stdout and exits `code`. */
async function stub(out, code) {
  const dir = await mkdtemp(join(tmpdir(), 'stub-codex-'));
  const script = join(dir, 'codex');
  await writeFile(script, `#!/bin/sh\ncat > /dev/null\nprintf '%s' "${out}"\nexit ${code}\n`, { mode: 0o755 });
  return script;
}

test('every Codex run reports itself: the quota message marks it down, the next good run up', async () => {
  const quota = await stub("ERROR: You've hit your usage limit. try again at Oct 12th, 2026 7:26 PM.", 1);
  await assert.rejects(() => spawnAgent(quota, [], 'p', tmpdir(), { label: 'codex', timeoutMs: 10_000 }));
  assert.equal(H.engineDown('codex')?.kind, 'engine-quota');
  const ok = await stub('done', 0);
  await spawnAgent(ok, [], 'p', tmpdir(), { label: 'codex', timeoutMs: 10_000 });
  assert.equal(H.engineDown('codex'), null);
});

test('the dashboard is told which coming lessons have nothing prepared because of it', () => {
  const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  createLesson({ slug: 'eh-noga', student: 'נוגה', subject: 'מתמטיקה', level: 'כיתה יא', topic: 't', lessonAt: soon(30) });
  finishLesson('eh-noga', { status: 'failed', problem: messageForFailure(new LessonGenerationError('engine-quota', 'x')) });
  createLesson({ slug: 'eh-alon', student: 'אלון', subject: 'מתמטיקה', level: 'כיתה ח', topic: 't', lessonAt: soon(50) });
  finishLesson('eh-alon', { status: 'failed', problem: messageForFailure(new LessonGenerationError('bad-output', 'x')) });
  createLesson({ slug: 'eh-past', student: 'נוגה', subject: 'מתמטיקה', level: 'כיתה יא', topic: 't', lessonAt: soon(-30) });
  finishLesson('eh-past', { status: 'failed', problem: messageForFailure(new LessonGenerationError('engine-quota', 'x')) });

  assert.equal(H.engineAlert(), null, 'nothing to say while the engine is up');
  H.noteEngineFailure('codex', 'engine-quota', 'try again at Oct 12th, 2026 7:26 PM.');
  const alert = H.engineAlert();
  assert.equal(alert.kind, 'engine-quota');
  assert.deepEqual(alert.affected.map(a => a.student), ['נוגה'], 'coming, and failed because the engine is down — not for another reason, not past');
  H.noteEngineSuccess('codex');
});

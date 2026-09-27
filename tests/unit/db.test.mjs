import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('getBest returns the highest score for a student on one game', async () => {
  process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'db-')), 'results.db');
  const { writeResult, getBest } = await import('../../src/lib/server/db.ts');

  writeResult({ student: 'דנה', dataId: 'x-speed', template: 'speed-drill', score: 12, total: 20 });
  writeResult({ student: 'דנה', dataId: 'x-speed', template: 'speed-drill', score: 17, total: 20 });
  writeResult({ student: 'דנה', dataId: 'y-quiz',  template: 'quiz',        score: 30, total: 30 });

  assert.equal(getBest('דנה', 'x-speed'), 17);
  assert.equal(getBest('דנה', 'nothing'), null);
});

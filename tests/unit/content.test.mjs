import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'content-'));
const { readContent } = await import('../../src/lib/server/content.ts');

for (const evil of ['../secrets', '..%2Fsecrets', 'a/../../etc/passwd', 'Nope', 'has space', '']) {
  test(`rejects the segment ${JSON.stringify(evil)}`, async () => {
    await assert.rejects(() => readContent('games-data', evil));
  });
}

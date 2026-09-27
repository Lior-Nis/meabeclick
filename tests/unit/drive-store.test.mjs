/**
 * drive_items: which Drive file is which, and what it last held.
 * Spec: docs/superpowers/specs/2026-09-25-drive-student-folders-design.md D5.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'drive-store-')), 'results.db');
const D = await import('../../src/lib/server/drive/store.ts');

test('an unknown key is null', () => {
  assert.equal(D.getItem('lesson:none'), null);
});

test('put then get; a second put for the same key updates, never duplicates', () => {
  D.putItem({ key: 'lesson:a', fileId: 'f1', kind: 'lesson', syncedVersion: 1, syncedModified: '2027-01-01T00:00:00.000Z' });
  D.putItem({ key: 'lesson:a', fileId: 'f2', kind: 'lesson', syncedVersion: 2, syncedModified: '2027-01-02T00:00:00.000Z' });
  const row = D.getItem('lesson:a');
  assert.equal(row.fileId, 'f2');
  assert.equal(row.syncedVersion, 2);
  assert.equal(row.syncedModified, '2027-01-02T00:00:00.000Z');
  assert.equal(D.allItems().filter(i => i.key === 'lesson:a').length, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'txn-')), 'results.db');
const { inTransaction, handle } = await import('../../src/lib/server/db.ts');

// A throwaway table, private to this test file, so these tests exercise
// real BEGIN/COMMIT/ROLLBACK against node:sqlite rather than mocking it —
// and never touch the tables the app's own code owns.
handle().exec(`CREATE TABLE IF NOT EXISTS txn_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`);

const insert = (label) => handle().prepare(`INSERT INTO txn_probe (label) VALUES (?)`).run(label);
const labels = () => handle().prepare(`SELECT label FROM txn_probe ORDER BY id`).all().map(r => r.label);

test('inTransaction commits every write on success', () => {
  const before = labels().length;
  inTransaction(() => {
    insert('a');
    insert('b');
  });
  const after = labels();
  assert.equal(after.length, before + 2);
  assert.deepEqual(after.slice(-2), ['a', 'b']);
});

test('inTransaction rolls back every write on a throw', () => {
  const before = labels();
  assert.throws(() => {
    inTransaction(() => {
      insert('doomed-1');
      insert('doomed-2');
      throw new Error('boom');
    });
  }, /boom/);
  assert.deepEqual(labels(), before, 'writes made before the throw must not persist');
});

test('inTransaction rethrows the original error object, not a wrapper', () => {
  const original = new Error('the exact instance');
  original.code = 'MARKER';
  let caught;
  try {
    inTransaction(() => { throw original; });
  } catch (err) {
    caught = err;
  }
  assert.equal(caught, original, 'the rethrown error must be === the original');
  assert.equal(caught.code, 'MARKER');
});

test('a nested inTransaction call does not throw, and the outer commit persists it', () => {
  const before = labels().length;
  inTransaction(() => {
    insert('outer');
    inTransaction(() => {
      insert('inner');
    });
  });
  const after = labels();
  assert.equal(after.length, before + 2);
  assert.deepEqual(after.slice(-2), ['outer', 'inner']);
});

test('a throw inside a nested call rolls back the whole outer transaction', () => {
  const before = labels();
  assert.throws(() => {
    inTransaction(() => {
      insert('outer-doomed');
      inTransaction(() => {
        insert('inner-doomed');
        throw new Error('nested boom');
      });
    });
  }, /nested boom/);
  assert.deepEqual(labels(), before, 'neither the outer nor the inner write may persist');
});

/**
 * The storage inventory has to stay true, or it is worse than nothing.
 *
 * Three production bugs in two days came from reading the wrong half of a
 * legacy/v2 pair, and every one of them returned an EMPTY result rather
 * than an error — which is indistinguishable from "there is nothing here".
 * src/lib/server/storage-inventory.ts states the status of every table so
 * that choice stops being folklore.
 *
 * These tests are what stop it drifting back into folklore:
 *
 *   a new table cannot be added without declaring what it is for;
 *   a table cannot be deleted from the schema while the list still claims it;
 *   a table declared dead cannot quietly acquire a writer;
 *   a table declared draining cannot quietly acquire a writer either.
 *
 * The last two matter most. "Dead" and "draining" are claims about the
 * FUTURE — nothing will write here again — and a claim like that is only
 * worth making if something checks it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { STORAGE } = await import('../../src/lib/server/storage-inventory.ts');

/** Every table any migration creates, plus db.ts's own bootstrap. */
function tablesInSchema() {
  const files = [
    ...readdirSync(join(root, 'src/lib/server/migrations'))
      .filter(f => f.endsWith('.ts') && /^\d/.test(f))
      .map(f => join(root, 'src/lib/server/migrations', f)),
    join(root, 'src/lib/server/db.ts'),
    // schema_version is created by the runner, not by a numbered migration.
    join(root, 'src/lib/server/migrations/index.ts'),
  ];
  const found = new Set();
  for (const f of files) {
    // Strip SQL line comments first: db.ts has a comment reading
    // "-- CREATE TABLE is the one that actually creates…", which otherwise
    // registers a table called `is`.
    const src = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
    for (const m of src.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/g)) {
      found.add(m[1]);
    }
  }
  // `*_new` tables are the scratch half of a SQLite table rebuild: created,
  // filled, then renamed over the original inside one migration. They never
  // outlive it, so they are not storage.
  for (const name of [...found]) if (name.endsWith('_new')) found.delete(name);
  return found;
}

/** Source files that could touch a table at runtime — not migrations, which
 *  are allowed to write anything, and not tests. */
function runtimeSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'migrations') continue;
        walk(p);
      } else if (/\.(ts|svelte|mjs|js)$/.test(entry.name)) {
        out.push(p);
      }
    }
  };
  walk(join(root, 'src'));
  return out.map(p => [p, readFileSync(p, 'utf8')]);
}

const WRITE = (t) => new RegExp(String.raw`(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+"?${t}"?\b`, 'i');
const READ  = (t) => new RegExp(String.raw`(FROM|JOIN)\s+"?${t}"?\b`, 'i');

test('every table in the schema has a declared status', () => {
  const missing = [...tablesInSchema()].filter(t => !(t in STORAGE));
  assert.deepEqual(missing, [],
    'add these to storage-inventory.ts — a new table needs a decision about '
    + 'whether it is live, or it becomes the next silent empty read');
});

test('every declared table still exists in the schema', () => {
  const schema = tablesInSchema();
  const ghosts = Object.keys(STORAGE).filter(t => !schema.has(t));
  assert.deepEqual(ghosts, [],
    'the inventory names tables the migrations no longer create');
});

test('a dead table is touched by nothing at all', () => {
  const dead = Object.entries(STORAGE).filter(([, f]) => f.status === 'dead').map(([t]) => t);
  const offenders = [];
  for (const [path, src] of runtimeSources()) {
    for (const t of dead) {
      if (WRITE(t).test(src) || READ(t).test(src)) {
        offenders.push(`${t} touched in ${path.replace(root + '/', '')}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    'it is not dead if something reaches for it');
});

test('nothing READS a table nothing writes', () => {
  /* The whole point. Every one of the three bugs in this file's header was
     a read of an unwritten table, and each returned an empty list rather
     than an error — which a caller cannot tell from "no data yet". */
  const unadopted = Object.entries(STORAGE).filter(([, f]) => f.status === 'unadopted').map(([t]) => t);
  const offenders = [];
  for (const [path, src] of runtimeSources()) {
    for (const t of unadopted) {
      if (READ(t).test(src)) offenders.push(`${t} read in ${path.replace(root + '/', '')}`);
    }
  }
  assert.deepEqual(offenders, [],
    'reading an unadopted table answers empty, and empty looks like "nothing here"');
});

test('nothing writes to a table that is draining', () => {
  const draining = Object.entries(STORAGE).filter(([, f]) => f.status === 'draining').map(([t]) => t);
  const offenders = [];
  for (const [path, src] of runtimeSources()) {
    // db.ts is the legacy module itself: its writers are the ones being
    // drained, and they are reached only through imports this test cannot
    // see. Excluded deliberately, and narrowly — every OTHER file is held
    // to the rule.
    if (path.endsWith('server/db.ts')) continue;
    for (const t of draining) {
      if (WRITE(t).test(src)) offenders.push(`${t} written in ${path.replace(root + '/', '')}`);
    }
  }
  assert.deepEqual(offenders, [],
    'a draining table must not gain new writers — that is what draining means');
});

test('a legacy/v2 pair never has both halves declared live', () => {
  // Both live means two sources of truth, which is the shape of every bug
  // this file exists because of.
  for (const name of Object.keys(STORAGE)) {
    if (!name.endsWith('_v2')) continue;
    const base = name.slice(0, -3);
    if (!(base in STORAGE)) continue;
    const both = STORAGE[name].status === 'live' && STORAGE[base].status === 'live';
    assert.equal(both, false, `${base} and ${name} are both declared live`);
  }
});

test('every status carries a reason, not just a label', () => {
  for (const [table, fact] of Object.entries(STORAGE)) {
    assert.ok(fact.note && fact.note.length > 20, `${table} needs a note explaining its status`);
    if (fact.status !== 'live') {
      // "Dead" and "draining" are claims about the future. Whoever finds
      // this table later needs to know what would let them act on it.
      assert.ok(fact.note.length > 60, `${table} is ${fact.status} — say what has to be true to move on from it`);
    }
  }
});

test('the two legacy tables db.ts still writes are described as written', () => {
  // The draining-writer test above skips db.ts on purpose, so it cannot see
  // these two. calendar_failures is the only calendar-failure table anyone
  // uses (its _v2 is dead), so it is live. results cannot be live while
  // results_v2 is (see the pair rule), but its note must not read as
  // "never written": unattributable plays still land there.
  assert.equal(STORAGE.calendar_failures.status, 'live');
  assert.match(STORAGE.results.note, /still (receives|written)/i);
  assert.match(STORAGE.results.note, /writeResult/);
});

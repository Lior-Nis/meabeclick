// server/restore-db.sh must fail closed.
//
// A restore drill found two holes. `PRAGMA integrity_check` was printed and
// ignored, so a backup with a broken index still exited 0 — sqlite3 exits 0
// whenever the pragma runs, and reports corruption as text (`ok` is the only
// pass). And `rm -rf "$TARGET"` ran before any check, so
// `restore-db.sh <stamp> data` deleted production ./data. The script's own
// header says it never writes there.
//
// Shell tests execute the real script. `rm` is wrapped so a regression
// cannot delete the repo, ./data, or /. GitHub-hosted Ubuntu 24.04 ships
// sqlite3 3.45.1 (the workflow does not apt-install it); if the CLI is
// absent the shell tests skip and the static checks still run.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = join(root, 'server', 'restore-db.sh');
const script = readFileSync(scriptPath, 'utf8');
const STAMP = '2026-10-23';

const sqliteProbe = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
const hasSqlite = sqliteProbe.status === 0;
const skipReason = 'sqlite3 CLI is not on PATH (GitHub Ubuntu 24.04 ships sqlite3 3.45.1; this runner does not, so the script cannot be executed here)';

function beforeTargetRemoval() {
  const rmAt = script.indexOf('rm -rf "$TARGET"');
  assert.ok(rmAt > 0, 'the script should still remove the target once the backup has checked out');
  return script.slice(0, rmAt);
}

test('integrity_check must be exactly ok before the target is removed', () => {
  const before = beforeTargetRemoval();
  assert.match(before, /PRAGMA integrity_check/);
  assert.match(before, /\[\s*"\$integrity"\s*=\s*"ok"\s*\]/);
});

test('a dangerous target is refused before anything is deleted', () => {
  const before = beforeTargetRemoval();
  assert.match(before, /refusing restore target/);
  assert.match(before, /realpath\s+-m/);
  assert.match(before, /DATA_DIR/);
  const integrity = script.indexOf('echo "--- integrity ---"');
  const foreign = script.indexOf('echo "--- foreign keys ---"');
  assert.ok(integrity > 0 && foreign > integrity);
  const shown = script.slice(integrity, foreign);
  assert.match(shown, /require_integrity/);
  assert.doesNotMatch(shown, /sqlite3[^\n]*integrity_check/);
});

function writeBackup(dir, shape) {
  const dbPath = join(dir, `results-${STAMP}.db`);
  const db = new DatabaseSync(dbPath);
  if (shape === 'fk') {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY);
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER REFERENCES parent(id)
      );
      INSERT INTO child (parent_id) VALUES (5);
    `);
  } else {
    db.exec(`
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT);
      CREATE INDEX accounts_name ON accounts(name);
      INSERT INTO accounts (name) VALUES ('fixture');
    `);
  }
  db.close();
  if (shape === 'broken-index') {
    const buf = readFileSync(dbPath);
    assert.ok(buf.length > 4100, 'fixture database is too small to corrupt an index page');
    buf[4100] ^= 0xff;
    writeFileSync(dbPath, buf);
    const check = spawnSync('sqlite3', [dbPath, 'PRAGMA integrity_check;'], { encoding: 'utf8' });
    assert.notEqual(`${check.stdout}`.trim(), 'ok', 'the fixture must actually fail integrity_check');
  }
  return dbPath;
}

function rmWrapper(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // Only deletes under prefixes the test listed. A relative `data` or `/`
  // resolves outside that list and is blocked, so a red run cannot wipe
  // the checkout.
  writeFileSync(join(bin, 'rm'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$RM_LOG"
target=""
for a in "$@"; do
  case "$a" in
    -*) ;;
    *) target="$a" ;;
  esac
done
canon="$(realpath -m -- "$target")"
ok=0
while IFS= read -r prefix; do
  [ -n "$prefix" ] || continue
  case "$canon" in
    "$prefix"|"$prefix"/*) ok=1 ;;
  esac
done <<< "$RM_ALLOW"
if [ "$ok" -eq 1 ]; then
  exec /bin/rm "$@"
fi
printf 'blocked %s\\n' "$canon" >> "$RM_LOG"
exit 99
`);
  chmodSync(join(bin, 'rm'), 0o755);
  return bin;
}

function harness(shape = 'healthy') {
  const work = mkdtempSync(join(tmpdir(), 'restore-db-'));
  const backups = join(work, 'backups');
  const home = join(work, 'home', 'user');
  mkdirSync(backups, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'KEEP'), 'home');
  writeBackup(backups, shape);
  const log = join(work, 'rm.log');
  const bin = rmWrapper(work);
  return { work, backups, home, log, bin };
}

function run(h, args, { allow = [], extraEnv = {} } = {}) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: h.work,
    encoding: 'utf8',
    env: {
      PATH: `${h.bin}:${process.env.PATH}`,
      HOME: h.home,
      BACKUP_DIR: h.backups,
      TMPDIR: h.work,
      RM_LOG: h.log,
      RM_ALLOW: [h.work, ...allow].join('\n'),
      LANG: 'C',
      LC_ALL: 'C',
      ...extraEnv,
    },
  });
  const rmLog = existsSync(h.log) ? readFileSync(h.log, 'utf8') : '';
  return { ...result, rmLog };
}

function previousRestore(dir) {
  const target = join(dir, 'previous-restore');
  mkdirSync(join(target, 'data'), { recursive: true });
  writeFileSync(join(target, 'data', 'KEEP'), 'previous');
  return target;
}

function skipWithoutSqlite(t) {
  if (hasSqlite) return false;
  t.skip(skipReason);
  return true;
}

// Other tests resolve the default DATA_DIR to ./data and may already have
// a results.db open there. Remove only the sentinel this test wrote.
function removeSentinel(path) {
  rmSync(path, { force: true });
  let dir = dirname(path);
  const dataDir = join(root, 'data');
  while (dir === dataDir || dir.startsWith(`${dataDir}/`)) {
    try {
      rmdirSync(dir);
    } catch {
      break;
    }
    if (dir === dataDir) break;
    dir = dirname(dir);
  }
}

describe('restore-db.sh', { concurrency: false }, () => {
  test('a healthy backup restores and exits 0', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const target = join(h.work, 'out');
    try {
      const r = run(h, [STAMP, target]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /--- integrity ---\s+ok/);
      assert.match(r.stdout, /violations: 0/);
      assert.match(r.stdout, /accounts\s+1/);
      const db = new DatabaseSync(join(target, 'data', 'results.db'), { readOnly: true });
      const row = db.prepare('SELECT name FROM accounts').get();
      db.close();
      assert.equal(row.name, 'fixture');
      assert.ok(existsSync(join(target, 'data', 'portal')));
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('with no target, the restore lands in ./restore-drill', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const dest = join(root, 'restore-drill');
    try {
      const r = run(h, [STAMP], { allow: [dest] });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(dest, 'data', 'results.db')));
      assert.match(r.stdout, /restore-drill/);
    } finally {
      rmSync(dest, { recursive: true, force: true });
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a broken index exits non-zero and leaves the previous restore', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness('broken-index');
    const target = previousRestore(h.work);
    try {
      const r = run(h, [STAMP, target]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /integrity check failed/);
      assert.match(r.stderr, /expected ok/);
      assert.equal(readFileSync(join(target, 'data', 'KEEP'), 'utf8'), 'previous');
      assert.doesNotMatch(r.rmLog, /previous-restore/);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('foreign-key violations fail before the previous restore is removed', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness('fk');
    const target = previousRestore(h.work);
    try {
      const r = run(h, [STAMP, target]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /FOREIGN KEY VIOLATIONS IN BACKUP/);
      assert.equal(readFileSync(join(target, 'data', 'KEEP'), 'utf8'), 'previous');
      assert.doesNotMatch(r.rmLog, /previous-restore/);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('target data is refused and ./data is not deleted', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const dataDir = join(root, 'data');
    const sentinel = join(dataDir, 'KEEP');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(sentinel, 'production');
    try {
      const r = run(h, [STAMP, 'data']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(readFileSync(sentinel, 'utf8'), 'production');
      assert.doesNotMatch(r.rmLog, /blocked/);
      assert.equal(r.rmLog, '');
    } finally {
      removeSentinel(sentinel);
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('the repo root is refused and the checkout stays', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    try {
      const r = run(h, [STAMP, root]);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.ok(existsSync(join(root, 'package.json')));
      assert.equal(r.rmLog, '');
      const dot = run(h, [STAMP, '.']);
      assert.equal(dot.status, 1, dot.stderr);
      assert.match(dot.stderr, /refusing restore target/);
      assert.equal(dot.rmLog, '');
      assert.ok(existsSync(scriptPath));
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('target / is refused', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    try {
      const r = run(h, [STAMP, '/']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(r.rmLog, '');
      assert.ok(existsSync(join(root, 'package.json')));
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a path inside data/ is refused and nothing there is deleted', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const sentinel = join(root, 'data', 'nested', 'KEEP');
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, 'nested');
    try {
      const r = run(h, [STAMP, 'data/nested']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(readFileSync(sentinel, 'utf8'), 'nested');
      assert.equal(r.rmLog, '');
    } finally {
      removeSentinel(sentinel);
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a symlink that resolves into data/ is refused and left in place', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const dataDir = join(root, 'data');
    const sentinel = join(dataDir, 'KEEP');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(sentinel, 'production');
    const link = join(h.work, 'link-to-data');
    symlinkSync(dataDir, link);
    try {
      const r = run(h, [STAMP, link]);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(readFileSync(sentinel, 'utf8'), 'production');
      assert.ok(existsSync(link));
      assert.equal(r.rmLog, '');
    } finally {
      removeSentinel(sentinel);
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('HOME and an ancestor of HOME are refused and HOME is not deleted', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const ancestor = dirname(h.home);
    try {
      const own = run(h, [STAMP, h.home]);
      assert.equal(own.status, 1, own.stderr);
      assert.match(own.stderr, /refusing restore target/);
      assert.equal(readFileSync(join(h.home, 'KEEP'), 'utf8'), 'home');
      const r = run(h, [STAMP, ancestor]);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(readFileSync(join(h.home, 'KEEP'), 'utf8'), 'home');
      assert.doesNotMatch(own.rmLog + r.rmLog, /blocked/);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('DATA_DIR and a directory inside it are refused', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const prod = join(h.work, 'prod-data');
    const sentinel = join(prod, 'nested', 'KEEP');
    mkdirSync(dirname(sentinel), { recursive: true });
    writeFileSync(sentinel, 'live');
    try {
      const direct = run(h, [STAMP, prod], { extraEnv: { DATA_DIR: prod } });
      assert.equal(direct.status, 1, direct.stderr);
      assert.match(direct.stderr, /refusing restore target/);
      assert.equal(readFileSync(sentinel, 'utf8'), 'live');
      const nested = run(h, [STAMP, join(prod, 'nested')], { extraEnv: { DATA_DIR: prod } });
      assert.equal(nested.status, 1, nested.stderr);
      assert.equal(readFileSync(sentinel, 'utf8'), 'live');
      assert.doesNotMatch(direct.rmLog + nested.rmLog, /blocked/);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('an empty target is refused', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const dest = join(root, 'restore-drill');
    try {
      const r = run(h, [STAMP, '']);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(r.rmLog, '');
      assert.equal(existsSync(dest), false);
    } finally {
      rmSync(dest, { recursive: true, force: true });
      rmSync(h.work, { recursive: true, force: true });
    }
  });
});

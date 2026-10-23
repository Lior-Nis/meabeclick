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
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

function beforeReplace() {
  const marks = ['rm -rf "$TARGET"', 'mv -- "$TARGET"', 'mv -- "$scratch" "$TARGET"']
    .map((s) => script.indexOf(s))
    .filter((i) => i >= 0);
  assert.ok(marks.length > 0, 'the script should still replace the target once the backup has checked out');
  return script.slice(0, Math.min(...marks));
}

test('integrity_check must be exactly ok before the target is removed', () => {
  const before = beforeReplace();
  assert.match(before, /PRAGMA integrity_check/);
  assert.match(before, /\[\s*"\$integrity"\s*=\s*"ok"\s*\]/);
});

test('the restore installs the copy that passed the check', () => {
  const checked = script.indexOf('require_integrity "$ro"');
  const swapped = script.indexOf('mv -- "$scratch" "$TARGET"');
  assert.ok(checked > 0 && swapped > checked, 'the checked tree is what gets moved into place');
  assert.doesNotMatch(script.slice(checked), /cp "\$DB"/);
});

test('the scratch tree is beside the target and removed on exit', () => {
  const before = beforeReplace();
  assert.match(before, /mktemp -d "\$\(dirname -- "\$TARGET"\)\/\.restore-scratch\.XXXXXX"/);
  assert.match(before, /tar -xzf "\$FILES" -C "\$scratch\/data"/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /rm -rf "\$scratch"/);
});

test('a dangerous target is refused before anything is deleted', () => {
  const before = beforeReplace();
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

// The script cds to its own repo root and, with no target, writes
// ./restore-drill there. A copy under the temp dir is that root, so the
// default-target test never creates or deletes the checkout's drill.
function repoLayout(work) {
  const repo = join(work, 'layout');
  const copy = join(repo, 'server', 'restore-db.sh');
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(scriptPath, copy);
  return { repo, script: copy, drill: join(repo, 'restore-drill') };
}

function run(h, args, { allow = [], extraEnv = {}, script = scriptPath } = {}) {
  const result = spawnSync('bash', [script, ...args], {
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
      assert.match(r.stderr, new RegExp(`WARNING: no files-${STAMP}\\.tar\\.gz`));
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('with no target, the restore lands in ./restore-drill', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const layout = repoLayout(h.work);
    try {
      const r = run(h, [STAMP], { script: layout.script });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(join(layout.drill, 'data', 'results.db')));
      assert.match(r.stdout, /restore-drill/);
    } finally {
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
    const layout = repoLayout(h.work);
    try {
      const r = run(h, [STAMP, ''], { script: layout.script });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /refusing restore target/);
      assert.equal(r.rmLog, '');
      assert.equal(existsSync(layout.drill), false);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a truncated files archive leaves the previous restore in place', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const parent = join(h.work, 'parent');
    const target = previousRestore(parent);
    writeFileSync(join(h.backups, `files-${STAMP}.tar.gz`), 'this is not a gzip tarball');
    try {
      const r = run(h, [STAMP, target]);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /files archive is corrupt/);
      assert.equal(readFileSync(join(target, 'data', 'KEEP'), 'utf8'), 'previous');
      assert.doesNotMatch(r.rmLog, /previous-restore/);
      assert.ok(r.rmLog.includes(`${parent}/.restore-scratch.`), r.rmLog);
      assert.deepEqual(readdirSync(parent).filter((n) => n.startsWith('.restore-')), []);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a files archive is unpacked into the restore that gets swapped in', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const stage = join(h.work, 'stage');
    mkdirSync(join(stage, 'portal'), { recursive: true });
    writeFileSync(join(stage, 'portal', 'board.json'), '{"fake":true}\n');
    const packed = spawnSync('tar', ['-czf', join(h.backups, `files-${STAMP}.tar.gz`), '-C', stage, 'portal'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const parent = join(h.work, 'parent');
    const target = previousRestore(parent);
    writeFileSync(join(parent, 'KEEP'), 'sibling');
    try {
      const r = run(h, [STAMP, target]);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /WARNING: no files-/);
      assert.equal(readFileSync(join(target, 'data', 'portal', 'board.json'), 'utf8'), '{"fake":true}\n');
      assert.equal(existsSync(join(target, 'data', 'KEEP')), false);
      assert.equal(readFileSync(join(parent, 'KEEP'), 'utf8'), 'sibling');
      assert.deepEqual(readdirSync(parent).filter((n) => n.startsWith('.restore-')), []);
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('the backup directory, its parent, and a path inside it are refused', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const vault = join(h.work, 'vault');
    const backups = join(vault, 'backups');
    mkdirSync(join(backups, 'nested'), { recursive: true });
    writeBackup(backups);
    writeFileSync(join(backups, 'KEEP'), 'backups');
    writeFileSync(join(backups, 'nested', 'KEEP'), 'inside');
    writeFileSync(join(vault, 'KEEP'), 'above');
    const extraEnv = { BACKUP_DIR: backups };
    try {
      const direct = run(h, [STAMP, backups], { extraEnv });
      assert.equal(direct.status, 1, direct.stderr);
      assert.match(direct.stderr, /backup directory/);
      assert.equal(readFileSync(join(backups, 'KEEP'), 'utf8'), 'backups');
      assert.ok(existsSync(join(backups, `results-${STAMP}.db`)));
      const above = run(h, [STAMP, vault], { extraEnv });
      assert.equal(above.status, 1, above.stderr);
      assert.match(above.stderr, /backup directory/);
      assert.equal(readFileSync(join(vault, 'KEEP'), 'utf8'), 'above');
      assert.equal(readFileSync(join(backups, 'KEEP'), 'utf8'), 'backups');
      const inside = run(h, [STAMP, join(backups, 'nested')], { extraEnv });
      assert.equal(inside.status, 1, inside.stderr);
      assert.match(inside.stderr, /backup directory/);
      assert.equal(readFileSync(join(backups, 'nested', 'KEEP'), 'utf8'), 'inside');
      assert.equal(direct.rmLog + above.rmLog + inside.rmLog, '');
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });

  test('a directory inside the repo is refused, except ./restore-drill itself', (t) => {
    if (skipWithoutSqlite(t)) return;
    const h = harness();
    const layout = repoLayout(h.work);
    const kept = join(layout.repo, 'server', 'KEEP');
    writeFileSync(kept, 'script-dir');
    const nested = join(layout.drill, 'extra', 'KEEP');
    mkdirSync(dirname(nested), { recursive: true });
    writeFileSync(nested, 'drill-child');
    try {
      const server = run(h, [STAMP, 'server'], { script: layout.script });
      assert.equal(server.status, 1, server.stderr);
      assert.match(server.stderr, /inside the repo/);
      assert.equal(readFileSync(kept, 'utf8'), 'script-dir');
      assert.equal(server.rmLog, '');
      const child = run(h, [STAMP, 'restore-drill/extra'], { script: layout.script });
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /inside the repo/);
      assert.equal(readFileSync(nested, 'utf8'), 'drill-child');
      assert.equal(child.rmLog, '');
      const real = run(h, [STAMP, 'server']);
      assert.equal(real.status, 1, real.stderr);
      assert.match(real.stderr, /inside the repo/);
      assert.equal(real.rmLog, '');
      assert.ok(existsSync(scriptPath));
    } finally {
      rmSync(h.work, { recursive: true, force: true });
    }
  });
});

/**
 * Versioned schema migrations.
 *
 * Replaces the `try { ALTER TABLE ... } catch {}` pattern this file's
 * predecessor used (db.ts:172 and :180 before this change), which had no
 * version record: it could not tell an already-applied change from a failed
 * one, and could not express anything but an additive column.
 *
 * Each migration runs inside a transaction together with the INSERT that
 * records it, so a migration and its version marker cannot disagree — a
 * half-applied schema is what turns a deploy into a manual repair job.
 *
 * Migrations are an explicit TypeScript registry (see ./list.ts), not files
 * discovered from disk: a directory scan works when this file's source
 * directory still has its `.sql` siblings (`node --test`, `vite dev`) but
 * not once Vite bundles this module into a build chunk with no `.sql` files
 * beside it. Importing the SQL as a module forces the bundler to carry it.
 */
import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './list.ts';

function pending(db: DatabaseSync): Migration[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_version`).all() as { version: number }[])
      .map(r => r.version)
  );
  return MIGRATIONS
    .filter(m => !applied.has(m.version))
    .sort((a, b) => a.version - b.version);
}

export function migrate(db: DatabaseSync): void {
  for (const { version, name, sql } of pending(db)) {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`)
        .run(version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // Refuse to continue: a later migration written against the schema
      // this one was meant to produce would fail in a far more confusing way.
      throw new Error(`migration ${name} failed: ${(err as Error).message}`);
    }
  }
}

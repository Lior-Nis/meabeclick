import { purgeApplicationData, verifySyntheticDatabase } from './database-policy.mjs';
import { seedSyntheticRows } from './seed-data.mjs';

/**
 * Replace all application rows while FK enforcement remains enabled. Deferred
 * checking permits arbitrary purge order, while foreign_key_check catches a
 * broken fixture before COMMIT and COMMIT remains a second enforcement point.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ afterSeed?: (db: import('node:sqlite').DatabaseSync) => void }} options
 */
export function replaceSyntheticDatabase(db, { afterSeed = () => {} } = {}) {
  db.exec('PRAGMA foreign_keys = ON');
  if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
    throw new Error('[synthetic] could not enable foreign-key enforcement');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('PRAGMA defer_foreign_keys = ON');
    purgeApplicationData(db, { manageForeignKeys: false });
    seedSyntheticRows(db);
    afterSeed(db);
    verifySyntheticDatabase(db);
    if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
      throw new Error('[synthetic] foreign-key enforcement was disabled before commit');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

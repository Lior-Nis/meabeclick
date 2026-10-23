import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { verifySyntheticDatabase } from './database-policy.mjs';

const dbPath = process.env.DB_PATH;
const markerPath = process.env.SYNTHETIC_DATA_MARKER;
if (process.env.SYNTHETIC_TEST_MODE !== '1' || dbPath !== '/synthetic-data/synthetic.db') {
  throw new Error('[synthetic] verification is restricted to the synthetic database path');
}
if (!markerPath || readFileSync(markerPath, 'utf8') !== 'meabeclick-synthetic-volume-v1\n') {
  throw new Error('[synthetic] volume marker is missing or invalid');
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const counts = verifySyntheticDatabase(db);
db.close();
console.log(`[synthetic] database verification passed: ${JSON.stringify(counts)}`);

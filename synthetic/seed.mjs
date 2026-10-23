import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { replaceSyntheticDatabase } from './database-seed.mjs';
import { seedSyntheticPortal, verifySyntheticPortal } from './portal-fixture.mjs';

const DB_PATH = '/synthetic-data/synthetic.db';
const PORTAL_DIR = '/synthetic-data/portal';
const MARKER = process.env.SYNTHETIC_DATA_MARKER || '/synthetic-data/.meabeclick-synthetic-volume';
const MARKER_BODY = 'meabeclick-synthetic-volume-v1\n';


/** @param {string} message */
function refuse(message) {
  throw new Error(`[synthetic] ${message}`);
}

if (process.env.SYNTHETIC_TEST_MODE !== '1') refuse('SYNTHETIC_TEST_MODE must be 1');
if (process.env.DB_PATH !== DB_PATH) refuse(`DB_PATH must be exactly ${DB_PATH}`);
if (!existsSync(MARKER) || readFileSync(MARKER, 'utf8') !== MARKER_BODY) {
  refuse('synthetic volume marker is missing or invalid');
}
if (!existsSync(DB_PATH)) refuse('database does not exist; start the synthetic app so migrations run first');

const db = new DatabaseSync(DB_PATH);
try {
  replaceSyntheticDatabase(db, {
    afterSeed: () => {
      seedSyntheticPortal(PORTAL_DIR);
      verifySyntheticPortal(PORTAL_DIR);
    },
  });
} finally {
  db.close();
}

console.log('[synthetic] deterministic seed applied: 1 account, 1 student, 2 tutors, 1 enrollment, 1 booking, 1 lesson, 1 homework submission, 1 result, 1 report, 1 game');

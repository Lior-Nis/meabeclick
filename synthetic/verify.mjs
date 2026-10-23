import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const dbPath = process.env.DB_PATH;
const markerPath = process.env.SYNTHETIC_DATA_MARKER;
if (process.env.SYNTHETIC_TEST_MODE !== '1' || dbPath !== '/synthetic-data/synthetic.db') {
  throw new Error('[synthetic] verification is restricted to the synthetic database path');
}
if (!markerPath || readFileSync(markerPath, 'utf8') !== 'meabeclick-synthetic-volume-v1\n') {
  throw new Error('[synthetic] volume marker is missing or invalid');
}

const db = new DatabaseSync(dbPath, { readOnly: true });
/** @param {string} sql */
const one = (sql) => Number(db.prepare(sql).get()?.n ?? 0);
/** @type {Record<string, number>} */
const counts = {
  accounts: one(`SELECT COUNT(*) AS n FROM accounts WHERE email LIKE '%@example.invalid' AND name LIKE '%בדיקה%'`),
  students: one(`SELECT COUNT(*) AS n FROM students_v2 WHERE code LIKE 'synthetic-%' AND name LIKE '%בדיקה%'`),
  tutors: one(`SELECT COUNT(*) AS n FROM teachers WHERE name LIKE 'מורה בדיקה%' AND phone IS NULL AND calendar_id IS NULL AND busy_ics IS NULL`),
  lessons: one(`SELECT COUNT(*) AS n FROM lessons WHERE slug LIKE 'synthetic-%'`),
  homework: one(`SELECT COUNT(*) AS n FROM homework WHERE data_id = 'synthetic-linear-formulas' AND submitted_at IS NOT NULL`),
  results: one(`SELECT COUNT(*) AS n FROM results_v2 WHERE data_id = 'synthetic-linear-formulas'`),
};
const nonSynthetic = one(`SELECT COUNT(*) AS n FROM accounts WHERE email IS NULL OR email NOT LIKE '%@example.invalid'`)
  + one(`SELECT COUNT(*) AS n FROM students_v2 WHERE code NOT LIKE 'synthetic-%'`);
db.close();

/** @type {Record<string, number>} */
const expected = { accounts: 1, students: 1, tutors: 2, lessons: 1, homework: 1, results: 1 };
for (const [key, value] of Object.entries(expected)) {
  if (counts[key] !== value) throw new Error(`[synthetic] ${key}: expected ${value}, found ${counts[key]}`);
}
if (nonSynthetic) throw new Error('[synthetic] non-synthetic account or student data detected');
console.log(`[synthetic] database verification passed: ${JSON.stringify(counts)}`);

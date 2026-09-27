/**
 * Pins the actual bug this branch fixes: a non-atomic enrolment could leave
 * an orphan account (and orphan student) with the family told their lesson
 * was booked. tests/unit/transaction.test.mjs only exercises inTransaction()
 * against a private probe table — it guards the utility, not this behaviour.
 * Deleting the inTransaction() wrapper from enroll.ts and restoring the old
 * non-atomic sequence leaves that suite green; this file is what catches it.
 *
 * Fault injection is a real SQLite trigger on `enrollments`, not a mock —
 * this needs no seam in production code, and it fails the same way a real
 * disk-full or SQLITE_BUSY would: enrollFromBooking's own INSERT throws.
 *
 * db.ts opens its database at module load, so DB_PATH (and PORTAL_DIR, the
 * portal-file equivalent — see src/lib/server/paths.ts) must be set before
 * the dynamic import, same preamble as tests/unit/results-identity.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'enroll-atomic-db-')), 'results.db');
const portalDir = await mkdtemp(join(tmpdir(), 'enroll-atomic-portal-'));
process.env.PORTAL_DIR = portalDir;

const { handle } = await import('../../src/lib/server/db.ts');
const { enrollFromBooking } = await import('../../src/lib/server/enroll.ts');

// A subject is required so the enrollments INSERT (where the trigger lives)
// is actually reached — enrollFromBooking skips it for a subject-less booking.
const booking = {
  name: 'בדיקה אטומית',
  email: 'atomic-test@example.com',
  subject: 'מתמטיקה',
  level: 'ז',
  start: '2026-09-20T10:00:00.000Z',
};

const countAccounts = () => handle().prepare(`SELECT COUNT(*) AS n FROM accounts`).get().n;
const countStudents = () => handle().prepare(`SELECT COUNT(*) AS n FROM students_v2`).get().n;

test('a fault mid-enrolment leaves no orphan account, student, or portal file', () => {
  handle().exec(`
    CREATE TRIGGER boom BEFORE INSERT ON enrollments
    BEGIN SELECT RAISE(ABORT, 'boom'); END;
  `);

  const accountsBefore = countAccounts();
  const studentsBefore = countStudents();

  assert.throws(() => enrollFromBooking(booking), /boom/);

  assert.equal(countAccounts(), accountsBefore, 'no orphan account may be left behind — this is the bug');
  assert.equal(countStudents(), studentsBefore, 'no orphan student may be left behind');
  assert.deepEqual(readdirSync(portalDir), [], 'the portal-file write must not have run');

  handle().exec(`DROP TRIGGER boom`);
});

test('once the fault clears, the same booking enrolls normally', () => {
  const result = enrollFromBooking(booking);

  assert.equal(countAccounts(), 1);
  assert.equal(countStudents(), 1);
  assert.ok(result.enrollment, 'a subject was given, so an enrollment must exist');
  assert.deepEqual(
    readdirSync(portalDir),
    [`${result.student.code}.json`],
    'the success path must still write the portal file',
  );
});

/**
 * Accessors for the entity model: teachers, accounts, students, enrollments.
 *
 * Separate from db.ts deliberately. db.ts is 508 lines carrying the legacy
 * name-keyed tables; putting the new model there would make a file that is
 * already hard to hold in context harder still, and would blur which
 * accessors are being retired.
 */
import { handle } from './db.ts';

export type TeacherRow = { id: number; name: string; phone: string | null; active: number };
export type AccountRow = {
  id: number; name: string; phone: string | null;
  credential: string; is_self: number; created_at: string;
  email: string | null; legacy_code: string | null;
};

/** Emails are matched, not displayed, so they are compared in one canonical
 *  form. A parent who books as `Dana@Gmail.com ` and later as `dana@gmail.com`
 *  is one account, not two — and since the email is what identifies a
 *  returning family, getting this wrong silently splits a family's history. */
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

export function createTeacher(t: { name: string; phone?: string | null }): TeacherRow {
  const info = handle().prepare(
    `INSERT INTO teachers (name, phone, active) VALUES (?, ?, 1)`
  ).run(t.name, t.phone ?? null);
  return getTeacher(Number(info.lastInsertRowid))!;
}

export function getTeacher(id: number): TeacherRow | null {
  return (handle().prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as TeacherRow) ?? null;
}

export function listTeachers(): TeacherRow[] {
  return handle().prepare(`SELECT * FROM teachers ORDER BY id`).all() as TeacherRow[];
}

/** The tutor everything is attributed to until per-teacher auth exists.
 *  Lowest id rather than "the only one" so seeding a second teacher for a
 *  future change cannot silently repoint existing behaviour. */
export function defaultTeacher(): TeacherRow | null {
  return (handle().prepare(
    `SELECT * FROM teachers WHERE active = 1 ORDER BY id LIMIT 1`
  ).get() as TeacherRow) ?? null;
}

export function createAccount(
  a: {
    name: string; phone?: string | null; credential: string;
    isSelf?: boolean; email?: string | null;
  },
): AccountRow {
  const email = a.email ? normalizeEmail(a.email) : null;
  const info = handle().prepare(`
    INSERT INTO accounts (name, phone, credential, is_self, created_at, email)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(a.name, a.phone ?? null, a.credential, a.isSelf ? 1 : 0, new Date().toISOString(), email);
  return getAccount(Number(info.lastInsertRowid))!;
}

/** The returning-family lookup. This replaces name+password: a parent proves
 *  nothing here, because matching an email only decides which account a
 *  booking attaches to — reaching that account still requires receiving the
 *  link sent to that address. */
export function findAccountByEmail(email: unknown): AccountRow | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  return (handle().prepare(
    `SELECT * FROM accounts WHERE email = ?`
  ).get(e) as AccountRow) ?? null;
}

/** Backfilled accounts have no email until their family books again. */
export function setAccountEmail(id: number, email: string): void {
  handle().prepare(`UPDATE accounts SET email = ? WHERE id = ?`).run(normalizeEmail(email), id);
}

export function setAccountPhone(id: number, phone: string): void {
  handle().prepare(`UPDATE accounts SET phone = ? WHERE id = ?`).run(phone, id);
}

export function accountForStudent(studentId: number): AccountRow | null {
  return (handle().prepare(`
    SELECT a.* FROM accounts a
    JOIN students_v2 s ON s.account_id = a.id
    WHERE s.id = ?
  `).get(studentId) as AccountRow) ?? null;
}

export function getAccount(id: number): AccountRow | null {
  return (handle().prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow) ?? null;
}

/** Name AND credential, because the credential alone is not unique across
 *  accounts and a family password is short by design. */
export function findAccountByCredential(name: string, credential: string): AccountRow | null {
  return (handle().prepare(
    `SELECT * FROM accounts WHERE name = ? AND credential = ?`
  ).get(String(name).trim(), String(credential).trim()) as AccountRow) ?? null;
}

export type StudentRow = {
  id: number; code: string; name: string; emoji: string | null;
  account_id: number; progress: number; progress_note: string | null;
  credential: string; created_at: string;
  // Migration 010. The only three fields on the tutor's dashboard card that
  // never had a server home before it — see that file's header for why.
  goals: string | null; style: string | null; notes: string | null;
};
export type EnrollmentRow = {
  id: number; student_id: number; subject: string;
  level: string | null; teacher_id: number | null;
};

export function createStudent(
  s: { code: string; name: string; accountId: number; credential: string; emoji?: string | null },
): StudentRow {
  const info = handle().prepare(`
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
    VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
  `).run(s.code, s.name, s.emoji ?? '🎓', s.accountId, s.credential, new Date().toISOString());
  return getStudentById(Number(info.lastInsertRowid))!;
}

export function getStudentById(id: number): StudentRow | null {
  return (handle().prepare(`SELECT * FROM students_v2 WHERE id = ?`).get(id) as StudentRow) ?? null;
}

export function getStudentByCode(code: string): StudentRow | null {
  return (handle().prepare(`SELECT * FROM students_v2 WHERE code = ?`).get(code) as StudentRow) ?? null;
}

export function listStudents(): StudentRow[] {
  return handle().prepare(`SELECT * FROM students_v2 ORDER BY created_at DESC`).all() as StudentRow[];
}

export function studentsForAccount(accountId: number): StudentRow[] {
  return handle().prepare(
    `SELECT * FROM students_v2 WHERE account_id = ? ORDER BY id`
  ).all(accountId) as StudentRow[];
}

/** The display name is now just a label. Nothing joins on it, which is the
 *  entire point: this used to silently orphan every result and lesson. */
export function renameStudent(id: number, name: string): void {
  handle().prepare(`UPDATE students_v2 SET name = ? WHERE id = ?`).run(name, id);
}

/** Rotating the URL slug. One row, because code is not the primary key. */
export function setStudentCode(id: number, code: string): void {
  handle().prepare(`UPDATE students_v2 SET code = ? WHERE id = ?`).run(code, id);
}

/** No text field on the student card is trusted to stay a sane size —
 *  neither the tutor's own typing nor a browser-side import (see
 *  student-import.ts) is bounded on the way in. */
const MAX_PROFILE_TEXT = 1000;

function clampProfileText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.slice(0, MAX_PROFILE_TEXT);
}

export type StudentProfileFields = {
  goals?: string | null;
  style?: string | null;
  notes?: string | null;
  progress?: number;
  progressNote?: string | null;
};

/**
 * Updates only the profile fields actually supplied — omitting a key must
 * leave that column exactly as it was, which is the property that makes
 * this safe to call from both a tutor's small in-place edit (one field) and
 * the bulk browser import (student-import.ts, several fields at once).
 *
 * `progress` is clamped to [0, 100]; every text field is capped at
 * MAX_PROFILE_TEXT before it reaches SQLite, since none of these values
 * arrive pre-validated (a tutor's textarea, or an old localStorage blob).
 */
export function updateStudentProfile(id: number, fields: StudentProfileFields): StudentRow | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (fields.goals !== undefined) {
    sets.push('goals = ?');
    params.push(clampProfileText(fields.goals));
  }
  if (fields.style !== undefined) {
    sets.push('style = ?');
    params.push(clampProfileText(fields.style));
  }
  if (fields.notes !== undefined) {
    sets.push('notes = ?');
    params.push(clampProfileText(fields.notes));
  }
  if (fields.progressNote !== undefined) {
    sets.push('progress_note = ?');
    params.push(clampProfileText(fields.progressNote));
  }
  if (fields.progress !== undefined) {
    // Callers (the PATCH route, the local import) already reject a
    // non-finite value before calling in — but Math.min(100, Math.max(0,
    // NaN)) is NaN, and the `progress` column is NOT NULL INTEGER, so a NaN
    // that slipped through would fail at bind time instead of clamping to
    // something sane. The clamp guards itself rather than trusting that.
    const n = Number.isFinite(fields.progress) ? fields.progress : 0;
    const clamped = Math.min(100, Math.max(0, n));
    sets.push('progress = ?');
    params.push(clamped);
  }

  if (sets.length) {
    params.push(id);
    handle().prepare(`UPDATE students_v2 SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  return getStudentById(id);
}

/** Keyed on (student_id, subject) by the table's UNIQUE constraint, so
 *  re-booking the same subject updates the level and tutor rather than
 *  accumulating duplicate enrollments. */
export function upsertEnrollment(
  e: { studentId: number; subject: string; level?: string | null; teacherId?: number | null },
): EnrollmentRow {
  handle().prepare(`
    INSERT INTO enrollments (student_id, subject, level, teacher_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, subject)
    DO UPDATE SET level = excluded.level, teacher_id = excluded.teacher_id
  `).run(e.studentId, e.subject, e.level ?? null, e.teacherId ?? null);

  return handle().prepare(
    `SELECT * FROM enrollments WHERE student_id = ? AND subject = ?`
  ).get(e.studentId, e.subject) as EnrollmentRow;
}

export function enrollmentsForStudent(studentId: number): EnrollmentRow[] {
  return handle().prepare(
    `SELECT * FROM enrollments WHERE student_id = ? ORDER BY id`
  ).all(studentId) as EnrollmentRow[];
}

/** Which student under this account a booking refers to. Matched on the
 *  display name because that is the only thing the parent re-types, and
 *  scoped to the account so two families' children with the same first name
 *  can never collide — the failure the legacy global name lookup had. */
export function findStudentInAccountByName(accountId: number, name: unknown): StudentRow | null {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) return null;
  return (handle().prepare(
    `SELECT * FROM students_v2 WHERE account_id = ? AND name = ?`
  ).get(accountId, n) as StudentRow) ?? null;
}

/* ── Join codes ─────────────────────────────────────────────────────────
 *
 * A parent hands one of these to a child so the child's own device can
 * claim a student session. Single-use and short-lived on purpose: the code
 * travels through whatever channel the family already uses (read aloud,
 * WhatsApp, a note), so it must stop being an access token the moment it
 * has done its one job.
 */

export type JoinCodeRow = {
  code: string; student_id: number;
  created_at: string; expires_at: string; used_at: string | null;
};

export function insertJoinCode(
  j: { code: string; studentId: number; expiresAt: string },
): JoinCodeRow {
  handle().prepare(`
    INSERT INTO join_codes (code, student_id, created_at, expires_at, used_at)
    VALUES (?, ?, ?, ?, NULL)
  `).run(j.code, j.studentId, new Date().toISOString(), j.expiresAt);
  return getJoinCode(j.code)!;
}

export function getJoinCode(code: string): JoinCodeRow | null {
  return (handle().prepare(
    `SELECT * FROM join_codes WHERE code = ?`
  ).get(code) as JoinCodeRow) ?? null;
}

/** The newest code for this student that is still usable, so a parent who
 *  reopens the page sees the same code they already read out rather than a
 *  new one that invalidates nothing but confuses everyone. */
export function activeJoinCodeForStudent(studentId: number, nowIso: string): JoinCodeRow | null {
  return (handle().prepare(`
    SELECT * FROM join_codes
    WHERE student_id = ? AND used_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(studentId, nowIso) as JoinCodeRow) ?? null;
}

/** Stamps the code used and returns the student it belonged to, or null if
 *  it was unknown, expired, or already spent. One statement per outcome
 *  rather than a read-then-write, so two devices racing the same code
 *  cannot both be admitted. */
export function redeemJoinCode(code: string, nowIso: string): StudentRow | null {
  const info = handle().prepare(`
    UPDATE join_codes SET used_at = ?
    WHERE code = ? AND used_at IS NULL AND expires_at > ?
  `).run(nowIso, code, nowIso);
  if (!info.changes) return null;

  const row = getJoinCode(code);
  return row ? getStudentById(row.student_id) : null;
}

/**
 * Removes a student and the access artifacts that only exist to reach them.
 *
 * Join codes and enrollments are deleted because they are meaningless
 * without the student. Lessons, results, bookings, payments and plans are NOT
 * touched and will block the delete through their foreign keys — that is
 * deliberate. Those rows are the history of work done and money owed, and
 * a dashboard misclick must not be able to erase them. The tutor gets an
 * error she can act on instead of a silent hole in the ledger.
 */
export function deleteStudentCascade(code: string): boolean {
  const student = getStudentByCode(code);
  if (!student) return false;

  const db = handle();
  db.prepare(`DELETE FROM join_codes WHERE student_id = ?`).run(student.id);
  db.prepare(`DELETE FROM enrollments WHERE student_id = ?`).run(student.id);
  const info = db.prepare(`DELETE FROM students_v2 WHERE id = ?`).run(student.id);

  // An account with no students left is an account nobody can reach and
  // nothing refers to. Left behind it would silently match a future booking
  // from the same address and resurrect a family the tutor just removed.
  const remaining = studentsForAccount(student.account_id);
  if (!remaining.length) {
    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(student.account_id);
  }

  return info.changes > 0;
}

/** The dashboard's roster: every student with the account contact beside
 *  it, so the tutor sees who to message without opening each family. */
export type RosterRow = StudentRow & {
  account_name: string;
  email: string | null;
  account_phone: string | null;
  subjects: string | null;
};

export function roster(): RosterRow[] {
  return handle().prepare(`
    SELECT s.*,
           a.name  AS account_name,
           a.email AS email,
           a.phone AS account_phone,
           (SELECT GROUP_CONCAT(e.subject, ', ')
              FROM enrollments e WHERE e.student_id = s.id) AS subjects
    FROM students_v2 s
    JOIN accounts a ON a.id = s.account_id
    ORDER BY s.created_at DESC
  `).all() as RosterRow[];
}

/* ── Bookings ───────────────────────────────────────────────────────────
 *
 * These moved here from db.ts when bookings_v2 was wired: a booking is an
 * entity keyed on a student, not a row keyed on a typed-in name.
 *
 * Legacy `bookings` rows are NOT migrated — they carry a name and a phone,
 * and matching those to a child would mean name-matching, on rows that now
 * carry money. So both reads below take a UNION of the two tables: new
 * bookings land in bookings_v2, old ones keep holding their hours and age
 * out. Once `SELECT COUNT(*) FROM bookings WHERE start > datetime('now')`
 * is 0, both unions can drop their legacy half.
 */

const OVERLAP_SOURCE = `
  SELECT start, "end" AS finish, status FROM bookings
  UNION ALL
  SELECT start, "end" AS finish, status FROM bookings_v2
`;

/** Whether any confirmed booking overlaps [start, end).
 *
 *  Split out of reserveBooking so the CHECK can run even when there is no
 *  student to insert a row for: an enrolment failure must not turn into a
 *  double-booked hour just because the write half is impossible. */
export function slotTaken(start: string, end: string): boolean {
  return !!handle().prepare(`
    SELECT 1 FROM (${OVERLAP_SOURCE})
    WHERE status = 'confirmed' AND finish > ? AND start < ?
    LIMIT 1
  `).get(start, end);
}

/**
 * Claims an hour, or returns null if it is taken.
 *
 * SYNCHRONOUS and check-then-insert in one call: that is what stops two
 * parents booking the same hour. The caller must run this before any
 * `await`, or the gap between the check and the insert becomes a race.
 *
 * `sourceUtm` and `heardFrom` (migration 016) are written in this SAME
 * INSERT, not a follow-up UPDATE — there is no separate step where they
 * could land on the row without the booking, or vice versa. `sourceUtm` is
 * already-sanitized JSON (or null) built by the caller (/api/book); this
 * function does not interpret it.
 */
export function reserveBooking(b: {
  studentId: number;
  enrollmentId?: number | null;
  start: string;
  end: string;
  durationMin?: number | null;
  sourceUtm?: string | null;
  heardFrom?: string | null;
}): number | null {
  // Calls slotTaken rather than repeating its query, so the standalone
  // check and the one guarding this insert can never drift apart.
  if (slotTaken(b.start, b.end)) return null;

  const info = handle().prepare(`
    INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status, source_utm, heard_from)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
  `).run(b.studentId, b.enrollmentId ?? null, b.start, b.end,
         b.durationMin ?? null, new Date().toISOString(),
         b.sourceUtm ?? null, b.heardFrom ?? null);

  return Number(info.lastInsertRowid);
}

/** Soft cancel: a charge (`payments.booking_id`) can point at this row, and
 *  that foreign key has no `ON DELETE` clause, so deleting the row would
 *  throw once anything writes that column. The `status = 'confirmed'` filter
 *  already used by both OVERLAP_SOURCE consumers above is what actually
 *  frees the hour — a cancelled row just stops matching it. */
export function cancelBooking(id: number): void {
  handle().prepare(`UPDATE bookings_v2 SET status = 'cancelled' WHERE id = ?`).run(id);
}

/** Confirmed bookings overlapping [fromIso, toIso] — used to block those
 *  hours in availability. Reads both tables; see the note above. */
export function readBookings(fromIso: string, toIso: string): { start: string; end: string }[] {
  return handle().prepare(`
    SELECT start, finish AS end FROM (${OVERLAP_SOURCE})
    WHERE status = 'confirmed' AND finish > ? AND start < ?
    ORDER BY start
  `).all(fromIso, toIso) as { start: string; end: string }[];
}

/** The next confirmed booking for one student, used by tutor and family
 * dashboards instead of a browser-local "next lesson" field. */
export function nextBookingForStudent(studentId: number, nowIso: string = new Date().toISOString()): {
  id: number; start: string; end: string; duration: number | null;
} | null {
  return (handle().prepare(`
    SELECT id, start, "end" AS end, duration
    FROM bookings_v2
    WHERE student_id = ? AND status = 'confirmed' AND start > ?
    ORDER BY start ASC LIMIT 1
  `).get(studentId, nowIso) as { id: number; start: string; end: string; duration: number | null } | undefined) ?? null;
}

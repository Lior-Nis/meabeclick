/**
 * Who may teach a booking — the spec's "Candidates"
 * (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
 *
 * For student S (matched by name within account A, as enrollFromBooking
 * matches) in subject X:
 *   1. S's enrollment in X, if its tutor is active: that tutor.
 *   2. Else, the active tutors of A's enrollments: a new child joins the family's tutor.
 *   3. Else, everyone who takes bookings.
 * Then narrowed to those who take bookings. A tutor who is active but
 * missing settings leaves the family with no hours — they are not moved to
 * someone else (D3). A deactivated tutor counts as no tutor.
 */
import { handle } from './db.ts';
import {
  getTeacher, listTeachers, findAccountByEmail, findStudentInAccountByName, type TeacherRow,
} from './entities.ts';
import { takesBookings } from './tutor-settings.ts';

export interface Candidates {
  /** Who may teach it, narrowed to tutors who take bookings, in id order. */
  tutors: TeacherRow[];
  /** Rule 1 or 2 matched: the family has a tutor, and only that tutor will do. */
  returning: boolean;
  /** The family's tutor (lowest id), taken BEFORE the narrowing — what TUTOR_BUSY names. */
  familyTutorId: number | null;
}

const activeTutors = (ids: number[]): TeacherRow[] =>
  ids.map(getTeacher).filter((t): t is TeacherRow => !!t?.active);

/** Rule 3: everyone who takes bookings, Nikol (the lowest id) first. */
export const bookableTutors = (): TeacherRow[] => listTeachers().filter(takesBookings);

/** Rule 2: the active tutors of every enrollment in this account, id order. */
export function familyTutors(accountId: number): TeacherRow[] {
  const ids = (handle().prepare(`
    SELECT DISTINCT e.teacher_id AS id
      FROM enrollments e JOIN students_v2 s ON s.id = e.student_id
     WHERE s.account_id = ? AND e.teacher_id IS NOT NULL
     ORDER BY id
  `).all(accountId) as { id: number }[]).map(r => r.id);
  return activeTutors(ids);
}

function from(family: TeacherRow[]): Candidates {
  if (family.length) return { tutors: family.filter(takesBookings), returning: true, familyTutorId: family[0].id };
  return { tutors: bookableTutors(), returning: false, familyTutorId: null };
}

/** For a booking of student `name` in `subject`, by the account this email belongs to. */
export function bookingCandidates(b: { email?: unknown; name?: unknown; subject?: unknown }): Candidates {
  const account = findAccountByEmail(b.email);
  if (!account) return from([]);
  const student = findStudentInAccountByName(account.id, b.name);
  if (student) {
    const own = handle().prepare(
      `SELECT teacher_id AS id FROM enrollments WHERE student_id = ? AND subject = ? AND teacher_id IS NOT NULL`,
    ).get(student.id, String(b.subject ?? '').trim()) as { id: number } | undefined;
    const tutor = own ? activeTutors([own.id]) : [];
    if (tutor.length) return from(tutor); // rule 1
  }
  return from(familyTutors(account.id)); // rule 2, else rule 3
}

/** Whose hours the booking page is shown: the one tutor a TUTOR_BUSY reload
 *  names (if they take bookings), the signed-in family's tutors, or everyone. */
export function availabilityCandidates(q: { tutorId?: number | null; accountId?: number | null }): TeacherRow[] {
  if (q.tutorId != null) {
    const t = getTeacher(q.tutorId);
    return t && takesBookings(t) ? [t] : [];
  }
  return from(q.accountId != null ? familyTutors(q.accountId) : []).tutors;
}

/** A held booking (pending_bookings.teacher_id): confirming it books with
 *  that tutor, and asks only about their hour. */
export function heldCandidates(teacherId: number): Candidates {
  const t = getTeacher(teacherId);
  return { tutors: t ? [t] : [], returning: false, familyTutorId: null };
}

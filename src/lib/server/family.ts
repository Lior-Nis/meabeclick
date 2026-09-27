/**
 * Turns a verified family identity into the concrete question every guarded
 * route actually asks: which students may this visitor see, and may they see
 * the parent view?
 *
 * This lives apart from family-auth.ts on purpose. That module knows about
 * signatures and expiry and nothing about the database; this one knows about
 * rows and nothing about tokens. Keeping the split means an authorization
 * bug can only be in one of two small files, and neither has to be read to
 * understand the other.
 */

import {
  getAccount, getStudentById, studentsForAccount,
  accountForStudent,
  type AccountRow, type StudentRow,
} from './entities.ts';
import type { FamilyIdentity } from './family-auth.ts';

export interface FamilyAccess {
  identity: FamilyIdentity;
  /** The billing/login account. Present for both token kinds — a student
   *  token resolves to its owning account so the board can name the tutor
   *  and the family, never so the child can act as the account. */
  account: AccountRow;
  /** Every student this visitor may open. An account sees all of its
   *  students; a student token sees exactly itself. */
  students: StudentRow[];
  /** The one student a student token is scoped to; null for an account. */
  student: StudentRow | null;
  /** Whether the parent view (payments, all children, sharing) is allowed.
   *  False for a student token — this is the parent/child separation. */
  canSeeParentView: boolean;
  /** The account holder is the learner: there is no parent/child split to
   *  present, no sharing step, and no second board to choose between. */
  isSelf: boolean;
}

/**
 * Returns null when the identity names a row that no longer exists — a
 * deleted student, or an account removed from the dashboard. A signature
 * stays valid for its full term, so "the token verified" never implies
 * "the subject is still there".
 */
export function resolveFamilyAccess(identity: FamilyIdentity): FamilyAccess | null {
  if (identity.kind === 'account') {
    const account = getAccount(identity.id);
    if (!account) return null;
    const students = studentsForAccount(account.id);
    return {
      identity,
      account,
      students,
      student: null,
      canSeeParentView: true,
      isSelf: account.is_self === 1,
    };
  }

  const student = getStudentById(identity.id);
  if (!student) return null;
  const account = accountForStudent(student.id);
  if (!account) return null;

  return {
    identity,
    account,
    students: [student],
    student,
    canSeeParentView: false,
    isSelf: account.is_self === 1,
  };
}

/**
 * The single authorization predicate for "may this visitor read this
 * student's page?". Every route that takes a student code routes through
 * here rather than re-deriving the rule, because the rule is the whole
 * security model: an account reaches its own students and a student token
 * reaches only itself.
 */
export function studentInScope(access: FamilyAccess, code: string): StudentRow | null {
  return access.students.find(s => s.code === code) ?? null;
}

/** The student to open when the visitor named none. A single-student
 *  account (the common case, and every self-payer) should never be asked
 *  to choose from a list of one. */
export function defaultStudent(access: FamilyAccess): StudentRow | null {
  if (access.student) return access.student;
  return access.students.length === 1 ? access.students[0] : null;
}

/**
 * The link the tutor hands a family, replacing "regenerate their password".
 *
 * What this replaces: `POST /api/students/:code/regenerate` minted a new
 * 4-digit password and showed it to the tutor so she could read it back
 * over WhatsApp. Every recovery was a manual step in her week, and the
 * thing she read out was a secret the family then had to keep.
 *
 * She now copies a link instead. Two of them, because they are for
 * different people: the account link opens the parent view of the whole
 * family, and the student link opens one child's own board.
 *
 * Nothing is invalidated by asking. Minting a link does not revoke an
 * older one, so a tutor helping a parent on the phone cannot accidentally
 * lock out the child who is already using theirs.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getStudentByCode, accountForStudent } from '$server/entities.ts';
import { accountLink, studentLink } from '$server/family-auth.ts';
import { joinCodeForStudent, formatJoinCode } from '$server/join.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const student = getStudentByCode(event.params.code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });

  const account = accountForStudent(student.id);
  if (!account) return json({ error: 'student has no account' }, { status: 500 });

  return json({
    name: student.name,
    familyLink: accountLink(account.id),
    studentLink: studentLink(student.id),
    joinCode: formatJoinCode(joinCodeForStudent(student.id)),
    email: account.email,
  }, { headers: { 'Cache-Control': 'no-store' } });
};

/**
 * The tutor's own student list and student creation — behind her session,
 * never a family session.
 *
 * ## Why this moved to the entity model
 *
 * It used to write the legacy name-keyed `students` table while booking now
 * writes `accounts` + `students_v2`. Two stores, one of them invisible to
 * the portal: a student the tutor added by hand would have had a row, a
 * code and a password, and no way for the family to ever reach the page —
 * because every family-facing route resolves through the account model.
 * Adding a student here now creates exactly what a booking creates.
 *
 * A student added here has no password, because nothing has a password any
 * more. What the tutor hands the family is a link (see ./[code]/link).
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import {
  roster, getStudentByCode, createStudent, createAccount,
  findAccountByEmail, findStudentInAccountByName,
  upsertEnrollment, defaultTeacher, normalizeEmail,
} from '$server/entities.ts';
import { writePortalFile } from '$server/enroll.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  return json({ students: roster() }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const code = body?.code as string | undefined;
  const name = body?.name as string | undefined;
  const subject = String(body?.subject ?? '').trim();
  const level = String(body?.level ?? '').trim();
  const phone = String(body?.phone ?? '').trim() || null;
  const email = normalizeEmail(body?.email);

  if (!code || !name) return json({ error: 'code and name are required' }, { status: 400 });
  if (!/^[a-z0-9-]+$/.test(code)) {
    return json({ error: 'הקוד חייב להיות באנגלית קטנה, בלי רווחים' }, { status: 400 });
  }
  if (getStudentByCode(code)) return json({ error: 'הקוד הזה כבר תפוס' }, { status: 409 });

  /* An address is optional here, unlike at booking. The tutor sometimes
     adds a student before she has one, and she can hand over a link
     in person or over WhatsApp from the dashboard. Without an address the
     family simply cannot request a replacement link themselves — which is
     a smaller problem than refusing to let her record the student at all. */
  let account = email ? findAccountByEmail(email) : null;

  if (account && findStudentInAccountByName(account.id, name)) {
    return json({ error: 'למשפחה הזו כבר יש תלמיד/ה בשם הזה' }, { status: 409 });
  }

  if (!account) {
    account = createAccount({
      name,
      phone,
      credential: email || code,
      email: email || null,
    });
  }

  const student = createStudent({ code, name, accountId: account.id, credential: email || code });

  /* Same as a booking. Without this the student exists in the database
     but has no page, and /api/portal — which cannot serve a file that is
     not there — answers the family's valid link with a denial. */
  writePortalFile(student, { subject, level }, defaultTeacher()?.name ?? 'המורה');

  if (subject) {
    upsertEnrollment({
      studentId: student.id,
      subject,
      level: level || null,
      teacherId: defaultTeacher()?.id ?? null,
    });
  }

  return json({ student: { ...student, email: account.email, account_name: account.name } });
};

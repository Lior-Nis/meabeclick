/**
 * One student's charges, for the tutor's dashboard.
 *
 * Tutor-only. A family reads its own figures through /api/portal, scoped by
 * their session; this endpoint takes an arbitrary student code and so must
 * never be reachable by a family session.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getStudentByCode } from '$server/entities.ts';
import { addPayment, chargesForStudent, balanceForAccount, todayInIsrael } from '$server/payments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const code = event.url.searchParams.get('student') ?? '';
  const student = getStudentByCode(code);
  if (!student) return json({ error: 'student not found' }, { status: 404 });

  return json({
    charges: chargesForStudent(student.id),
    balance: balanceForAccount(student.account_id, todayInIsrael()),
  }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
  const student = getStudentByCode(String(body.studentCode ?? ''));
  const amount = Number(body.amountAgorot);
  const date = String(body.date ?? '').trim();
  const kind = String(body.kind ?? 'single');
  if (!student || !date || !Number.isInteger(amount) || amount <= 0 || !['single', 'double', 'triple'].includes(kind)) {
    return json({ error: 'invalid payment' }, { status: 400 });
  }
  const id = addPayment({
    accountId: student.account_id, studentId: student.id, date,
    kind: kind as 'single' | 'double' | 'triple', amountAgorot: amount,
    status: body.paid ? 'paid' : 'owed', note: String(body.note ?? '').slice(0, 1000) || null,
  });
  return json({ id });
};

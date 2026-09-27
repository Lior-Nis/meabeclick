/** The tutor's headline totals, across every account. Tutor-only. */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { balanceAllAccounts, todayInIsrael } from '$server/payments.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  return json({ balance: balanceAllAccounts(todayInIsrael()) }, { headers: { 'Cache-Control': 'no-store' } });
};

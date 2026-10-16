/** "מוכן ✓" for the browser that just finished, from the done cookie. */
import { getTeacher } from '$server/entities.ts';
import { readSetupCookie, SETUP_COOKIE } from '$server/tutor-setup.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
  const c = readSetupCookie(cookies.get(SETUP_COOKIE));
  const t = c?.kind === 'done' ? getTeacher(c.teacherId) : null;
  if (!t?.meet_url) return { done: false as const };
  return { done: true as const, meetUrl: t.meet_url, account: t.meet_account };
};

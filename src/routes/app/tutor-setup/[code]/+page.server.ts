/**
 * The page a setup link opens. Opening it changes nothing — WhatsApp's link
 * preview fetches it before the tutor does — so only the button acts.
 */
import { teacherForCode } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
  const teacher = teacherForCode(params.code);
  if (!teacher) return { state: 'expired' as const };
  if (!webClientFromEnv()) return { state: 'off' as const, name: teacher.name };
  const e = url.searchParams.get('e');
  return {
    state: 'ready' as const,
    name: teacher.name,
    start: `/api/tutor-setup/start?code=${params.code}`,
    hasRoom: !!teacher.meet_url,
    problem: e === 'denied' || e === 'google' ? e : null,
  };
};

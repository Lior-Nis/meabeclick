/**
 * Where the confirmation email's link lands. It SHOWS the held booking and
 * offers a button; it never confirms by itself. Mail scanners and link
 * previews open links, and a confirm-on-GET would let a family's own
 * scanner accept a stranger's booking. The button POSTs { confirm } to
 * /api/book. See pending-bookings.ts.
 */
import { verifyPendingToken } from '$server/family-auth.ts';
import { pendingById } from '$server/pending-bookings.ts';
import type { PageServerLoad } from './$types';

const when = (iso: string): string => new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

export const load: PageServerLoad = ({ url }) => {
  const token = url.searchParams.get('t') ?? '';
  const id = verifyPendingToken(token);
  const held = id === null ? null : pendingById(id);
  if (!held) return { valid: false as const };
  return {
    valid: true as const,
    token,
    studentName: String(held.body.name ?? ''),
    subject: String(held.body.subject ?? ''),
    when: when(held.body.start),
  };
};

/**
 * GET /api/availability?duration=45|90|135[&tutor=<id>]
 *
 * The free lesson slots of the coming week: the union of each candidate
 * tutor's own free slots (src/lib/server/tutor-slots.ts holds the rules),
 * from their own teaching hours, their own busy addresses and the lessons
 * they hold here. Another tutor's lesson never blocks a slot.
 *
 * Whose hours (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md):
 *   - ?tutor=<id>: that tutor only, if they take bookings — the reload
 *     after a TUTOR_BUSY answer from /api/book;
 *   - a signed-in family: their tutors (everyone, if they have none yet);
 *   - anyone else: every tutor who takes bookings.
 * Which tutor a slot belongs to is never in the answer.
 */
import { json } from '@sveltejs/kit';
import { fetchTutorBusy } from '$server/calendar.ts';
import { readBookingsFor } from '$server/entities.ts';
import { availabilityCandidates } from '$server/tutor-candidates.ts';
import { busyAddresses, teachingHours } from '$server/tutor-settings.ts';
import { buildBookingWindow, tutorSlots, unionSlots } from '$server/tutor-slots.ts';
import type { RequestHandler } from './$types';

const VALID_DURATIONS = [45, 90, 135];

export const GET: RequestHandler = async ({ url, locals }) => {
  const headers = {
    // Never let a browser reuse an old answer: a slot that was free a
    // minute ago may be booked now, and a stale list is how two parents
    // get the same hour.
    'Cache-Control': 'no-store, max-age=0',
  };

  const durationMin = parseInt(url.searchParams.get('duration') ?? '', 10);
  if (!VALID_DURATIONS.includes(durationMin)) {
    return json({ error: 'duration חייב להיות 45, 90 או 135' }, { status: 400, headers });
  }

  const asked = Number(url.searchParams.get('tutor'));
  const tutors = availabilityCandidates({
    tutorId: Number.isInteger(asked) && asked > 0 ? asked : null,
    accountId: locals.family?.kind === 'account' ? locals.family.id : null,
  });

  try {
    const { days, timeMin, timeMax } = buildBookingWindow();
    if (!days.length || !timeMin || !timeMax) {
      return json({ slots: [], message: 'no_days' }, { headers });
    }

    const perTutor = await Promise.all(tutors.map(async t => {
      const read = await fetchTutorBusy({ id: t.id, name: t.name, addresses: busyAddresses(t) }, timeMin, timeMax);
      /* Lessons booked here are busy too — and they may not be in the
         calendar at all when no service account is configured to write them. */
      const bookings = readBookingsFor(t.id, timeMin, timeMax);
      return { read, bookings, slots: tutorSlots(days, { hours: teachingHours(t), calendar: read.busy, bookings }, durationMin) };
    }));

    return json({
      slots: unionSlots(perTutor.map(p => p.slots)),
      /* Every tutor offered here reads their own calendars (takesBookings),
         so this is false only when nobody can be offered at all.
         calendarFailures says how many of `calendars` did not come through
         this time, so the page can say the times are unconfirmed. */
      calendarConnected: tutors.length > 0,
      calendars: perTutor.reduce((n, p) => n + p.read.total, 0),
      calendarFailures: perTutor.reduce((n, p) => n + p.read.failed, 0),
      booked: perTutor.reduce((n, p) => n + p.bookings.length, 0),
    }, { headers });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, { status: 500, headers });
  }
};

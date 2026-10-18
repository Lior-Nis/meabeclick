/**
 * Choosing the tutor for one booking
 * (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md, "Booking").
 *
 * Two halves, because of the race defense. The candidates' calendars are
 * read first — async, BEFORE /api/book's synchronous block. The choice is
 * then made synchronously, INSIDE that block, against the database as it
 * is at that instant, so the tutor chosen is the tutor reserveBooking
 * claims the hour for, with nothing awaited between.
 */
import { fetchTutorBusy, type BusyInterval } from './calendar.ts';
import { readBookingsFor, type TeacherRow } from './entities.ts';
import { busyAddresses, teachingHours } from './tutor-settings.ts';
import { bookableTutors, type Candidates } from './tutor-candidates.ts';
import { pickTutor, type TutorDay } from './tutor-slots.ts';

/** A day either side of the lesson: enough for any buffer or break. */
const MARGIN_MS = 24 * 3600 * 1000;
const around = (start: string, end: string) => ({
  from: new Date(Date.parse(start) - MARGIN_MS).toISOString(),
  to: new Date(Date.parse(end) + MARGIN_MS).toISOString(),
});

/** Whose calendars to read: the candidates and — for a returning family —
 *  everyone else who takes bookings, because TUTOR_BUSY depends on whether
 *  another tutor is free. */
export function tutorsToAsk(c: Candidates): TeacherRow[] {
  const all = c.returning ? [...c.tutors, ...bookableTutors()] : c.tutors;
  return [...new Map(all.map(t => [t.id, t])).values()];
}

/**
 * Each tutor's calendar busy times around [start, end), from the same
 * 5-minute cache the hours page fills. A feed that cannot be read counts as
 * free — the fail-open availability already applies — and is recorded for
 * the dashboard's warning (calendar.ts).
 */
export async function calendarBusyAround(
  tutors: TeacherRow[], start: string, end: string,
): Promise<Map<number, BusyInterval[]>> {
  const { from, to } = around(start, end);
  const reads = await Promise.all(tutors.map(async t => {
    const read = await fetchTutorBusy({ id: t.id, name: t.name, addresses: busyAddresses(t) }, from, to);
    return [t.id, read.busy] as const;
  }));
  return new Map(reads);
}

export interface Assignment {
  /** Who teaches it, or null when no candidate is free. */
  tutor: TeacherRow | null;
  /** No candidate is free, the family is returning, and another tutor who
   *  takes bookings is free: their own tutor is the busy one. */
  tutorBusy: boolean;
}

/** SYNCHRONOUS — call it inside /api/book's no-await block, right before
 *  enrolment and reserveBooking. */
export function assignTutor(
  c: Candidates, start: string, end: string, calendar: Map<number, BusyInterval[]>,
): Assignment {
  const { from, to } = around(start, end);
  const day = (t: TeacherRow): TutorDay => ({
    hours: teachingHours(t),
    calendar: calendar.get(t.id) ?? [],
    bookings: readBookingsFor(t.id, from, to),
  });
  const tutor = pickTutor(c.tutors, start, end, day);
  if (tutor || !c.returning) return { tutor, tutorBusy: false };
  const others = bookableTutors().filter(t => !c.tutors.some(x => x.id === t.id));
  return { tutor: null, tutorBusy: pickTutor(others, start, end, day) !== null };
}

/**
 * A tutor's teaching hours (teachers.teaching_hours, migration 029).
 *
 * Shared by the server (which slots to offer) and the dashboard's editor,
 * so the two can never disagree about what a valid week is.
 *
 *   {"0":["08:00","21:00"], …, "5":["08:00","16:00"]}
 *
 * Keys are weekdays in Israel time, Sunday = 0 to Friday = 5; a missing key
 * is a day off, and Saturday is always off. Each pair is the earliest START
 * and the latest END of a lesson.
 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5;
export type TeachingHours = Partial<Record<Weekday, [string, string]>>;

export const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5];
export const WEEKDAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/** Today's window: Sunday to Thursday 08:00–21:00, Friday 08:00–16:00. */
export const DEFAULT_HOURS: TeachingHours = {
  0: ['08:00', '21:00'], 1: ['08:00', '21:00'], 2: ['08:00', '21:00'],
  3: ['08:00', '21:00'], 4: ['08:00', '21:00'], 5: ['08:00', '16:00'],
};

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

/** "08:30" → 510. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** A week as the dashboard sends it, or null if any part of it is wrong: a
 *  key that is not Sunday–Friday, a time that is not HH:MM, or a day that
 *  does not end after it starts. Nothing is half-accepted. */
export function parseTeachingHours(raw: unknown): TeachingHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: TeachingHours = {};
  for (const [key, pair] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-5]$/.test(key)) return null;
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [from, to] = pair;
    if (typeof from !== 'string' || typeof to !== 'string' || !HHMM.test(from) || !HHMM.test(to)) return null;
    if (minutesOf(from) >= minutesOf(to)) return null;
    out[Number(key) as Weekday] = [from, to];
  }
  return out;
}

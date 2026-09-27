/**
 * Direct port of api/availability.js.
 *
 * GET /api/availability?duration=45|90|135
 *
 * Returns available lesson slots by scanning Google Calendar for free gaps.
 *
 * Booking window:
 *   Sun–Fri of current week (tomorrow → this Sat midnight)
 *   After Sat 20:00 IL → next Sun–Sat only
 *
 * Rules:
 *   - Teaching days: Sun–Fri (Sat is off)
 *   - Teaching window: 08:00–21:00 Israel time, and 08:00–16:00 on Friday
 *     (the window is when a lesson must finish, so a 90-min lesson can start
 *      no later than 19:30 — or 14:30 on Friday)
 *   - 30-min buffer after a calendar event, 15-min break after a booked lesson
 *   - Slots generated every 30 min within free gaps
 *
 * Busy times come from CALENDAR_ICS_URLS (private iCal addresses — the only
 * way to read a calendar that is not public without a service account).
 * GOOGLE_API_KEY is kept as a fallback for calendars that are public.
 */
import { json } from '@sveltejs/kit';
import { fetchBusy, icsUrls, availabilityCalendarIds } from '$server/calendar.ts';
import { readBookings } from '$server/entities.ts';
import type { RequestHandler } from './$types';

const BUFFER_MIN = 30; // after a calendar commitment
const LESSON_BREAK_MIN = 15; // after a lesson someone booked here
const SLOT_STEP_MIN = 30;
const DAY_START_H = 8;
/* Working boundaries: a lesson has to *end* by these hours, not start at
   them. Friday is a short day. */
const DAY_END_H = 21; // Sun–Thu
const FRIDAY_END_H = 16;
const TZ = 'Asia/Jerusalem';
const TEACHING_DAYS = [0, 1, 2, 3, 4, 5]; // Sun=0 … Fri=5
const VALID_DURATIONS = [45, 90, 135];

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

interface Slot {
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  dayOfWeek: number;
}

interface BusyEvent {
  start: string;
  end: string;
  bufferMin?: number;
}

export const GET: RequestHandler = async ({ url }) => {
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

  const apiKey = process.env.GOOGLE_API_KEY;

  /* All calendars to check — skip any that aren't public (403/401).
     From the environment, not from a literal: a calendar id names a
     person, and these were Nicole's own, including her university
     address. See availabilityCalendarIds() for the rest of that. */
  const calendarIds = availabilityCalendarIds();

  try {
    const { days, timeMin, timeMax } = buildBookingWindow();

    if (!days.length || !timeMin || !timeMax) {
      return json({ slots: [], message: 'no_days' }, { headers });
    }

    /* Lessons booked here are busy too — and they may not be in the
       calendar at all when no service account is configured to write them
       there. */
    const booked: BusyEvent[] = readBookings(timeMin, timeMax)
      .map(b => ({ start: b.start, end: b.end, bufferMin: LESSON_BREAK_MIN }));

    // Preferred path: the iCal feeds.
    const icsResult = await fetchBusy(timeMin, timeMax);
    if (icsResult) {
      return json(
        {
          slots: buildFreeSlots(days, [...icsResult.busy, ...booked], durationMin),
          // Honest even when some feeds failed: calendarConnected reflects
          // that iCal is the configured source, not that every feed in it
          // was read successfully this request — calendarFailures says how
          // many of `calendars` did not come through, so a caller cannot
          // mistake a partial read for a clean one.
          calendarConnected: true,
          calendars: icsUrls().length,
          calendarFailures: icsResult.failed,
          booked: booked.length,
        },
        { headers },
      );
    }

    /* Nothing configured: every hour looks free, which is worse than
       showing nothing. An empty calendar list counts as nothing
       configured — fetching zero calendars would otherwise find zero busy
       events and report a clean read of a calendar nobody named. */
    if (!apiKey || !calendarIds.length) {
      console.warn('[availability] no calendar configured — all slots reported free');
      return json(
        { slots: buildFreeSlots(days, booked, durationMin), calendarConnected: false, booked: booked.length },
        { headers },
      );
    }

    // Rebound as definitely-string locals: TS's control-flow narrowing from
    // the `!timeMin || !timeMax` check above does not carry into the
    // fetchCalendar closure below.
    const rangeMin: string = timeMin;
    const rangeMax: string = timeMax;

    // Fetch all calendars in parallel, silently skip private ones
    async function fetchCalendar(calId: string): Promise<BusyEvent[]> {
      const calUrl = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`,
      );
      calUrl.searchParams.set('key', apiKey!);
      calUrl.searchParams.set('timeMin', rangeMin);
      calUrl.searchParams.set('timeMax', rangeMax);
      calUrl.searchParams.set('singleEvents', 'true');
      calUrl.searchParams.set('orderBy', 'startTime');
      try {
        const r = await fetch(calUrl.toString());
        if (!r.ok) return []; // skip private/inaccessible calendars
        const data = await r.json();
        return (data.items || [])
          .map((e: any) => ({
            start: e.start?.dateTime || e.start?.date,
            end: e.end?.dateTime || e.end?.date,
          }))
          .filter((e: BusyEvent) => e.start && e.end);
      } catch {
        return [];
      }
    }

    const results = await Promise.all(calendarIds.map(fetchCalendar));
    const events = results.flat();

    const slots = buildFreeSlots(days, [...events, ...booked], durationMin);
    return json({ slots, calendarConnected: events.length > 0, booked: booked.length }, { headers });
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, { status: 500, headers });
  }
};

// ── Determine which days to show ────────────────────────────────────────
function buildBookingWindow(): { days: Date[]; timeMin: string | null; timeMax: string | null } {
  const now = new Date();

  // api/availability.js reads the current Israel day-of-week and hour here
  // only to compute an isSatAfter20 flag that then goes unused — the
  // "always show the next 7 days" branch below runs unconditionally
  // regardless of its value. Not reproduced here for the same reason
  // unused code isn't reproduced elsewhere in this migration: nothing
  // downstream reads it.

  // today at local midnight (UTC)
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const days: Date[] = [];

  // Always show the next 7 days (skip Saturday)
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    if (TEACHING_DAYS.includes(d.getUTCDay())) days.push(d);
  }

  if (!days.length) return { days: [], timeMin: null, timeMax: null };

  const timeMin = days[0].toISOString();
  const timeMax = new Date(days[days.length - 1].getTime() + 24 * 3600 * 1000).toISOString();

  return { days, timeMin, timeMax };
}

// ── Find free gaps and generate slot times ──────────────────────────────
function buildFreeSlots(days: Date[], events: BusyEvent[], durationMin: number): Slot[] {
  const slots: Slot[] = [];
  const durationMs = durationMin * 60 * 1000;
  const stepMs = SLOT_STEP_MIN * 60 * 1000;

  for (const day of days) {
    const isFriday = day.getUTCDay() === 5;
    const winStart = ilHourToUTC(day, DAY_START_H);
    const winEnd = ilHourToUTC(day, isFriday ? FRIDAY_END_H : DAY_END_H);

    // Events that overlap this day's teaching window, sorted by start
    const dayBusy = events
      .filter(e => {
        const s = new Date(e.start).getTime();
        const f = new Date(e.end).getTime();
        return s < winEnd && f > winStart;
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    let cursor = winStart;

    for (const event of dayBusy) {
      const busyStart = Math.max(new Date(event.start).getTime(), winStart);
      const busyEnd = Math.min(new Date(event.end).getTime(), winEnd);

      // Generate slots in [cursor, busyStart)
      let t = cursor;
      while (t + durationMs <= busyStart) {
        slots.push(makeSlot(t, durationMs));
        t += stepMs;
      }

      // Advance cursor past this event + its own buffer
      const gap = (event.bufferMin ?? BUFFER_MIN) * 60 * 1000;
      cursor = Math.max(cursor, busyEnd + gap);
    }

    // Remaining gap after last event
    let t = cursor;
    while (t + durationMs <= winEnd) {
      slots.push(makeSlot(t, durationMs));
      t += stepMs;
    }
  }

  return slots;
}

// ── Convert a UTC-midnight date + Israel hour → UTC timestamp ────────────
function ilHourToUTC(dayUTC: Date, ilHour: number): number {
  // Probe: what IL hour is UTC noon on this day?
  const probe = new Date(dayUTC.getTime() + 12 * 3600 * 1000);
  const ilNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(probe),
    10,
  );
  const offsetH = ilNoon - 12; // IL offset from UTC (positive = IL ahead)
  return dayUTC.getTime() + (ilHour - offsetH) * 3600 * 1000;
}

// ── Build a slot object ───────────────────────────────────────────────────
function makeSlot(startMs: number, durationMs: number): Slot {
  const startDate = new Date(startMs);
  const endDate = new Date(startMs + durationMs);

  // Format in Israel time
  const ilFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = ilFmt.formatToParts(startDate);
  const get = (t: string): string | undefined => parts.find(p => p.type === t)?.value;

  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dowMap[get('weekday') ?? ''] ?? startDate.getDay();
  const d = parseInt(get('day') ?? '', 10);
  const m = parseInt(get('month') ?? '', 10) - 1;
  const h = get('hour');
  const min = get('minute');

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    dateLabel: `יום ${DAY_NAMES[dow]}, ${d} ${MONTH_NAMES[m]}`,
    timeLabel: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    dayOfWeek: dow,
  };
}

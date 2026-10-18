/**
 * Free lesson slots, per tutor.
 *
 * Moved out of /api/availability, where it was the whole route, so the
 * rules can be tested without a server — and so /api/book can ask the same
 * question about one hour when it chooses a tutor (offers, pickTutor).
 *
 *   - The booking window is the next 7 days, Saturday skipped — the same
 *     for every tutor.
 *   - A tutor's teaching hours give each day's window: a lesson starts at
 *     or after the first time and ends by the second.
 *   - 30 minutes clear after a calendar event, 15 after a lesson booked here.
 *   - Slots every 30 minutes within the free gaps.
 *
 * PURE: no database and no network.
 */
import type { BusyInterval } from './calendar.ts';
import { minutesOf, type TeachingHours, type Weekday } from '../teaching-hours.ts';

export const BUFFER_MIN = 30; // after a calendar commitment
export const LESSON_BREAK_MIN = 15; // after a lesson someone booked here
const SLOT_STEP_MIN = 30;
const MIN_MS = 60_000;
const TZ = 'Asia/Jerusalem';
const BOOKABLE_DAYS = [0, 1, 2, 3, 4, 5]; // Sun=0 … Fri=5

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export interface Slot {
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  dayOfWeek: number;
}

/** Everything that keeps one tutor from an hour. */
export interface TutorDay {
  hours: TeachingHours;
  /** From their own calendars: busy until BUFFER_MIN after each ends. */
  calendar: BusyInterval[];
  /** Lessons and holds they own here: busy until LESSON_BREAK_MIN after. */
  bookings: BusyInterval[];
}

interface BusyEvent { start: string; end: string; bufferMin: number }

const eventsOf = (t: Pick<TutorDay, 'calendar' | 'bookings'>): BusyEvent[] => [
  ...t.calendar.map(e => ({ start: e.start, end: e.end, bufferMin: BUFFER_MIN })),
  ...t.bookings.map(b => ({ start: b.start, end: b.end, bufferMin: LESSON_BREAK_MIN })),
];

/** The next 7 days after `now`'s UTC date, Saturday skipped. */
export function buildBookingWindow(now: Date = new Date()): { days: Date[]; timeMin: string | null; timeMax: string | null } {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const days: Date[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + i);
    if (BOOKABLE_DAYS.includes(d.getUTCDay())) days.push(d);
  }
  if (!days.length) return { days: [], timeMin: null, timeMax: null };
  return {
    days,
    timeMin: days[0].toISOString(),
    timeMax: new Date(days[days.length - 1].getTime() + 24 * 3600 * 1000).toISOString(),
  };
}

/** UTC ms of `minutes` past midnight, Israel time, on the date `dayUTC`
 *  (a UTC midnight) names. Probes UTC noon for that day's offset, so a day
 *  the clocks change on still gets its own. */
export function ilMinutesToUTC(dayUTC: Date, minutes: number): number {
  const probe = new Date(dayUTC.getTime() + 12 * 3600 * 1000);
  const ilNoon = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(probe),
    10,
  );
  const offsetH = ilNoon - 12; // IL offset from UTC (positive = IL ahead)
  return dayUTC.getTime() + (minutes - offsetH * 60) * MIN_MS;
}

/** This tutor's [start, end) on that date, or null on a day off. */
function windowOn(day: Date, hours: TeachingHours): [number, number] | null {
  const pair = hours[day.getUTCDay() as Weekday];
  return pair ? [ilMinutesToUTC(day, minutesOf(pair[0])), ilMinutesToUTC(day, minutesOf(pair[1]))] : null;
}

/** One tutor's free slots over these days. */
export function tutorSlots(days: Date[], t: TutorDay, durationMin: number): Slot[] {
  const slots: Slot[] = [];
  const durationMs = durationMin * MIN_MS;
  const stepMs = SLOT_STEP_MIN * MIN_MS;
  const events = eventsOf(t);

  for (const day of days) {
    const win = windowOn(day, t.hours);
    if (!win) continue;
    const [winStart, winEnd] = win;

    // Events that overlap this day's window, sorted by start.
    const dayBusy = events
      .filter(e => Date.parse(e.start) < winEnd && Date.parse(e.end) > winStart)
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

    let cursor = winStart;
    for (const event of dayBusy) {
      const busyStart = Math.max(Date.parse(event.start), winStart);
      const busyEnd = Math.min(Date.parse(event.end), winEnd);
      for (let at = cursor; at + durationMs <= busyStart; at += stepMs) slots.push(makeSlot(at, durationMs));
      cursor = Math.max(cursor, busyEnd + event.bufferMin * MIN_MS);
    }
    for (let at = cursor; at + durationMs <= winEnd; at += stepMs) slots.push(makeSlot(at, durationMs));
  }
  return slots;
}

/** The slots any of these tutors has free: one per start time, in time
 *  order. Which tutor a slot belongs to is never part of it. */
export function unionSlots(lists: Slot[][]): Slot[] {
  const byStart = new Map<string, Slot>();
  for (const s of lists.flat()) if (!byStart.has(s.start)) byStart.set(s.start, s);
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** The Israel date an instant falls on, as a UTC midnight — the shape the
 *  booking window's days have. */
function israelDate(ms: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Whether this tutor would offer [start, end): the slot rules above,
 *  without the 30-minute grid. */
export function offers(t: TutorDay, start: string, end: string): boolean {
  const s = Date.parse(start), e = Date.parse(end);
  if (!(s < e)) return false;
  const win = windowOn(israelDate(s), t.hours);
  if (!win) return false;
  const [winStart, winEnd] = win;
  if (s < winStart || e > winEnd) return false;
  return !eventsOf(t).some(ev => {
    const es = Date.parse(ev.start), ee = Date.parse(ev.end);
    if (!(es < winEnd && ee > winStart)) return false; // the slot rules ignore it too
    return e > es && s < ee + ev.bufferMin * MIN_MS;
  });
}

/** Whether anything this tutor has overlaps [start, end) at all. */
export function clashes(t: Pick<TutorDay, 'calendar' | 'bookings'>, start: string, end: string): boolean {
  const s = Date.parse(start), e = Date.parse(end);
  return [...t.calendar, ...t.bookings].some(b => Date.parse(b.end) > s && Date.parse(b.start) < e);
}

/** Whether [start, end) lies inside this tutor's teaching hours that day. */
function withinHours(t: TutorDay, start: string, end: string): boolean {
  const s = Date.parse(start), e = Date.parse(end);
  if (!(s < e)) return false;
  const win = windowOn(israelDate(s), t.hours);
  return !!win && s >= win[0] && e <= win[1];
}

/**
 * Who teaches a lesson at [start, end), in three passes over the
 * candidates in the order given (id order, so Nikol first):
 *
 *   1. whose hours, buffers and breaks would offer that hour;
 *   2. whose hours contain it and who has nothing in it — a buffer is a
 *      preference, a tutor's day is not;
 *   3. only when the hour lies in NO candidate's day, the first who has
 *      nothing in it.
 *
 * Pass 2 never hands a tutor an hour outside their own day because the
 * tutor whose day it is, is busy: that is a stale page meeting a taken
 * hour, and the answer is no. Pass 3 keeps what one tutor could always do:
 * a lesson booked outside everyone's hours — by the tutor for a family, or
 * on a Saturday — still lands when nothing clashes.
 */
export function pickTutor<T extends { id: number }>(
  candidates: T[], start: string, end: string, dayOf: (t: T) => TutorDay,
): T | null {
  const free = (t: T) => !clashes(dayOf(t), start, end);
  const inDay = (t: T) => withinHours(dayOf(t), start, end);
  return candidates.find(t => offers(dayOf(t), start, end))
    ?? candidates.find(t => inDay(t) && free(t))
    ?? (candidates.some(inDay) ? null : candidates.find(free))
    ?? null;
}

function makeSlot(startMs: number, durationMs: number): Slot {
  const startDate = new Date(startMs);
  const endDate = new Date(startMs + durationMs);

  // Format in Israel time
  const ilFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
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

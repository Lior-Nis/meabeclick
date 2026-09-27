/**
 * Busy-time source for the booking page.
 *
 * Google's API needs either a public calendar (an API key can read nothing else)
 * or a service account. A private iCal address needs neither: it is a secret URL
 * Google generates per calendar, so the server can read the real calendar without
 * anyone's calendar becoming public.
 *
 * Env: CALENDAR_ICS_URLS — one or more secret iCal addresses, comma or newline separated.
 */
import ical from 'node-ical';

const MS_DAY = 86400000;

export type BusyInterval = { start: string; end: string };

interface IcalEvent {
  type?: string;
  status?: string;
  datetype?: string;
  transparency?: string;
  start?: Date & { dateOnly?: boolean };
  end?: Date;
  rrule?: { between: (after: Date, before: Date, inc: boolean) => Date[] };
  exdate?: Record<string, unknown>;
  recurrences?: Record<string, IcalEvent & { status?: string; start: Date; end: Date }>;
}

/** All-day entries (birthdays, "vacation") would otherwise block whole teaching days. */
const isAllDay = (ev: IcalEvent): boolean =>
  ev.datetype === 'date' || (!!ev.start && !ev.start.dateOnly === false && ev.datetype === 'date');

function occurrencesInRange(ev: IcalEvent, from: Date, to: Date): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  const durationMs = (ev.end?.getTime?.() ?? 0) - (ev.start?.getTime?.() ?? 0);

  if (!ev.rrule) {
    if (ev.start && ev.end && ev.end > from && ev.start < to) {
      out.push({ start: ev.start, end: ev.end });
    }
    return out;
  }

  // Recurring: expand, then apply this calendar's cancellations and moved instances.
  const excluded = new Set(Object.keys(ev.exdate || {}));
  const overrides = ev.recurrences || {};

  for (const date of ev.rrule.between(new Date(from.getTime() - MS_DAY), to, true)) {
    const key = date.toISOString().slice(0, 10);
    const override = overrides[key] || Object.entries(overrides)
      .find(([k]) => k.slice(0, 10) === key)?.[1];

    if (override) {
      if (override.status === 'CANCELLED') continue;
      if (override.end > from && override.start < to) {
        out.push({ start: override.start, end: override.end });
      }
      continue;
    }
    if ([...excluded].some(x => x.slice(0, 10) === key)) continue;

    const end = new Date(date.getTime() + durationMs);
    if (end > from && date < to) out.push({ start: date, end });
  }
  return out;
}

const skip = (ev: IcalEvent | null | undefined): boolean =>
  !ev || ev.type !== 'VEVENT' ||
  ev.status === 'CANCELLED' ||
  ev.datetype === 'date' ||          // all-day: not a teaching conflict
  ev.transparency === 'TRANSPARENT'; // marked "free" in Google

/**
 * Parsed ICS text → busy intervals inside [timeMin, timeMax].
 *
 * Two feed shapes have to work. A private feed keeps RRULE and needs expanding.
 * Google's *public* feed instead ships every occurrence as its own VEVENT sharing
 * one UID — and node-ical keys its result by UID, so those instances live in
 * ev.recurrences and are invisible unless read separately.
 */
export function busyFromIcs(icsText: string, timeMin: string, timeMax: string): BusyInterval[] {
  const parsed = ical.sync.parseICS(icsText) as Record<string, IcalEvent>;
  const from = new Date(timeMin), to = new Date(timeMax);
  const busy: BusyInterval[] = [];
  const seen = new Set<string>();   // one occurrence can arrive both as the base event and as an instance
  const push = (start: Date, end: Date) => {
    if (!(end > from && start < to)) return;
    const key = `${start.toISOString()}|${end.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    busy.push({ start: start.toISOString(), end: end.toISOString() });
  };

  for (const ev of Object.values(parsed)) {
    if (skip(ev)) continue;

    for (const o of occurrencesInRange(ev, from, to)) push(o.start, o.end);

    for (const inst of Object.values(ev.recurrences || {})) {
      if (skip(inst) || !inst.start || !inst.end) continue;
      push(inst.start, inst.end);
    }
  }
  return busy;
}

export function icsUrls(): string[] {
  return (process.env.CALENDAR_ICS_URLS || '')
    .split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Calendar ids for /api/availability's Google Calendar API fallback — the
 * path taken only when no iCal feed is configured and GOOGLE_API_KEY is.
 *
 * These used to be six literals in the route: Nicole's personal Gmail, her
 * university address, and four private calendar ids, committed and pushed.
 * A calendar id names a person, so it belongs in the environment next to
 * CALENDAR_ICS_URLS rather than in the history of a repo that gets cloned.
 *
 * Empty when unset, and the route treats empty as "nothing configured"
 * rather than fetching no calendars and calling every hour free.
 */
export function availabilityCalendarIds(): string[] {
  return (process.env.AVAILABILITY_CALENDAR_IDS || '')
    .split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

/* A year of expanded occurrences is around a megabyte; re-downloading and
   re-parsing it on every page load would make the booking page crawl.
   Decision: 5 minutes is the accepted staleness window. In plain terms —
   an event created or cancelled in Google can take up to 5 minutes, plus
   Google's own iCal-publishing lag (typically longer, and outside our
   control), before it changes the slots this server offers. That is why
   double-booking is prevented by the booking *write* path (readBookings /
   the booking table), not by this calendar read — the calendar can be
   briefly stale, but the write path always knows about every booking made
   through this site the instant it happens. */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; text: string }>();  // url → { at, text }

async function calendarText(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  cache.set(url, { at: Date.now(), text });
  return text;
}

/**
 * A feed is identified only by its 1-based position among the configured
 * feeds — never by its URL, which is a secret. This turns any error into
 * one of a short whitelist of safe words, so nothing derived from the URL
 * (hostname, path, query) can ever leak into a log line, an API response,
 * or the dashboard.
 */
function classifyReadError(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof e?.name === 'string' ? e.name : '';
  const message = typeof e?.message === 'string' ? e.message : String(err ?? '');

  if (name === 'TimeoutError' || /timeout|aborted/i.test(message)) return 'timeout';

  const httpMatch = /^HTTP (\d{3})$/.exec(message);
  if (httpMatch) return `HTTP ${httpMatch[1]}`;

  if (name === 'SyntaxError' || /pars(e|ing)/i.test(message)) return 'parse error';

  // Unclassified: deliberately never echo the raw error, which could carry
  // request details (host, path) derived from the secret URL.
  return 'שגיאת קריאה';
}

export type CalendarSourceIssue = { index: number; total: number; at: string; reason: string };

/** Last read failure per feed, keyed by its 0-based position. Cleared the
 *  next time that same feed reads successfully, so a recovered calendar
 *  stops warning. */
const sourceIssues = new Map<number, { at: string; reason: string }>();

/** Read-failure state for the tutor dashboard — feeds identified by
 *  position only («יומן 2 מתוך 3»), never by URL. */
export function calendarSourceIssues(): CalendarSourceIssue[] {
  const total = icsUrls().length;
  return [...sourceIssues.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, issue]) => ({ index: index + 1, total, ...issue }));
}

/** Fetch every configured calendar; a calendar that fails is skipped, not
 *  fatal to the request — but the failure is recorded (see
 *  calendarSourceIssues) rather than silently dropped. */
export async function fetchBusy(
  timeMin: string,
  timeMax: string,
): Promise<{ busy: BusyInterval[]; failed: number } | null> {
  const urls = icsUrls();
  if (!urls.length) return null;                     // null = not configured

  let failed = 0;
  const all = await Promise.all(urls.map(async (url, i) => {
    try {
      const busy = busyFromIcs(await calendarText(url), timeMin, timeMax);
      sourceIssues.delete(i);
      return busy;
    } catch (err) {
      const reason = classifyReadError(err);
      sourceIssues.set(i, { at: new Date().toISOString(), reason });
      failed++;
      console.error(`[calendar] יומן ${i + 1} מתוך ${urls.length} — קריאה נכשלה: ${reason}`);
      return [];
    }
  }));
  return { busy: all.flat(), failed };
}

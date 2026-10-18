/**
 * Busy-time source for the booking page.
 *
 * Google's API needs either a public calendar (an API key can read nothing else)
 * or a service account. A private iCal address needs neither: it is a secret URL
 * Google generates per calendar, so the server can read the real calendar without
 * anyone's calendar becoming public.
 *
 * Each tutor has their own addresses (teachers.busy_ics, migration 029; see
 * tutor-settings.ts). A failing feed is identified by its tutor and position,
 * never by its address.
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

/* A feed that just failed is not asked again for FAILURE_MS. Every booking
   submit reads its candidates' feeds, and a feed that hangs would otherwise
   cost each of them up to the 15s timeout. Its dashboard warning stays
   meanwhile, and the failure is logged once, not on every read. */
const FAILURE_MS = 2 * 60 * 1000;
const recentFailure = new Map<string, { at: number; reason: string }>();  // url → last failure

/** Whose feeds these are. The name is for the dashboard's warning; the
 *  addresses are secrets and never leave this module. */
export interface BusySource { id: number; name: string; addresses: string[] }

export type CalendarSourceIssue = {
  tutorId: number; tutorName: string;
  /** 1-based position among that tutor's addresses, and how many they have. */
  index: number; total: number;
  at: string; reason: string;
};

/** Last read failure per feed, keyed `${tutorId}:${position}`. Cleared the
 *  next time that same feed reads successfully, so a recovered calendar
 *  stops warning. */
const sourceIssues = new Map<string, CalendarSourceIssue>();

/** Read-failure state for the tutor dashboard («היומן השני של ליאור»),
 *  never by URL. */
export function calendarSourceIssues(): CalendarSourceIssue[] {
  return [...sourceIssues.values()].sort((a, b) => a.tutorId - b.tutorId || a.index - b.index);
}

/** A tutor's addresses were replaced: what was wrong with the old ones is moot. */
export function clearSourceIssues(tutorId: number): void {
  for (const [key, issue] of sourceIssues) if (issue.tutorId === tutorId) sourceIssues.delete(key);
}

/** One tutor's busy times from their own feeds. A feed that fails is
 *  skipped — its hours read as free, the fail-open the booking page then
 *  warns about — and recorded (see calendarSourceIssues), never silently
 *  dropped. */
export async function fetchTutorBusy(
  tutor: BusySource, timeMin: string, timeMax: string,
): Promise<{ busy: BusyInterval[]; failed: number; total: number }> {
  const urls = tutor.addresses;
  let failed = 0;
  const all = await Promise.all(urls.map(async (url, i) => {
    const key = `${tutor.id}:${i}`;
    const issue = (at: number, reason: string) => sourceIssues.set(key, {
      tutorId: tutor.id, tutorName: tutor.name, index: i + 1, total: urls.length,
      at: new Date(at).toISOString(), reason,
    });
    const recent = recentFailure.get(url);
    if (recent && Date.now() - recent.at < FAILURE_MS) {
      if (!sourceIssues.has(key)) issue(recent.at, recent.reason);
      failed++;
      return [];
    }
    try {
      const busy = busyFromIcs(await calendarText(url), timeMin, timeMax);
      recentFailure.delete(url);
      sourceIssues.delete(key);
      return busy;
    } catch (err) {
      const reason = classifyReadError(err);
      recentFailure.set(url, { at: Date.now(), reason });
      issue(Date.now(), reason);
      failed++;
      console.error(`[calendar] ${tutor.name}: יומן ${i + 1} מתוך ${urls.length} — קריאה נכשלה: ${reason}`);
      return [];
    }
  }));
  return { busy: all.flat(), failed, total: urls.length };
}

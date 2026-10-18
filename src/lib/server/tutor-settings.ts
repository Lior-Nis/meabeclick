/**
 * A tutor's booking settings (migration 029): the lesson calendar the robot
 * writes their lessons into, the private iCal addresses that say when they
 * are busy, and their teaching hours. Set from the dashboard's "מורים"
 * card; see docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md.
 *
 * busy_ics is a SECRET — each address reads a whole personal calendar. It is
 * never logged and never returned: what leaves this module is a count.
 */
import { handle } from './db.ts';
import { defaultTeacher, getTeacher, type TeacherRow } from './entities.ts';
import { DEFAULT_HOURS, parseTeachingHours, type TeachingHours } from '../teaching-hours.ts';

/** One address per line; commas and spaces split too, as CALENDAR_ICS_URLS always did. */
export function splitAddresses(raw?: string | null): string[] {
  return (raw ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
}

export const busyAddresses = (t: Pick<TeacherRow, 'busy_ics'>): string[] => splitAddresses(t.busy_ics);

/** The dashboard's address field: https addresses only — a private Google
 *  iCal address is one. null = refused, with nothing half-saved. */
export function parseBusyAddresses(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const list = splitAddresses(raw);
  const https = (u: string) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  return list.every(https) ? list : null;
}

/** The tutor's stored hours, or the default window when none are stored. */
export function teachingHours(t: Pick<TeacherRow, 'teaching_hours'>): TeachingHours {
  if (!t.teaching_hours) return DEFAULT_HOURS;
  try { return parseTeachingHours(JSON.parse(t.teaching_hours)) ?? DEFAULT_HOURS; } catch { return DEFAULT_HOURS; }
}

export type MissingSetting = 'calendar' | 'busy';

/** What stands between a tutor and their first booking; [] = ready. */
export function missingForBookings(t: TeacherRow): MissingSetting[] {
  const missing: MissingSetting[] = [];
  if (!t.calendar_id?.trim()) missing.push('calendar');
  if (!busyAddresses(t).length) missing.push('busy');
  return missing;
}

/** Offered hours and given bookings only when active, with a calendar to
 *  write into and at least one to read busy times from. The Meet room is
 *  not required: an online lesson without one names the mode with no link,
 *  as it does today. */
export const takesBookings = (t: TeacherRow): boolean => !!t.active && missingForBookings(t).length === 0;

export interface TutorSettingsPatch {
  calendarId?: string | null;
  /** Replaces every address; [] clears them. */
  busyIcs?: string[];
  /** null = back to the default window. */
  teachingHours?: TeachingHours | null;
}

/** Writes only what the patch names: an omitted key leaves its column as it was. */
export function updateTutorSettings(id: number, p: TutorSettingsPatch): TeacherRow | null {
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (p.calendarId !== undefined) { sets.push('calendar_id = ?'); params.push(p.calendarId?.trim() || null); }
  if (p.busyIcs !== undefined) { sets.push('busy_ics = ?'); params.push(p.busyIcs.length ? p.busyIcs.join('\n') : null); }
  if (p.teachingHours !== undefined) { sets.push('teaching_hours = ?'); params.push(p.teachingHours ? JSON.stringify(p.teachingHours) : null); }
  if (sets.length) handle().prepare(`UPDATE teachers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  return getTeacher(id);
}

/** What the "מורים" card shows of a tutor: the busy addresses as a count,
 *  never their text. Never setup_hash either. */
export function tutorCardView(t: TeacherRow) {
  return {
    id: t.id, name: t.name, phone: t.phone, meetUrl: t.meet_url, account: t.meet_account,
    calendarId: t.calendar_id,
    busyCount: busyAddresses(t).length,
    teachingHours: teachingHours(t),
    missing: missingForBookings(t),
  };
}

/**
 * The first boot after migration 029: the default tutor's row takes over
 * CALENDAR_ID and CALENDAR_ICS_URLS from .env, so booking carries on
 * exactly as before with nothing set by hand.
 *
 * Only when her row has neither a calendar nor a busy address yet, so it
 * happens once and never overwrites anything — after it, the two .env
 * lines can be deleted. Only that it happened is logged, never the values:
 * the iCal addresses are secrets.
 *
 * @returns whether anything was copied.
 */
export function adoptEnvCalendar(env: Record<string, string | undefined> = process.env): boolean {
  const t = defaultTeacher();
  if (!t || t.calendar_id || t.busy_ics) return false;
  const calendarId = env.CALENDAR_ID?.trim() || null;
  const busy = splitAddresses(env.CALENDAR_ICS_URLS);
  if (!calendarId && !busy.length) return false;
  updateTutorSettings(t.id, { calendarId, busyIcs: busy });
  console.log(`[boot] ${t.name} took over CALENDAR_ID and CALENDAR_ICS_URLS from .env — both lines can be deleted now`);
  return true;
}

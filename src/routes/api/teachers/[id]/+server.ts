/**
 * A tutor's booking settings, from the "מורים" card: lesson calendar,
 * private busy addresses and teaching hours (migration 029,
 * $server/tutor-settings.ts).
 *
 * The answer is the card's view of the tutor, with the addresses as a COUNT.
 * No response from this route, or any other, carries a busy_ics value.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getTeacher } from '$server/entities.ts';
import { clearSourceIssues } from '$server/calendar.ts';
import { parseBusyAddresses, tutorCardView, updateTutorSettings, type TutorSettingsPatch } from '$server/tutor-settings.ts';
import { parseTeachingHours } from '$lib/teaching-hours.ts';
import type { RequestHandler } from './$types';

/** A Google calendar id: `…@group.calendar.google.com`, or an account's address. */
const CALENDAR_ID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PATCH: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const id = Number(event.params.id);
  const teacher = Number.isInteger(id) && id > 0 ? getTeacher(id) : null;
  if (!teacher) return json({ error: 'teacher not found' }, { status: 404 });

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = (parsed ?? {}) as Record<string, unknown>;

  /* Every field is checked before anything is written, so a refused
     request leaves the tutor exactly as they were. */
  const patch: TutorSettingsPatch = {};
  if (body.calendarId !== undefined) {
    const value = body.calendarId === null ? '' : typeof body.calendarId === 'string' ? body.calendarId.trim() : null;
    if (value === null || (value && !CALENDAR_ID.test(value))) {
      return json({ error: 'מזהה יומן השיעורים לא תקין — הוא נראה כמו …@group.calendar.google.com' }, { status: 400 });
    }
    patch.calendarId = value || null;
  }
  if (body.busyIcs !== undefined) {
    const list = parseBusyAddresses(body.busyIcs);
    if (!list) return json({ error: 'כל כתובת יומן צריכה להתחיל ב-https://' }, { status: 400 });
    patch.busyIcs = list;
  }
  if (body.teachingHours !== undefined) {
    const hours = body.teachingHours === null ? null : parseTeachingHours(body.teachingHours);
    if (body.teachingHours !== null && !hours) {
      return json({ error: 'שעות ההוראה לא תקינות — לכל יום שעת התחלה לפני שעת הסיום, ראשון עד שישי' }, { status: 400 });
    }
    patch.teachingHours = hours;
  }

  const updated = updateTutorSettings(teacher.id, patch)!;
  // New addresses: warnings about the old ones no longer mean anything.
  if (patch.busyIcs !== undefined) clearSourceIssues(teacher.id);
  return json({ tutor: tutorCardView(updated) }, { headers: { 'Cache-Control': 'no-store' } });
};

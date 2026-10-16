/**
 * Online or in person: the one choice a family makes about where a lesson
 * happens (Todoist 6hmR35WgcWp7Mj2q, designed with Lior on 2026-10-16).
 *
 * In person is only ever at the office (OFFICE_ADDRESS), never at the
 * student's home, so there is no third mode to ask for. Online is the
 * lesson's teacher's own Google Meet room: one fixed link per teacher, kept
 * on the `teachers` row because this repo is public. Google refuses to
 * create a Meet for an event the site's service account writes, which is
 * why the room is fixed rather than made per event.
 *
 * Shared by the booking page and the server: the page offers exactly these
 * two, /api/book refuses anything else, and migration 027's CHECK backs it.
 */
import { OFFICE_ADDRESS, OFFICE_NAV_LINK } from './contact.ts';

export type LessonMode = 'online' | 'in_person';

export const MODE_LABEL: Record<LessonMode, string> = {
  online: 'אונליין',
  in_person: 'פנים מול פנים',
};

export const isLessonMode = (v: unknown): v is LessonMode => v === 'online' || v === 'in_person';

/** A teacher's stored room, if it is a link a family can safely open:
 *  https only, since it lands in an email's href and a calendar event. */
export function meetUrl(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^https:\/\/\S+$/.test(s) ? s : null;
}

/** Where one lesson happens, as every surface prints it. */
export interface LessonPlace {
  /** null: booked before the choice existed, or by a page that predates it. */
  mode: LessonMode | null;
  label: string;
  /** What the calendar's location field and an email's row show: the Meet
   *  room, the office address, or nothing to point at. */
  where: string | null;
  /** What to tap: the Meet room, or navigation to the office. */
  href: string | null;
}

export function lessonPlace(mode: LessonMode | null, room: string | null): LessonPlace {
  if (mode === 'in_person') {
    return { mode, label: MODE_LABEL.in_person, where: OFFICE_ADDRESS, href: OFFICE_NAV_LINK };
  }
  if (mode === 'online') {
    const url = meetUrl(room);
    return { mode, label: `${MODE_LABEL.online} (Google Meet)`, where: url, href: url };
  }
  return { mode: null, label: 'לא צוין', where: null, href: null };
}

/** One line: `אונליין (Google Meet) — https://meet…`, or the label alone. */
export const placeLine = (p: LessonPlace): string => (p.where ? `${p.label} — ${p.where}` : p.label);

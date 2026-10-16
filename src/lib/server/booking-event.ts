/**
 * The Google Calendar event a booking writes, built apart from /api/book so
 * it can be tested without a service account (a +server.ts may export only
 * its handlers).
 *
 * The mode ends the title, so the tutor's week reads at a glance, and the
 * location holds the Meet room or the office address, which Calendar turns
 * into a link to tap.
 */
import { planLabel } from '../plans.ts';
import { MODE_LABEL, placeLine, type LessonPlace } from '../lesson-mode.ts';

const TZ = 'Asia/Jerusalem';

export interface EventBooking {
  name: string;
  subject: string;
  request: string;
  level: string;
  phone: string;
  email?: string | null;
  start: string;
  end: string;
  durationMin?: number;
}

export function bookingEvent(b: EventBooking, place: LessonPlace) {
  return {
    summary: `שיעור — ${b.name} — ${b.subject}${place.mode ? ` — ${MODE_LABEL[place.mode]}` : ''}`,
    ...(place.where ? { location: place.where } : {}),
    description: [
      `👤 שם: ${b.name}`,
      `📖 מקצוע: ${b.subject}`,
      `📍 ${placeLine(place)}`,
      `❓ בקשה לשיעור: ${b.request || '—'}`,
      `🎓 כיתה/רמה: ${b.level}`,
      `📱 טלפון: ${b.phone}`,
      `✉️ מייל: ${b.email || '—'}`,
      `💳 ${planLabel(b.durationMin)}`,
    ].join('\n'),
    start: { dateTime: b.start, timeZone: TZ },
    end: { dateTime: b.end, timeZone: TZ },
    colorId: '6', // tangerine — visible at a glance
  };
}

/**
 * The calendar day an instant falls on in Israel, as 'YYYY-MM-DD'.
 *
 * `iso.slice(0, 10)` is the UTC day, which for anything after 21:00 or
 * 22:00 Israel time (depending on DST) is the day BEFORE — how the tutor's
 * dashboard came to show a held task's release date a day early.
 */
export function israelDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

/** Today in Israel, as 'YYYY-MM-DD'. The ISO string's own date is UTC's
 *  today, which after 21:00 or 22:00 here is still yesterday. */
export function israelToday(now: Date = new Date()): string {
  return israelDay(now.toISOString());
}

/** 'DD/MM/YYYY HH:MM' in Israel — for version history and the like, where
 *  the time of day matters and UTC would be two or three hours off. */
export function formatDateTime(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** 'HH:MM' in Israel. */
export function israelTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/**
 * When a lesson is, as a family and the tutor read it: the Israel date and
 * clock time of its start. Every booking made on the site is stored in UTC,
 * so slicing the ISO string printed the UTC hour — an 11:00 lesson showed
 * as 08:00 on the tutor's dashboard (pre-launch review, 2026-09-28).
 */
export function lessonWhen(iso: string): { date: string; time: string } {
  return { date: israelDay(iso), time: israelTime(iso) };
}

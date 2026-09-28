/**
 * Outbound mail: one message to the tutor, one to the family.
 *
 * ## The gap this closes
 *
 * This module used to send exactly one email, to `BOOKING_EMAIL_TO` — the
 * tutor's own mailbox — and that message carried the family's portal link
 * and their plaintext password. The family received nothing. The booking
 * form did not even collect an address to send to. So the parent invented a
 * password during booking, was never told where to use it, and `/portal`
 * greeted them with "כדי להיכנס צריך את הקישור שקיבלתם מניקול" — a link
 * nobody had sent. Every activation depended on the tutor forwarding it by
 * hand, against the project's own north star of removing manual steps from
 * her week.
 *
 * The family is now the primary recipient. The tutor still gets her copy,
 * because the booking email is her working record of the lesson, but it is
 * no longer the only copy in existence.
 *
 * Nothing here throws on a missing mailbox: `sendBookingEmail` returning
 * false is how the caller tells "sent" from "email not configured", and a
 * booking is never lost because mail was down.
 */
import nodemailer from 'nodemailer';
import { TUTOR_PHONE } from '../contact.ts';
import { planLabel } from '../plans.ts';
import { contactTutor } from '../tutors.ts';

const TZ = 'Asia/Jerusalem';

export interface BookingEmailInput {
  name: string;
  subject: string;
  level: string;
  /** The parent's optional note toward this lesson — a request, not a
   *  diagnosis of what wasn't understood. */
  request?: string | null;
  start: string;
  durationMin?: number | string;
  phone: string;
  email?: string | null;
}

export interface EnrolledForEmail {
  /** This booking created the student record. */
  created: boolean;
  /** This family had never booked before. */
  accountCreated: boolean;
  student: { code: string; name: string };
  /** Absolute magic link into the family's own portal. */
  portalLink: string;
  /** The teacher this booking's enrollment is actually assigned to, when
   *  known. Falls back to the roster's contact tutor (see
   *  `confirmationContactLine`) rather than a hardcoded name. */
  teacherName?: string | null;
}

/**
 * `ניצור איתכם קשר לאישור סופי לפני השיעור — <name>.` — the sentence used
 * to read `"ניקול תיצור קשר..."`, hardcoding both the name and a feminine
 * verb that only worked for a tutor who happens to be a woman. Phrasing it
 * as "we'll be in touch" sidesteps needing a gendered verb for a name the
 * roster can hand us for any tutor.
 */
export function confirmationContactLine(teacherName: string): string {
  return `ניצור איתכם קשר לאישור סופי לפני השיעור — ${teacherName}.`;
}

/**
 * Whether credentials exist at all — distinct from whether they work.
 *
 * A machine with no Gmail credentials is a legitimate state: every dev
 * machine, and this repo's test suite, which strips them deliberately.
 * A machine WITH credentials that Google refuses is an incident. Callers
 * that report health must not conflate the two.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

/**
 * Ask the SMTP server whether these credentials are still accepted.
 *
 * On 2026-09-20 the box's app password was being rejected with
 * `535-5.7.8 … BadCredentials` — the signature of a password revoked when
 * the account holder changes their Google password. It had worked two days
 * earlier, and nothing said it had stopped: booking mail and the portal
 * link both swallow send failures on purpose, so the only symptom was
 * families not receiving things.
 *
 * `overrides` exists so a test can point this at a dead port and exercise
 * the failure shape without reaching Google.
 */
export async function verifyEmailTransport(
  overrides: Record<string, unknown> = {},
): Promise<{ configured: boolean; ok: boolean; reason?: string }> {
  if (!emailConfigured()) return { configured: false, ok: false, reason: 'not configured' };

  const tx = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    ...overrides,
  });
  try {
    await tx.verify();
    return { configured: true, ok: true };
  } catch (err) {
    return { configured: true, ok: false, reason: (err as Error).message };
  } finally {
    tx.close();
  }
}

/**
 * Whether the mail server is currently refusing our credentials.
 *
 * True ONLY when credentials exist and are being rejected — never for a
 * machine that simply has none, which is every dev machine and this repo's
 * test suite. That distinction is the same one emailConfigured() draws and
 * exists for the same reason: failing the unconfigured case would train
 * everyone to ignore the failure that matters.
 *
 * Memoised briefly. Callers are request paths, and an SMTP round-trip per
 * request would be both slow and rude to the server; a minute is short
 * enough that a fixed credential starts working again promptly.
 */
let rejectedCheck: { at: number; value: boolean } | null = null;
const REJECTED_TTL_MS = 60_000;

export async function mailCredentialsRejected(now = Date.now()): Promise<boolean> {
  if (!emailConfigured()) return false;
  if (rejectedCheck && now - rejectedCheck.at < REJECTED_TTL_MS) return rejectedCheck.value;

  const health = await verifyEmailTransport();
  rejectedCheck = { at: now, value: health.configured && !health.ok };
  return rejectedCheck.value;
}

function transport(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn('GMAIL_USER / GMAIL_APP_PASSWORD not set — email skipped');
    return null;
  }
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
}

const whenLabel = (iso: string): string => new Intl.DateTimeFormat('he-IL', {
  timeZone: TZ,
  weekday: 'long', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

/** The shared RTL shell. Inline styles only — every mail client strips a
 *  <style> block, and this is the one place that has to be remembered. */
function shell(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right;max-width:520px">${inner}</div>`;
}

function rowsTable(rows: [string, string][]): string {
  return `<table style="border-collapse:collapse;width:100%">
    ${rows.map(([k, v]) => `
      <tr>
        <td style="padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;font-weight:700;white-space:nowrap">${k}</td>
        <td style="padding:8px 10px;border:1px solid #E2E8F0">${esc(String(v))}</td>
      </tr>`).join('')}
  </table>`;
}

/**
 * The button a parent actually taps. Rendered as a bordered block rather
 * than a bare <a>, and always followed by the URL in plain text, because
 * Gmail's clipping and some corporate filters strip styling from links and
 * leave an unclickable word behind. The visible URL is the fallback.
 */
function linkBlock(href: string, label: string): string {
  return `
    <div style="margin:18px 0">
      <a href="${esc(href)}"
         style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;
                font-weight:800;font-size:16px;padding:13px 26px;border-radius:12px">${esc(label)}</a>
    </div>
    <div style="font-size:12px;color:#64748B;line-height:1.6;word-break:break-all">
      אם הכפתור לא עובד, אפשר להעתיק את הכתובת:<br>
      <span style="color:#2563EB">${esc(href)}</span>
    </div>`;
}

/**
 * The tutor's copy — her working record of the booking.
 *
 * `inCalendar` false means she must add the lesson by hand, so the subject
 * line says so: that email is then the only record the calendar does not
 * have.
 */
export async function sendBookingEmail(
  b: BookingEmailInput,
  inCalendar: boolean,
  enrolled: EnrolledForEmail | null,
): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;

  const to = process.env.BOOKING_EMAIL_TO || 'mea.beclick@gmail.com';

  const rows: [string, string][] = [
    ['👤 שם',           b.name],
    ['📖 מקצוע',        b.subject],
    ['🎓 כיתה / רמה',   b.level],
    ['❓ בקשה לשיעור',   b.request || '—'],
    ['📅 מועד',         whenLabel(b.start)],
    ['💳 שיעור',        planLabel(b.durationMin)],
    ['📱 טלפון',        b.phone],
    ['✉️ מייל',         b.email || '—'],
  ];

  const status = enrolled
    ? (enrolled.accountCreated ? '🆕 משפחה חדשה — נשלח אליהם קישור לדף האישי'
      : enrolled.created ? '➕ תלמיד/ה נוסף/ת במשפחה קיימת'
      : '↩️ תלמיד/ה קיים/ת')
    : '';

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
    + (enrolled ? `\n\n${status}\nהדף שלהם: ${enrolled.portalLink}` : '')
    + `\n\n${inCalendar ? '✅ נוסף ליומן אוטומטית' : '⚠️ לא נוסף ליומן — יש להוסיף ידנית'}`;

  const html = shell(`
    <h2 style="color:#2563EB;margin:0 0 4px">📚 הזמנת שיעור חדשה</h2>
    <p style="color:#64748B;margin:0 0 16px">${esc(b.name)} · ${esc(b.subject)}</p>
    ${rowsTable(rows)}
    <p style="margin-top:16px;padding:10px 12px;border-radius:8px;
              background:${inCalendar ? '#ECFDF5' : '#FEF2F2'};
              color:${inCalendar ? '#047857' : '#DC2626'};font-weight:700">
      ${inCalendar ? '✅ נוסף ליומן אוטומטית' : '⚠️ לא נוסף ליומן — יש להוסיף ידנית'}
    </p>
    ${enrolled ? `
    <div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:#EFF6FF;border:1px solid #BFDBFE">
      <div style="font-weight:800;margin-bottom:6px">${esc(status)}</div>
      <div style="font-size:.95em;line-height:1.7">
        הדף שלהם: <a href="${esc(enrolled.portalLink)}" style="color:#2563EB">${esc(enrolled.student.name)}</a><br>
        <span style="color:#64748B">הקישור נשלח אליהם ישירות — לא צריך להעביר ידנית.</span>
      </div>
    </div>` : ''}
    <p style="margin-top:14px">
      <a href="tel:${esc(b.phone)}" style="color:#2563EB">📞 חיוג</a> ·
      <a href="https://wa.me/${esc(b.phone.replace(/\D/g, ''))}" style="color:#2563EB">💬 וואטסאפ</a>
    </p>`);

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: `📚 שיעור חדש — ${b.name} — ${b.subject}${inCalendar ? '' : ' (להוסיף ליומן!)'}`,
    text,
    html,
  });
  return true;
}

/**
 * The family's copy: the confirmation, and the link that opens their portal.
 *
 * This is the message that makes the portal reachable at all, so it leads
 * with the link rather than burying it under the booking details — a parent
 * who reads only the first screenful still ends up inside the product.
 */
export async function sendFamilyBookingEmail(
  b: BookingEmailInput,
  enrolled: EnrolledForEmail,
): Promise<boolean> {
  if (!b.email) return false;
  const tx = transport();
  if (!tx) return false;

  const rows: [string, string][] = [
    ['👤 תלמיד/ה',   enrolled.student.name],
    ['📅 מועד',      whenLabel(b.start)],
    ['💳 שיעור',     planLabel(b.durationMin)],
    ['📖 מקצוע',     b.subject],
  ];

  const greeting = enrolled.accountCreated
    ? 'יצרנו לכם דף אישי'
    : 'השיעור נקבע';

  const teacherName = enrolled.teacherName || contactTutor().name;
  const contactLine = confirmationContactLine(teacherName);

  const text = [
    `${greeting}!`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'הדף האישי — שיעורים, שיעורי בית ומצגות:',
    enrolled.portalLink,
    '',
    'שמרו את הקישור. הוא נשאר תקף, ואפשר תמיד לבקש חדש מדף הכניסה.',
    contactLine,
  ].join('\n');

  const html = shell(`
    <h2 style="color:#2563EB;margin:0 0 4px">✅ ${esc(greeting)}</h2>
    <p style="color:#64748B;margin:0 0 16px">מאה בקליק · שיעורים פרטיים</p>
    ${rowsTable(rows)}
    <div style="margin-top:20px;padding:16px 18px;border-radius:14px;background:#EFF6FF;border:1px solid #BFDBFE">
      <div style="font-weight:800;font-size:17px;margin-bottom:4px">הדף האישי של ${esc(enrolled.student.name)}</div>
      <div style="color:#334155;font-size:14px;line-height:1.7">
        כאן יופיעו סיכומי השיעורים, שיעורי הבית והמצגות.
      </div>
      ${linkBlock(enrolled.portalLink, '📚 פתיחת הדף האישי')}
    </div>
    <p style="margin-top:18px;font-size:14px;color:#334155;line-height:1.8">
      שמרו את הקישור הזה. אם יתיישן, אפשר לבקש חדש בכל רגע מדף הכניסה —
      בלי סיסמאות ובלי לחכות לתשובה.
    </p>
    <p style="margin-top:10px;font-size:14px;color:#64748B">
      ${esc(contactLine)}
    </p>`);

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to: b.email,
    subject: `✅ השיעור של ${enrolled.student.name} נקבע — מאה בקליק`,
    text,
    html,
  });
  return true;
}

/**
 * A fresh link, on request, with no password and no tutor in the loop.
 *
 * This is what makes the two-week link expiry affordable: losing a link is
 * now a self-service problem. The caller must send the same answer whether
 * or not the address matched an account (see /api/request-link), so this
 * never reports "no such family" — it simply is not called in that case.
 */
/**
 * The nudge after a lesson: one message, to the tutor's own mailbox, with a
 * link into that lesson's report form.
 *
 * It names the skills the plan recommends, so the message is useful even
 * unopened — she can see where the student is without tapping anything.
 */
export async function sendReportPromptEmail(
  lesson: { bookingId: number; studentName: string; subject: string | null; start: string },
  recommended: string[],
): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;

  const to = process.env.BOOKING_EMAIL_TO || 'mea.beclick@gmail.com';
  const site = process.env.SITE_URL ?? '';
  const href = `${site}/app/report/${lesson.bookingId}`;

  const hint = recommended.length
    ? `<p style="margin:12px 0 0">מומלץ לתרגול עכשיו: ${esc(recommended.slice(0, 2).join(', '))}</p>`
    : '';

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: `שיעור עם ${lesson.studentName} הסתיים — דיווח קצר?`,
    html: shell(`
      <h2 style="margin:0 0 6px">דיווח שיעור</h2>
      <p style="margin:0">${esc(lesson.studentName)}${lesson.subject ? ` · ${esc(lesson.subject)}` : ''} · ${esc(whenLabel(lesson.start))}</p>
      ${hint}
      ${linkBlock(href, 'לדיווח השיעור')}
      <p style="font-size:12px;color:#64748B">אם כבר דיווחת, אפשר להתעלם מההודעה.</p>
    `),
  });
  return true;
}

/**
 * The weekly "update your calendar" nudge, when WhatsApp cannot carry it.
 *
 * /api/remind prefers CallMeBot, because a WhatsApp message on a Saturday
 * evening is read and an email may not be. But the CallMeBot key can only
 * be obtained from Nicole's own phone, and until it exists the reminder
 * would not go at all. This box already mails her every hour through the
 * same transport, so email is the fallback that makes the feature work
 * today rather than whenever the key arrives.
 *
 * Returns false when email is not configured either — the caller turns
 * that into the 503 that keeps a send-nothing run from reporting success.
 */
export async function sendCalendarReminderEmail(message: string): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;

  const to = process.env.BOOKING_EMAIL_TO || 'mea.beclick@gmail.com';
  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: 'תזכורת: עדכון לוח השנה לפני פתיחת ההזמנות',
    html: shell(`
      <h2 style="margin:0 0 6px">תזכורת שבועית</h2>
      <p style="margin:0">${esc(message)}</p>
    `),
  });
  return true;
}

export async function sendPortalLinkEmail(
  to: string,
  familyName: string,
  portalLink: string,
): Promise<boolean> {
  const tx = transport();
  if (!tx) return false;

  const text = [
    'הנה קישור חדש לדף האישי שלכם:',
    portalLink,
    '',
    'הקישור תקף לשבועיים. אם לא ביקשתם אותו, אפשר להתעלם מהמייל הזה.',
  ].join('\n');

  const html = shell(`
    <h2 style="color:#2563EB;margin:0 0 4px">🔑 הקישור שלכם</h2>
    <p style="color:#64748B;margin:0 0 16px">${esc(familyName)} · מאה בקליק</p>
    ${linkBlock(portalLink, '📚 כניסה לדף האישי')}
    <p style="margin-top:20px;font-size:14px;color:#64748B;line-height:1.8">
      הקישור תקף לשבועיים. אם לא ביקשתם אותו — אפשר להתעלם מהמייל הזה,
      ולא נעשה שום שינוי בחשבון.
    </p>`);

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: '🔑 קישור לדף האישי — מאה בקליק',
    text,
    html,
  });
  return true;
}

/**
 * The reminder a family gets before a lesson.
 *
 * Todoist id:6hM24r5hGPvwJQmq. Email because it is the only channel that
 * reaches a family: CallMeBot's key can only be obtained by messaging from
 * the recipient's own phone, so it addresses the tutor and nobody else.
 *
 * Deliberately thin on content. «תוכן שאינו חושף מידע מיותר» — a reminder
 * carries the lesson, not the balance, not the tutor's notes, not the
 * child's progress. It goes to an inbox that may be read on a shared
 * screen, and none of that is needed to get someone to a lesson on time.
 *
 * The way out is a WhatsApp link rather than a "reply to this email":
 * nobody watches that mailbox, and telling a parent to reply to a robot is
 * how a cancellation goes unnoticed until the tutor is sitting there.
 */
export async function sendLessonReminderEmail(r: {
  to: string;
  studentName: string;
  start: string;
  subject: string | null;
  durationMin: number | null;
  tutorPhone?: string;
}): Promise<boolean> {
  if (!r.to) return false;
  const tx = transport();
  if (!tx) return false;

  const phone = (r.tutorPhone || TUTOR_PHONE).replace(/\D/g, '');
  const rows: [string, string][] = [
    ['👤 תלמיד/ה', r.studentName],
    ['📅 מועד', whenLabel(r.start)],
    ...(r.subject ? [['📖 מקצוע', r.subject] as [string, string]] : []),
    ...(r.durationMin ? [['⏱️ אורך', `${r.durationMin} דקות`] as [string, string]] : []),
  ];

  const text = [
    'תזכורת לשיעור הקרוב',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'צריך לשנות או לבטל? אפשר להודיע בוואטסאפ:',
    `https://wa.me/${phone}`,
  ].join('\n');

  const html = shell(`
    <h2 style="color:#2563EB;margin:0 0 4px">⏰ תזכורת לשיעור הקרוב</h2>
    <p style="color:#64748B;margin:0 0 16px">מאה בקליק · שיעורים פרטיים</p>
    ${rowsTable(rows)}
    <p style="margin-top:20px;color:#64748B">
      צריך לשנות או לבטל?
      <a href="https://wa.me/${esc(phone)}" style="color:#2563EB">💬 הודיעו בוואטסאפ</a>
    </p>`);

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to: r.to,
    subject: `⏰ תזכורת: שיעור של ${r.studentName} — ${whenLabel(r.start)}`,
    text,
    html,
  });
  return true;
}

/**
 * After the tutor reports a lesson: its homework, and the way to the page.
 *
 * Deliberately NOT the report note — that is written for the tutor and may
 * say things meant for her alone. Families see the tasks, which are already
 * on their page, and a link to it.
 */
export async function sendLessonReportedEmail(r: {
  to: string;
  studentName: string;
  lessonStart: string;
  tasks: string[];
  link: string;
}): Promise<boolean> {
  if (!r.to) return false;
  const tx = transport();
  if (!tx) return false;

  const when = whenLabel(r.lessonStart);
  const list = r.tasks.length
    ? `<ul style="margin:8px 0 0;padding-inline-start:20px">${r.tasks.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
    : '<p style="margin:8px 0 0">הפעם אין שיעורי בית חדשים.</p>';

  const text = [
    `השיעור של ${r.studentName} (${when}) סוכם.`,
    '',
    ...(r.tasks.length ? ['שיעורי הבית:', ...r.tasks.map(t => `• ${t}`)] : ['הפעם אין שיעורי בית חדשים.']),
    '',
    'הכל מחכה בדף האישי:',
    r.link,
  ].join('\n');

  const html = shell(`
    <h2 style="color:#2563EB;margin:0 0 4px">📚 השיעור של ${esc(r.studentName)} סוכם</h2>
    <p style="color:#64748B;margin:0 0 16px">${esc(when)} · מאה בקליק</p>
    <p style="margin:0;font-weight:700">שיעורי הבית:</p>
    ${list}
    <p style="margin-top:20px">
      <a href="${esc(r.link)}" style="background:#2563EB;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none">לדף האישי</a>
    </p>`);

  await tx.sendMail({
    from: process.env.GMAIL_USER,
    to: r.to,
    subject: `📚 השיעור של ${r.studentName} סוכם — שיעורי הבית מחכים`,
    text,
    html,
  });
  return true;
}

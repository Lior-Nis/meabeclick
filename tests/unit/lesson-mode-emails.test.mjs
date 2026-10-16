/**
 * Where the lesson is, in every email that gets a family to it: the
 * booking confirmation, the reminder, and the tutor's copy (Todoist
 * 6hmR35WgcWp7Mj2q). nodemailer is stubbed the same way as
 * family-booking-email-tutor.test.mjs, so this runs the real email.ts.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

globalThis.__sentMail = [];

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === 'nodemailer') {
        return { url: 'data:text/javascript,' + encodeURIComponent(\`
          export default {
            createTransport() {
              return {
                sendMail(msg) {
                  globalThis.__sentMail.push(msg);
                  return Promise.resolve({ messageId: 'test' });
                },
              };
            },
          };
        \`), shortCircuit: true, format: 'module' };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

process.env.GMAIL_USER = 'tutor@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-password';

const { sendFamilyBookingEmail, sendBookingEmail, sendLessonReminderEmail } = await import('../../src/lib/server/email.ts');
const { lessonPlace } = await import('../../src/lib/lesson-mode.ts');
const { OFFICE_ADDRESS, OFFICE_NAV_LINK } = await import('../../src/lib/contact.ts');

const ROOM = 'https://meet.google.com/abc-defg-hij';
const booking = {
  name: 'דנה', subject: 'מתמטיקה', level: 'כיתה י', start: '2026-10-01T10:00:00.000Z',
  durationMin: 90, phone: '0501234567', email: 'parent@example.com',
};
const enrolled = {
  created: true, accountCreated: true, student: { code: 'dana', name: 'דנה' },
  portalLink: 'https://example.com/enter?t=x', teacherName: 'ניקול',
};
const last = () => globalThis.__sentMail.at(-1);

beforeEach(() => { globalThis.__sentMail.length = 0; });

test('online: the family gets the Meet room, as a button and as plain text', async () => {
  await sendFamilyBookingEmail({ ...booking, place: lessonPlace('online', ROOM) }, enrolled);
  const m = last();
  assert.ok(m.text.includes(ROOM));
  assert.ok(m.html.includes(`href="${ROOM}"`));
  assert.ok(m.text.includes('אונליין (Google Meet)'));
});

test('online with no room set: the family is told it will come before the lesson', async () => {
  await sendFamilyBookingEmail({ ...booking, place: lessonPlace('online', null) }, enrolled);
  assert.ok(last().text.includes('את הקישור לשיעור ב-Google Meet נשלח לפני השיעור'));
  assert.ok(!last().text.includes('meet.google.com'));
});

test('in person: the family gets the office address and a way to navigate there', async () => {
  await sendFamilyBookingEmail({ ...booking, place: lessonPlace('in_person', ROOM) }, enrolled);
  const m = last();
  assert.ok(m.text.includes(OFFICE_ADDRESS));
  assert.ok(m.html.includes(OFFICE_NAV_LINK.replace(/&/g, '&amp;')));
  assert.ok(!m.text.includes(ROOM), 'an in-person lesson has no room');
});

test('a booking with no mode says nothing about a place', async () => {
  await sendFamilyBookingEmail(booking, enrolled);
  assert.ok(!last().text.includes('📍'));
});

test("the tutor's copy says where, and warns when the room is missing", async () => {
  await sendBookingEmail({ ...booking, place: lessonPlace('online', ROOM), tutorName: 'ניקול' }, true, null);
  assert.ok(last().text.includes(`📍 איפה: אונליין (Google Meet) — ${ROOM}`));
  assert.ok(last().subject.includes('אונליין'));
  assert.ok(!last().text.includes('אין קישור Meet'));

  await sendBookingEmail({ ...booking, place: lessonPlace('online', null), tutorName: 'ניקול' }, true, null);
  assert.ok(last().text.includes('⚠️ אין קישור Meet של ניקול באתר — צריך לשלוח למשפחה קישור לפני השיעור'));

  await sendBookingEmail({ ...booking, place: lessonPlace(null, null) }, true, null);
  assert.ok(last().text.includes('📍 איפה: לא צוין'));
});

test('the reminder carries the room or the address', async () => {
  const r = { to: 'parent@example.com', studentName: 'דנה', start: booking.start, subject: 'מתמטיקה', durationMin: 45 };
  await sendLessonReminderEmail({ ...r, place: lessonPlace('online', ROOM) });
  assert.ok(last().text.includes(ROOM));
  await sendLessonReminderEmail({ ...r, place: lessonPlace('in_person', null) });
  assert.ok(last().text.includes(OFFICE_ADDRESS));
  await sendLessonReminderEmail(r);
  assert.ok(!last().text.includes('📍'));
});

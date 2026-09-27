/**
 * The family's booking confirmation names the tutor actually assigned to
 * the booking, and falls back to the roster's contact tutor when no
 * specific teacher is known — see PRODUCT.md's "ready for a third tutor"
 * pillar and src/lib/tutors.ts. This used to hardcode "ניקול תיצור קשר
 * לאישור סופי לפני השיעור." regardless of who taught the lesson, and with
 * a gendered verb that only worked for a tutor who happens to be a woman.
 *
 * nodemailer is stubbed via a loader hook (same pattern as
 * request-link-mail-down.test.mjs) so this exercises the REAL email.ts
 * logic — just not a real SMTP connection.
 */
import { test } from 'node:test';
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

const { sendFamilyBookingEmail } = await import('../../src/lib/server/email.ts');
const { contactTutor } = await import('../../src/lib/tutors.ts');

const booking = {
  name: 'דנה',
  subject: 'מתמטיקה',
  level: 'כיתה י',
  start: '2026-10-01T10:00:00.000Z',
  durationMin: 90,
  phone: '0501234567',
  email: 'parent@example.com',
};

const enrolledBase = {
  created: true,
  accountCreated: true,
  student: { code: 'dana1', name: 'דנה' },
  portalLink: 'https://example.com/portal?s=dana1',
};

test('the confirmation email names the teacher actually assigned to the booking', async () => {
  globalThis.__sentMail.length = 0;
  const ok = await sendFamilyBookingEmail(booking, { ...enrolledBase, teacherName: 'ליאור' });
  assert.equal(ok, true);
  assert.equal(globalThis.__sentMail.length, 1);
  const [msg] = globalThis.__sentMail;
  assert.match(msg.text, /ליאור/, 'the assigned teacher is named in the plain-text body');
  assert.match(msg.html, /ליאור/, 'the assigned teacher is named in the html body');
  assert.doesNotMatch(msg.text, /ניקול תיצור קשר/, 'the old hardcoded feminine sentence is gone');
});

test('with no assigned teacher known, the email falls back to the roster contact tutor', async () => {
  globalThis.__sentMail.length = 0;
  const ok = await sendFamilyBookingEmail(booking, { ...enrolledBase, teacherName: undefined });
  assert.equal(ok, true);
  const [msg] = globalThis.__sentMail;
  assert.match(msg.text, new RegExp(contactTutor().name), 'falls back to the contact tutor\'s name');
});

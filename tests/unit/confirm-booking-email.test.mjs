/**
 * The email that asks a known family to confirm a booking made with their
 * address (pending-bookings.ts). nodemailer is stubbed as in
 * family-booking-email-tutor.test.mjs.
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
          export default { createTransport() { return { sendMail(msg) { globalThis.__sentMail.push(msg); return Promise.resolve({}); } }; } };
        \`), shortCircuit: true, format: 'module' };
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);
process.env.GMAIL_USER = 'tutor@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-password';
const { sendConfirmBookingEmail } = await import('../../src/lib/server/email.ts');

test('it names the booking, links the confirmation, and says what to do if it was not them', async () => {
  const link = 'https://example.com/confirm-booking?t=p.1.2.sig';
  await sendConfirmBookingEmail({ to: 'cohen@example.com', studentName: 'זר', subject: 'מתמטיקה', lessonStart: '2026-10-01T10:00:00.000Z', link });
  const [msg] = globalThis.__sentMail;
  assert.equal(msg.to, 'cohen@example.com');
  assert.match(msg.subject, /לאשר את השיעור של זר/);
  for (const part of [msg.text, msg.html]) {
    assert.ok(part.includes(link), 'the link');
    assert.match(part, /זר/);
    assert.match(part, /לא הזמנתם\? אין צורך לעשות דבר/);
  }
});

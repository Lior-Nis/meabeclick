// Found in the pre-launch review, 2026-09-28, and confirmed in a browser:
// booking with an existing family's email returned THAT family's sign-in
// link in the response — valid for a year — so anyone who knew a parent's
// email could open their portal: children, lessons, balance. The session
// cookie was already withheld; the link in the body was not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({
    name: 'נועה כהן', subject: 'מתמטיקה', level: 'כיתה ח',
    phone: '0501234567', email: 'family@example.com', durationMin: 90,
    start: '2027-04-05T10:00:00+03:00', end: '2027-04-05T11:30:00+03:00', ...over,
  }),
}).then(r => r.json());

test('a stranger who books with a known family email gets no way into that family', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    assert.ok(first.portal?.link, 'the family that was just created does get its link');

    const stranger = await book(baseUrl, {
      name: 'מישהו אחר', phone: '0529999999', durationMin: 45,
      start: '2027-04-06T10:00:00+03:00', end: '2027-04-06T10:45:00+03:00',
    });
    assert.equal(stranger.portal ?? null, null, 'no link and no child code in the response');
    assert.equal(stranger.linkEmailed, true, 'the page can say the link went to the email on file');
    assert.doesNotMatch(JSON.stringify(stranger), /enter\?t=/);
  } finally { await stop(); }
});

test('the same family, signed in, still gets its own child handed over', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    const cookie = await familySession(first.portal.link);
    const again = await book(baseUrl, {
      start: '2027-04-07T10:00:00+03:00', end: '2027-04-07T11:30:00+03:00',
    }, { Cookie: cookie });
    assert.equal(again.portal?.code, first.portal.code);
  } finally { await stop(); }
});

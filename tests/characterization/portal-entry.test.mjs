// The portal entry page has two doors, and each must say who it is for.
//
// A parent or an adult learner gets in by email link; a child gets in
// with the one-time code their parent prepared. The old tabs read
// "הורה / תלמיד בוגר" and "יש לי קוד", and the second one never said it
// was the CHILD's way in — so a parent holding a code, or a child holding
// nothing, could pick the wrong door. This pins the server-rendered copy
// so both doors stay labelled; the code pane itself renders client-side
// and is covered by a browser check, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

test('the portal entry page names both doors and who each is for', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/portal`)).text();

    // Door one: parents and adult learners, by email.
    assert.match(html, /הורים ותלמידים בוגרים/, 'the email door must name parents and adult learners');
    assert.match(html, /כניסה דרך המייל/, 'the email door must say it works by email');
    assert.match(html, /המייל שאיתו הזמנתם/, 'the email field keeps its label');

    // Door two: students, by code.
    assert.match(html, /<button[^>]*role="tab"[^>]*>[\s\S]*?תלמידים[\s\S]*?כניסה עם קוד[\s\S]*?<\/button>/,
      'the code door must be a tab that says it is for students and works with a code');

    // The old ambiguous labels are gone, not merely joined by new ones.
    assert.doesNotMatch(html, /יש לי קוד/, 'the old "I have a code" label no longer appears');
    assert.doesNotMatch(html, /הורה \/ תלמיד בוגר/, 'the old slash label no longer appears');
  } finally {
    await stop();
  }
});

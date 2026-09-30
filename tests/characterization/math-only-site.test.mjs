// tests/characterization/math-only-site.test.mjs
//
// מאה בקליק teaches maths only (Todoist 6hfrX4VFc3HWGF2q). The rendered home
// page — text, SEO tags, tutor bios, header — says so, and names no other
// subject anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

/* A subject as a word of its own: "בעברית" (in Hebrew) is not a subject. */
const OTHER_SUBJECT = /(^|[\s>"'(,·])(פיזיקה|אנגלית|עברית|תכנות|כימיה|ביולוגיה|מדעים)(?=[\s<"',.·)?!]|$)/;
const AREAS = ['יסודות וחיזוק פערים', 'הכנה למבחנים', 'אלגברה', 'גיאומטריה', 'פונקציות', 'הסתברות', 'הכנה לבגרות'];

test('the home page is about maths lessons, and only maths', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const hit = html.match(OTHER_SUBJECT);
    assert.equal(hit, null, `another subject on the home page: ${hit?.[2]}`);

    assert.match(html, /<title>מאה בקליק — שיעורים פרטיים במתמטיקה<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]*שיעורים פרטיים במתמטיקה[^"]*"/);
    assert.match(html, /class="hero-badge[^"]*">[^<]*מתמטיקה/, 'clear from the first screen');

    assert.match(html, /באילו תחומים במתמטיקה אנחנו עוזרים\?/);
    for (const a of AREAS) assert.ok(html.includes(a), `area: ${a}`);
    assert.doesNotMatch(html, /במה אנחנו מלמדים/);
    assert.doesNotMatch(html, /באילו מקצועות/);
    assert.doesNotMatch(html, />\s*(<[^>]+>\s*)*מקצועות\s*</, 'the header no longer says «מקצועות»');
  } finally { await stop(); }
});

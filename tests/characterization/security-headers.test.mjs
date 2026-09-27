// Every response the app serves carries a Content-Security-Policy and a
// Permissions-Policy, and they are the RIGHT ones for the document.
//
// The site handles children's names, phone numbers and a family's balance,
// so the browser must not be able to run a script from anywhere but this
// origin, must not be framed by another site, and must not be asked for
// the camera, microphone or location. Caddy adds HSTS, nosniff and the
// frame option in production; those are not testable here (the harness
// runs the Node build directly), which is exactly why CSP and
// Permissions-Policy live in the app and not the proxy.
//
// Two documents are exceptions on purpose: a generated lesson deck and a
// draft are stand-alone HTML files with their own inline script, so their
// endpoints send a policy that allows inline for THAT document only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, login } from './harness.mjs';

/** Parse "a b c; d e" into { a: ['b','c'], d: ['e'] }. */
function directives(header) {
  const out = {};
  for (const part of header.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name] = values;
  }
  return out;
}

const DECK = '<!doctype html><html lang="he"><body><h1>שיעור</h1><script>document.title="deck"</script></body></html>';

test('an app page carries an enforcing CSP with a per-request script nonce', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'the home page must send Content-Security-Policy');
    assert.equal(res.headers.get('content-security-policy-report-only'), null, 'enforcing only — no report-only twin');

    const d = directives(csp);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.ok(d['script-src'].includes("'self'"), 'scripts from this origin');
    assert.ok(d['script-src'].some(v => /^'nonce-[A-Za-z0-9+/=_-]+'$/.test(v)), `script-src must carry a nonce, got: ${d['script-src']}`);
    assert.ok(!d['script-src'].includes("'unsafe-inline'"), 'no unsafe-inline scripts anywhere');
    assert.ok(!csp.includes("'unsafe-eval'"), 'no unsafe-eval');
    assert.deepEqual(d['style-src-elem'], ["'self'", 'https://fonts.googleapis.com'], 'stylesheets: self + Google Fonts');
    assert.deepEqual(d['style-src-attr'], ["'unsafe-inline'"], 'style attributes are the one documented exception');
    assert.deepEqual(d['font-src'], ["'self'", 'https://fonts.gstatic.com']);
    assert.deepEqual(d['img-src'], ["'self'"]);
    assert.deepEqual(d['connect-src'], ["'self'"]);
    assert.deepEqual(d['frame-ancestors'], ["'self'"], 'matches Caddy\'s X-Frame-Options SAMEORIGIN');
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'self'"]);
    assert.deepEqual(d['form-action'], ["'self'"]);

    // The nonce is per request, or it is not a nonce.
    const again = await fetch(`${baseUrl}/`);
    const nonce = h => h.match(/'nonce-([^']+)'/)?.[1];
    assert.notEqual(nonce(csp), nonce(again.headers.get('content-security-policy')), 'two requests must get two nonces');
  } finally {
    await stop();
  }
});

test('the nonce in the header is the nonce on the inline script', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/`);
    const nonce = res.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
    const html = await res.text();
    const inline = html.match(/<script([^>]*)>(?![^<]*src=)/g) ?? [];
    assert.ok(inline.length >= 1, 'SvelteKit emits at least one inline script');
    for (const tag of inline) {
      assert.ok(tag.includes(`nonce="${nonce}"`), `inline script must carry the header's nonce: ${tag}`);
    }
  } finally {
    await stop();
  }
});

test('the tutor dashboard and an API response carry the same policies', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const page = await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-security-policy')?.includes("'nonce-"), 'dashboard page has a nonced CSP');
    assert.ok(page.headers.get('permissions-policy'), 'dashboard has Permissions-Policy');

    const api = await fetch(`${baseUrl}/api/me`);
    assert.ok(api.headers.get('permissions-policy'), 'API responses carry Permissions-Policy too');
  } finally {
    await stop();
  }
});

test('Permissions-Policy denies the capabilities the site never uses', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/`);
    const pp = res.headers.get('permissions-policy');
    assert.ok(pp, 'Permissions-Policy header present');
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'interest-cohort']) {
      assert.match(pp, new RegExp(`(^|,\\s*)${feature}=\\(\\)`), `${feature} must be denied: ${pp}`);
    }
  } finally {
    await stop();
  }
});

test('a generated lesson deck gets its own inline-allowing policy, still same-origin only', async () => {
  const { baseUrl, dataDir, stop } = await startServer();
  try {
    await mkdir(join(dataDir, 'lessons', 'test-deck'), { recursive: true });
    await writeFile(join(dataDir, 'lessons', 'test-deck', 'slides.html'), DECK);

    const res = await fetch(`${baseUrl}/lessons/test-deck`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'deck must send a CSP');
    assert.equal(res.headers.get('content-security-policy-report-only'), null);
    const d = directives(csp);
    assert.deepEqual(d['default-src'], ["'self'"]);
    assert.ok(d['script-src'].includes("'unsafe-inline'"), 'the deck\'s own inline script must run');
    assert.ok(!d['script-src'].some(v => v.startsWith('http')), 'but no remote scripts');
    assert.deepEqual(d['frame-ancestors'], ["'self'"]);
    assert.deepEqual(d['object-src'], ["'none'"]);
    assert.ok(res.headers.get('permissions-policy'), 'deck carries Permissions-Policy');
  } finally {
    await stop();
  }
});

test('a draft deck gets the same document policy as a published one', async () => {
  const { baseUrl, dataDir, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await mkdir(join(dataDir, 'drafts', 'test-draft'), { recursive: true });
    await writeFile(join(dataDir, 'drafts', 'test-draft', 'slides.html'), DECK);

    const res = await fetch(`${baseUrl}/drafts/test-draft/slides.html`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const d = directives(res.headers.get('content-security-policy') ?? '');
    assert.ok(d['script-src']?.includes("'unsafe-inline'"), 'draft deck allows its own inline script');
    assert.deepEqual(d['frame-ancestors'], ["'self'"]);
  } finally {
    await stop();
  }
});

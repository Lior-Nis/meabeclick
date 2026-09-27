// tests/characterization/site-verification.test.mjs
//
// Google Search Console proves domain ownership by fetching a file from the
// site root. That file is the ONLY reason the Google Auth Platform accepts
// meabeclick.com as the app domain for the Drive backup client — and the
// domain is registered through a different person's registrar account, so
// this is also what avoids needing DNS access to prove it.
//
// It is one 53-byte file with no imports, which is exactly the kind of thing
// a later tidy-up deletes as "stray". If it goes, Search Console silently
// un-verifies the property at its next check, the OAuth app's branding stops
// being accepted, and the failure surfaces somewhere else entirely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './harness.mjs';

const staticDir = join(dirname(fileURLToPath(import.meta.url)), '../../static');

test('the Search Console verification file is served from the site root', async () => {
  const files = readdirSync(staticDir).filter(f => /^google[0-9a-f]+\.html$/.test(f));
  assert.ok(files.length > 0, 'no google<hash>.html in static/ — domain verification will lapse');

  const { baseUrl, stop } = await startServer();
  try {
    for (const name of files) {
      const res = await fetch(`${baseUrl}/${name}`);
      assert.equal(res.status, 200, `${name} must be reachable at the site root`);
      // Google matches this line exactly; a stray edit breaks verification
      // without changing anything a person would notice.
      assert.equal((await res.text()).trim(), `google-site-verification: ${name}`);
    }
  } finally { await stop(); }
});

import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: { $server: 'src/lib/server' },

    // Content-Security-Policy for every page SvelteKit renders. It has to
    // live here rather than in Caddy because each page carries exactly one
    // inline script — SvelteKit's own hydration bootstrap — and only
    // SvelteKit can stamp that script with the per-request nonce that lets
    // `script-src` stay 'self' with no 'unsafe-inline'. Endpoint responses
    // (+server.ts) are not covered by this; the two that serve stand-alone
    // HTML documents set their own policy — see src/lib/server/document-policy.ts.
    //
    // Origin inventory (tests/characterization/security-headers.test.mjs
    // pins it): the browser loads the Heebo stylesheet from
    // fonts.googleapis.com and its font files from fonts.gstatic.com.
    // Nothing else is remote — no analytics, no images, no iframes, no
    // cross-origin fetches. WhatsApp links are navigations, not loads.
    //
    // 'unsafe-inline' for STYLE ATTRIBUTES only (style-src-attr): the
    // server renders ~60 `style="..."` attributes across the pages (the
    // dashboard alone has 37). Stylesheets (style-src-elem) stay strict.
    // Removing this exception means migrating those attributes to classes;
    // until then it is the single documented gap.
    //
    // Permissions-Policy lives in src/hooks.server.ts (it is a plain
    // header, no nonce), and Caddy keeps HSTS, nosniff, X-Frame-Options and
    // Referrer-Policy. frame-ancestors 'self' here agrees with Caddy's
    // X-Frame-Options SAMEORIGIN.
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src-elem': ['self', 'https://fonts.googleapis.com'],
        'style-src-attr': ['unsafe-inline'],
        'font-src': ['self', 'https://fonts.gstatic.com'],
        'img-src': ['self'],
        'connect-src': ['self'],
        'frame-ancestors': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
      },
    },
  },
};

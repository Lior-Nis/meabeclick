/**
 * Security headers for the stand-alone HTML documents the app serves from
 * endpoints: a generated lesson deck (/lessons/<slug>) and its draft
 * (/drafts/<slug>/slides.html).
 *
 * SvelteKit's own CSP (svelte.config.js) only covers pages it renders. A
 * deck is a complete HTML file written by the lesson engine, served as
 * bytes, with the navigation script inlined by the template in
 * src/lib/server/lesson/prep.ts. So it needs its own policy, and that
 * policy has to allow inline script and style for THAT document — the one
 * place 'unsafe-inline' for scripts appears anywhere in the app. The way
 * out is to hash the fixed template script and drop the inline allowance;
 * that is a follow-up, not a reason to ship the deck with no policy at all.
 *
 * Everything else stays as tight as the pages: same-origin only, no
 * remote scripts, no plugins, no framing by other sites.
 */
export const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Permissions-Policy for every response — set in src/hooks.server.ts.
 * The site never asks for any of these; denying them means a script that
 * somehow ran here still could not.
 */
export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'interest-cohort=()',
].join(', ');

/** Headers for a stand-alone HTML document response. */
export function documentHeaders(contentType = 'text/html; charset=utf-8'): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': DOCUMENT_CSP,
  };
}

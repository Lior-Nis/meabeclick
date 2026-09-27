/**
 * Validates and normalizes a ?next= redirect target to ensure it stays on this origin.
 *
 * A `next` value arrives in a URL sent to the tutor by email. If honoured as-is,
 * a link to the login page could become a one-hop phishing vector: the email links
 * to a login page on the real site, which bounces her to an attacker's domain
 * after she types her password.
 *
 * Only same-origin paths are honoured. The URL parser resolves the value the way
 * the browser will, then we check the result is still this origin. This catches
 * all variants: absolute URLs, protocol-relative, backslash escapes, javascript:,
 * and other character-level bypasses that a prefix check would miss.
 */
export function safeNext(raw: string | null, origin: string): string {
  if (!raw || !raw.startsWith('/')) return '/app/dashboard';
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return '/app/dashboard';
    return url.pathname + url.search;
  } catch {
    // Invalid URL
    return '/app/dashboard';
  }
}

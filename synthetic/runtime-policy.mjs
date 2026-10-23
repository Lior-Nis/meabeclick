/**
 * Return null only for the exact URL shape the synthetic gateway publishes.
 * @param {string | undefined} origin
 * @param {string | undefined} siteUrl
 */
export function loopbackUrlIssue(origin, siteUrl) {
  if (typeof origin !== 'string' || origin !== siteUrl) return 'ORIGIN and SITE_URL must match exactly';

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return 'ORIGIN and SITE_URL must be valid URLs';
  }

  if (parsed.protocol !== 'http:') return 'protocol must be http:';
  if (parsed.hostname !== '127.0.0.1') return 'hostname must be exactly 127.0.0.1';
  if (parsed.username || parsed.password) return 'credentials are forbidden';
  if (!/^\d+$/.test(parsed.port)) return 'an explicit numeric port is required';
  const port = Number(parsed.port);
  if (port < 1024 || port > 65535) return 'port must be from 1024 through 65535';
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) return 'path must be root with no query or hash';
  if (origin !== parsed.origin && origin !== `${parsed.origin}/`) {
    return 'URL spelling must use the exact canonical loopback origin';
  }
  return null;
}

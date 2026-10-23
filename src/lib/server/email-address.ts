import { domainToASCII } from 'node:url';

/** RFC 5321's practical maximum for a mailbox path. Keeping this hard bound
 * before any parser sees user input also caps address-parser CPU and memory. */
export const MAX_EMAIL_LENGTH = 254;

const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const LOCAL_METACHARACTERS = new Set(['(', ')', '<', '>', ',', ';', ':', '"', '\\', '[', ']']);

/** Emails identify accounts, so all lookup and storage uses one canonical form. */
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Accept one ordinary mailbox and nothing Nodemailer could reinterpret as a
 * display name, recipient list, comment, or structured address object.
 *
 * Public request bodies are untyped at runtime, so the string check is part
 * of the security boundary: arrays stringify into comma-separated recipient
 * lists and nested arrays have caused parser stack-exhaustion advisories.
 */
export function isValidEmailAddress(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;

  const email = normalizeEmail(raw);
  if (!email || Buffer.byteLength(email, 'utf8') > MAX_EMAIL_LENGTH) return false;

  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (Buffer.byteLength(local, 'utf8') > 64 || !domain.includes('.')) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if ([...local].some(char => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f || /\s/u.test(char) || LOCAL_METACHARACTERS.has(char);
  })) return false;

  const asciiDomain = domainToASCII(domain);
  if (!asciiDomain || asciiDomain.length > 253) return false;
  if (Buffer.byteLength(`${local}@${asciiDomain}`, 'utf8') > MAX_EMAIL_LENGTH) return false;
  return asciiDomain.split('.').every(label => DOMAIN_LABEL.test(label));
}

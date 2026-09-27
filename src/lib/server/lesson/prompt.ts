/**
 * Getting untrusted text into a prompt without letting it become
 * instructions.
 *
 * Two callers now put text a stranger typed in front of an agent: lesson
 * generation (a booking's subject/topic/student, from an unauthenticated,
 * CORS-open POST /api/book) and the student's question box (/api/ask,
 * behind a family session but still free-text a child controls). They share
 * this module rather than each carrying their own copy, because a
 * sanitizer that exists twice is a sanitizer that gets fixed once.
 */
import { randomUUID } from 'node:crypto';

/**
 * Strips anything that could look like prompt structure.
 *
 * Every "<"/">" character is stripped outright, not just the literal
 * "<<<"/">>>" substrings — a substring-based strip can be defeated by
 * splicing surviving fragments back into a working delimiter after one
 * removal pass (e.g. "<<>>><X>><<<>" -> "<<<X>>>"). Removing every
 * individual angle-bracket character cannot create new ones, so this is a
 * true fixpoint in a single pass: nothing is left for a second pass to
 * find, no matter how the input is crafted.
 *
 * The control-character class also covers the Unicode line/paragraph
 * separators (U+2028/U+2029) and the bidi overrides (U+202A-U+202E), which
 * can restructure or visually reorder the prompt. They are written as \u
 * escapes deliberately: U+2028/U+2029 are line terminators in JS source, so
 * pasting them literally into a regex literal is a syntax error.
 *
 * `maxLen` is the caller's, because the inputs differ by an order of
 * magnitude — a booking's level is a few words, a student's question is a
 * couple of sentences — and silently truncating a question to a field's
 * length would cut a child off mid-sentence.
 */
export function sanitizeField(s: unknown, maxLen = 200): string {
  return String(s ?? '')
    .replace(/[\r\n\t\x00-\x1f\x7f\u2028\u2029\u202a-\u202e]/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

export interface Fence {
  OPEN: string;
  CLOSE: string;
}

/** A per-request delimiter. Even if a payload somehow survived
 *  sanitizeField, it cannot predict this token and so cannot forge a closing
 *  delimiter to escape the data block. */
export function newFence(): Fence {
  const nonce = randomUUID();
  return { OPEN: `<<<DATA-${nonce}>>>`, CLOSE: `<<<END_DATA-${nonce}>>>` };
}

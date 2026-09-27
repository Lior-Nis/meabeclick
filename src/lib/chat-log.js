/**
 * Appending to, and removing from, a reactive list of chat messages.
 *
 * Two one-line functions, extracted from the student page for one reason:
 * the naive version of each is wrong in Svelte 5, silently, in a way that
 * looks like a backend failure.
 *
 * `$state([])` is a PROXY. Objects pushed into it are wrapped, and the array
 * holds the wrapper — not the literal you pushed. That has two consequences,
 * and the student question box hit both:
 *
 *   1. Writing through the literal you kept a reference to bypasses the
 *      proxy's set trap. The value changes and NOTHING RE-RENDERS. The
 *      question box showed a "⋯" bubble forever while /api/ask was returning
 *      200 with a real answer — the bug looked like a broken agent, and was
 *      only found in Caddy's access log.
 *
 *   2. `list.indexOf(theLiteral)` is -1, because the array holds wrappers.
 *      `splice(-1, 1)` then removes the LAST element instead of the intended
 *      one. That was masked while the thinking bubble happened to be last,
 *      and would have started deleting the wrong message the moment anything
 *      else was appended.
 *
 * Both are fixed by never holding the literal: read the element back out of
 * the list and work with that.
 */

/**
 * Appends `message` and returns the list's own element for it — the reactive
 * wrapper, which is what callers must mutate for the UI to update.
 *
 * @template T
 * @param {T[]} list  a reactive array
 * @param {T} message
 * @returns {T} the element as the list holds it, NOT the object passed in
 */
export function appendMessage(list, message) {
  list.push(message);
  return list[list.length - 1];
}

/**
 * Removes `message`, and does nothing if it is not present.
 *
 * The guard is the point: an unfound element gives indexOf === -1, and a
 * bare `splice(-1, 1)` silently removes the last element instead.
 *
 * @template T
 * @param {T[]} list
 * @param {T} message
 * @returns {boolean} whether anything was removed
 */
export function removeMessage(list, message) {
  const i = list.indexOf(message);
  if (i === -1) return false;
  list.splice(i, 1);
  return true;
}

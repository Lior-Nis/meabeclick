/**
 * A fetch that notices when the tutor's sign-in has run out.
 *
 * A 401 is not a save that failed. Told as one («לא ניתן לשמור…», or the
 * server's own "unauthorized"), it sends her to try again and fail again.
 * `onSignedOut` runs on the first 401 only; `over` stays true after it, so
 * the page can hold the error messages that would retell the same story.
 */
export function sessionAware(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  onSignedOut: () => void,
) {
  let over = false;
  return {
    get over() { return over; },
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const r = await fetchImpl(input, init);
      if (r.status === 401 && !over) {
        over = true;
        onSignedOut();
      }
      return r;
    },
  };
}

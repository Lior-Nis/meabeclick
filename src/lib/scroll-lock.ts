/**
 * The one way anything stops the page scrolling behind an overlay (the
 * header's sidebar, the booking sheet).
 *
 * `lockScroll()` returns its own release, so it fits a Svelte `$effect`
 * exactly: `$effect(() => { if (open) return lockScroll(); })`. Svelte runs
 * that release when `open` turns false AND when the component is destroyed
 * — a navigation away included. Setting `body.style.overflow` from an effect
 * with no cleanup, as the sidebar did, left the lock on every page reached
 * from its links until a reload (Todoist 6hfv9GRG6RvMw65q, 6hfv9ppwWp8G3w8q).
 *
 * Locks are counted per page, so one overlay closing cannot unlock another
 * still open, and a release called twice counts once.
 */
type Lockable = { style: { overflow: string } };

const held = new WeakMap<Lockable, { count: number; restore: string }>();

export function lockScroll(body: Lockable = document.body): () => void {
  const state = held.get(body) ?? { count: 0, restore: '' };
  if (state.count === 0) {
    /* What to give back on the last release. 'hidden' is never the page's
       own resting state here — only ever a lock — so one found in place is
       a leak, and is not what the page is restored to. */
    state.restore = body.style.overflow === 'hidden' ? '' : body.style.overflow;
    body.style.overflow = 'hidden';
  }
  state.count += 1;
  held.set(body, state);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count === 0) body.style.overflow = state.restore;
  };
}

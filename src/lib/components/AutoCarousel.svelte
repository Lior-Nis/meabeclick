<script lang="ts">
  /**
   * An endlessly looping strip of cards that also scrolls by hand.
   *
   * The landing page used to animate these with a CSS transform marquee,
   * which looked fine but could not be touched: no swipe, no wheel, no
   * keyboard, and the loop depended on every card being pasted twice in
   * the markup. This is a real scroll container instead. Auto-advance is a
   * requestAnimationFrame loop that nudges scrollLeft/scrollTop, so every
   * native way of scrolling keeps working, and the loop clones the cards
   * itself: enough copies to fill the viewport twice plus one full set,
   * then the scroll position is kept inside the middle set and jumped by
   * exactly one set length whenever it drifts out. The jump lands on
   * identical pixels, so it is invisible.
   *
   * Auto-advance pauses while the pointer is over the strip, while a card
   * is being dragged, while anything inside has keyboard focus, and for a
   * short grace period after any manual scroll. It never runs when the
   * visitor prefers reduced motion; the strip still scrolls by hand.
   *
   * Cards are passed as children and keep the caller's scoped styles.
   * Clones are aria-hidden so screen readers hear each card once.
   */
  import { onMount, type Snippet } from 'svelte';

  interface Props {
    /** Scroll axis. 'x' is a horizontal strip, 'y' a vertical one. */
    axis?: 'x' | 'y';
    /** Auto-advance speed in CSS pixels per second. */
    speed?: number;
    /** Auto-advance towards the start instead of the end. */
    reverse?: boolean;
    /** Space between cards, any CSS length. */
    gap?: string;
    /** Padding on the track, any CSS padding shorthand. */
    padding?: string;
    /** Accessible name for the strip. */
    label: string;
    /** How long auto-advance stays paused after a manual scroll, in ms. */
    resumeAfter?: number;
    children: Snippet;
  }

  let {
    axis = 'x',
    speed = 40,
    reverse = false,
    gap = '1rem',
    padding = '0',
    label,
    resumeAfter = 2500,
    children,
  }: Props = $props();

  let track = $state<HTMLDivElement | null>(null);
  let hovered = $state(false);
  let dragging = $state(false);
  let focused = $state(false);

  const horizontal = $derived(axis === 'x');

  onMount(() => {
    const el = track;
    if (!el) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    /* Track scroll position as a float: scrollLeft rounds to whole pixels,
       and at slow speeds a whole-pixel step per frame would either stall
       or lurch. */
    let pos = 0;
    let setLen = 0;
    let userUntil = 0;
    let raf = 0;
    let last = 0;
    /* The last position this component wrote. Scroll events arrive a frame
       late, so a flag set around the write would already be cleared; the
       listener instead treats any position within a couple of pixels of
       the last write as its own. Auto-advance moves at most ~1px per frame
       and the events coalesce per frame, so the tolerance is safe. */
    let expected = -1;

    const originals = Array.from(el.children) as HTMLElement[];
    if (!originals.length) return;

    const scrollPos = () => (horizontal ? el.scrollLeft : el.scrollTop);
    const setScroll = (v: number) => {
      expected = v;
      if (horizontal) el.scrollLeft = v;
      else el.scrollTop = v;
    };
    const viewport = () => (horizontal ? el.clientWidth : el.clientHeight);

    /* One set = the originals plus the gap that follows them, measured as
       the distance from the first original to its first clone. */
    const appendSet = () => {
      for (const node of originals) {
        const clone = node.cloneNode(true) as HTMLElement;
        clone.setAttribute('aria-hidden', 'true');
        clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
        el.appendChild(clone);
      }
    };

    const ensureCopies = () => {
      /* Two sets are the minimum: without a clone there is nothing to
         measure a set against. */
      if (el.children.length === originals.length) appendSet();
      const firstClone = el.children[originals.length] as HTMLElement;
      setLen = horizontal
        ? firstClone.offsetLeft - originals[0].offsetLeft
        : firstClone.offsetTop - originals[0].offsetTop;
      if (setLen <= 0) return;
      /* Fill: the position stays inside the second set, so the strip needs
         two sets before the window plus enough after it to fill the view. */
      const need = 2 * setLen + viewport();
      while ((el.children.length / originals.length) * setLen < need) appendSet();
    };

    /* Keep the position inside [setLen, 2*setLen). Outside it, jump by one
       set: the same pixels, so nothing visibly moves. */
    const wrap = (p: number) => {
      if (setLen <= 0) return p;
      if (p >= 2 * setLen) return p - setLen;
      if (p < setLen) return p + setLen;
      return p;
    };

    const autoAllowed = () =>
      !reduceMotion.matches &&
      !hovered &&
      !dragging &&
      !focused &&
      performance.now() >= userUntil;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      if (!autoAllowed() || setLen <= 0) return;
      pos = wrap(pos + speed * dt * (reverse ? -1 : 1));
      setScroll(pos);
    };

    ensureCopies();
    pos = setLen;
    setScroll(pos);
    last = performance.now();
    raf = requestAnimationFrame(tick);

    const onScroll = () => {
      if (expected >= 0 && Math.abs(scrollPos() - expected) < 2.5) return;
      userUntil = performance.now() + resumeAfter;
      const p = scrollPos();
      const w = wrap(p);
      pos = w;
      if (w !== p) setScroll(w);
    };

    /* Mouse drag. Touch already scrolls natively, so only mice need this;
       a pen behaves like a finger. */
    let dragOrigin = 0;
    let dragStart = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      dragging = true;
      dragOrigin = horizontal ? e.clientX : e.clientY;
      dragStart = scrollPos();
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const delta = (horizontal ? e.clientX : e.clientY) - dragOrigin;
      /* Writing the scroll position here is the visitor's doing, so let
         onScroll see it and reset the grace period. */
      if (horizontal) el.scrollLeft = dragStart - delta;
      else el.scrollTop = dragStart - delta;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      userUntil = performance.now() + resumeAfter;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const ro = new ResizeObserver(() => {
      ensureCopies();
      pos = wrap(scrollPos());
      setScroll(pos);
    });
    ro.observe(el);

    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  });

  /** Move by one card in the given direction. */
  function step(dir: 1 | -1) {
    const el = track;
    if (!el) return;
    const first = el.children[0] as HTMLElement | undefined;
    const second = el.children[1] as HTMLElement | undefined;
    const size = first && second
      ? (horizontal ? second.offsetLeft - first.offsetLeft : second.offsetTop - first.offsetTop)
      : (horizontal ? el.clientWidth : el.clientHeight) * 0.8;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({
      [horizontal ? 'left' : 'top']: size * dir,
      behavior: reduce ? 'auto' : 'smooth',
    });
  }
</script>

<div
  class="ac"
  class:ac-x={horizontal}
  class:ac-y={!horizontal}
  class:dragging
  role="region"
  aria-label={label}
  onpointerenter={(e) => { if (e.pointerType === 'mouse') hovered = true; }}
  onpointerleave={() => (hovered = false)}
  onfocusin={() => (focused = true)}
  onfocusout={() => (focused = false)}
>
  <div class="ac-viewport">
    <div
      class="ac-track"
      style:--ac-gap={gap}
      style:--ac-padding={padding}
      bind:this={track}
    >
      {@render children()}
    </div>
  </div>

  <button class="ac-btn ac-prev" type="button" aria-label={horizontal ? 'הקודם' : 'למעלה'} onclick={() => step(-1)}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
  <button class="ac-btn ac-next" type="button" aria-label={horizontal ? 'הבא' : 'למטה'} onclick={() => step(1)}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>
</div>

<style>
  .ac {
    position: relative;
    width: 100%;
    height: 100%;
    /* The strip scrolls in document order, so it must not flip with the
       page's RTL direction; card text inside sets its own direction. */
    direction: ltr;
  }

  .ac-viewport {
    width: 100%;
    height: 100%;
    overflow: hidden;
    contain: paint;
  }
  .ac-x .ac-viewport {
    -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
    mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
  }
  .ac-y .ac-viewport {
    -webkit-mask-image: linear-gradient(to bottom, black 0%, black 82%, transparent 100%);
    mask-image: linear-gradient(to bottom, black 0%, black 82%, transparent 100%);
  }

  .ac-track {
    display: flex;
    gap: var(--ac-gap);
    padding: var(--ac-padding);
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
    outline: none;
  }
  .ac-track::-webkit-scrollbar { display: none; }
  .ac-x .ac-track { flex-direction: row; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
  .ac-y .ac-track { flex-direction: column; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; }
  .dragging .ac-track { cursor: grabbing; user-select: none; }
  .dragging .ac-track :global(*) { pointer-events: none; }
  .ac-track:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); border-radius: 12px; }

  .ac-btn {
    position: absolute;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1.5px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 2px 10px var(--shadow-md);
    cursor: pointer;
    opacity: 0.85;
    transition: opacity 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
    z-index: 2;
  }
  .ac-btn:hover { opacity: 1; border-color: var(--accent); transform: scale(1.06); }
  .ac-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; opacity: 1; }
  .ac-btn:active { transform: scale(0.96); }

  .ac-x .ac-btn { top: 50%; transform: translateY(-50%); }
  .ac-x .ac-btn:hover { transform: translateY(-50%) scale(1.06); }
  .ac-x .ac-btn:active { transform: translateY(-50%) scale(0.96); }
  .ac-x .ac-prev { left: 4px; }
  .ac-x .ac-next { right: 4px; }

  /* The vertical strips are small hero panels, so the arrows are smaller
     and tucked into the right edge instead of covering a card. */
  .ac-y .ac-btn { width: 22px; height: 22px; right: 4px; }
  .ac-y .ac-btn svg { transform: rotate(90deg); width: 11px; height: 11px; }
  .ac-y .ac-prev { top: 4px; }
  .ac-y .ac-next { bottom: 4px; }

  /* On touch-only devices the vertical strips are ~90px tall, and two
     arrows would cover most of a card. A swipe already scrolls them. */
  @media (hover: none) {
    .ac-y .ac-btn { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ac-btn { transition: none; }
  }
</style>

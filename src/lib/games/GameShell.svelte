<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';
  /**
   * The scaffold every game template used to duplicate: `.wrap`, the
   * `<header>` (title + subject), the `#done`/`#stars`/`#done-stats` finish
   * panel, and the page `<title>`. ~450 lines of near-identical markup
   * across 12 files collapse into this one component; the shared
   * `.stats`/`.progress-outer`/`.opt`/`.why`/`.btn` CSS classes each
   * template's own board still uses come from `$lib/styles/games.css`
   * (imported once, below) rather than from here — those need per-template
   * markup (different stat labels, different board shapes), so the thing
   * that's actually shared across them is the *class definitions*, not a
   * fixed DOM shape. See the Task 19/20 report for the full boundary
   * writeup.
   *
   * The timer/finish state games/game.js used to keep in module-scope
   * closures (and expose only through `el('stars')`-style DOM lookups)
   * lives here instead, as real `$state`, and reaches each game template
   * through Svelte context — see `$lib/games/engine.ts`'s
   * `GameEngineContext`. That context IS the typed replacement for
   * game.js's eight unchecked `el('...')` calls: a template that forgets
   * to call `finish()` just never shows a done screen, instead of a
   * missing id throwing partway through reporting a child's actual score.
   *
   * `dataId`/`student`/`t` are here (beyond the `{title, subject, best,
   * children}` in the task brief) because `finish()` — which lives here,
   * not in the template — is what builds and POSTs the result payload, and
   * that payload must carry the request's signature (`t`) for
   * /api/game-result to accept it.
   */
  import { onMount, setContext, tick, type Snippet } from 'svelte';
  import '$lib/styles/games.css';
  import { fmt, shuffle, starsFor, clampStars, reportResult, flushQueuedResults, GAME_CONTEXT_KEY, type FinishInput, type SaveResult } from './engine.ts';

  let {
    title,
    subject,
    best,
    dataId,
    student,
    t,
    children,
  }: {
    title: string;
    subject: string;
    best: number | null;
    dataId: string;
    student: string;
    t: string;
    children: Snippet;
  } = $props();

  let secs = $state(0);
  let timerId: ReturnType<typeof setInterval> | null = null;

  let done = $state(false);
  let stars = $state(0);
  /** Built only from our own numeric interpolations (score/total/fmt(secs)
   *  and a handful of hardcoded Hebrew fragments in each template's
   *  `extraLine`) — never from tutor- or student-authored free text — so
   *  rendering it with `{@html}` below carries no injection risk. */
  let doneLineHtml = $state('');
  /** What happened to the result — said on the finish screen, because «סיימת!»
   *  over a result that was never saved is the silent loss the pre-launch
   *  review found. */
  let saving = $state(false);
  let saved = $state<SaveResult | null>(null);
  /** The finish panel. It replaces the board, and with it the button that
   *  had the focus, so the focus moves here rather than to the page top. */
  let doneEl = $state<HTMLElement>();
  /** The live region's line — see `say` in engine.ts. */
  let spoken = $state('');

  /* Cleared first, so the same line twice in a row («נכון!») is read twice. */
  async function say(text: string) {
    spoken = '';
    await tick();
    spoken = text.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '');
  }

  /* Anything an earlier game could not send goes now, and again whenever the
     connection comes back. */
  onMount(() => {
    flushQueuedResults();
    const retry = () => { flushQueuedResults(); };
    addEventListener('online', retry);
    return () => removeEventListener('online', retry);
  });

  function startTimer() {
    if (timerId) return; // idempotent: a template calling it twice must not open two intervals
    const t0 = Date.now();
    timerId = setInterval(() => {
      secs = Math.round((Date.now() - t0) / 1000);
    }, 1000);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function finish(input: FinishInput) {
    stopTimer();
    stars = clampStars(input.stars ?? starsFor(input.score, input.total));
    const line =
      input.resultLine ??
      `ענית נכון על <strong>${input.score}</strong> מתוך <strong>${input.total}</strong> תוך <strong>${fmt(secs)}</strong>`;
    doneLineHtml = line + (input.extraLine ? `<br>${input.extraLine}` : '');
    done = true;
    tick().then(() => doneEl?.focus());

    saving = true;
    reportResult({
      dataId,
      student,
      t,
      template: input.template,
      score: input.score,
      total: input.total,
      durationSec: secs,
      stars,
      missed: input.missed ?? [],
      /* Only sent when the template measured it. Omitting it stores NULL,
         which means "no help was on offer" — distinct from 0, "help was
         there and went unused". The suggestion engine relies on telling
         those apart. */
      ...(typeof input.hints === 'number' ? { hints: input.hints } : {}),
    }).then(r => { saved = r; }).finally(() => { saving = false; });
  }

  setContext(GAME_CONTEXT_KEY, {
    startTimer,
    secs: () => secs,
    best: () => best,
    finish,
    say,
    shuffle,
    fmt,
  });
</script>

<svelte:head>
  <title>{title || 'משחק'} — מאה בקליק</title>
</svelte:head>

<div class="wrap">
  <div class="page-brand"><BrandMark height={26} /></div>
  <!-- The way back. The logo and the error page went to the marketing
       homepage; /app/student sends a signed-in child to their own board and
       anyone else to the sign-in page. -->
  <a class="back" href="/app/student" data-sveltekit-reload>→ חזרה לדף שלי</a>

  <header>
    <h1>{title}</h1>
    <div class="subject">{subject}</div>
  </header>

  {#if best !== null}
    <div class="best-note">השיא שלכם עד כה: <strong>{best}</strong> 🏆</div>
  {/if}

  <!-- Always in the page: a region inserted together with its text is not read. -->
  <div class="sr-only" aria-live="polite" aria-atomic="true">{spoken}</div>

  {#if !done}
    {@render children()}
  {:else}
    <div id="done" tabindex="-1" bind:this={doneEl}>
      <div class="stars">{'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>
      <div class="done-title">סיימת! 🎉</div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="done-line">{@html doneLineHtml}</div>
      <div class="save-line" role="status">
        {#if saving}שומרים את התוצאה…{:else if saved === 'saved'}✓ נשמר{:else if saved === 'queued'}אין חיבור כרגע — התוצאה תישמר כשהחיבור יחזור{/if}
      </div>
      <!-- Waits for the save: a reload mid-request could cancel it. -->
      <button class="btn" onclick={() => location.reload()} disabled={saving}>שחקו שוב 🔄</button>
      <a class="back" href="/app/student" data-sveltekit-reload>→ חזרה לדף שלי</a>
    </div>
  {/if}
</div>

<style>
  /* 16px sides: games ran edge to edge on a phone. */
  .wrap { max-width: 760px; margin: 0 auto; padding-inline: 16px; }
  .back { display: inline-block; min-height: 44px; line-height: 44px; color: var(--accent); font-weight: 700; text-decoration: none; }
  .save-line { min-height: 1.4em; margin: 0.4rem 0 0.8rem; color: var(--text-muted); font-size: 0.9rem; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  #done:focus { outline: none; }
  .page-brand { display: flex; justify-content: center; padding: 1rem 0 0.9rem; }
  header { text-align: center; margin-bottom: 0.5rem; }
  h1 { font-size: clamp(1.25rem, 4vw, 1.8rem); font-weight: 900; }
</style>

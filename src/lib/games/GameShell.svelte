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
  import { setContext, type Snippet } from 'svelte';
  import '$lib/styles/games.css';
  import { fmt, shuffle, starsFor, clampStars, reportResult, GAME_CONTEXT_KEY, type FinishInput } from './engine.ts';

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
    });
  }

  setContext(GAME_CONTEXT_KEY, {
    startTimer,
    secs: () => secs,
    best: () => best,
    finish,
    shuffle,
    fmt,
  });
</script>

<svelte:head>
  <title>{title || 'משחק'} — מאה בקליק</title>
</svelte:head>

<div class="wrap">
  <div class="page-brand"><BrandMark height={26} /></div>

  <header>
    <h1>{title}</h1>
    <div class="subject">{subject}</div>
  </header>

  {#if best !== null}
    <div class="best-note">השיא שלכם עד כה: <strong>{best}</strong> 🏆</div>
  {/if}

  {#if !done}
    {@render children()}
  {:else}
    <div id="done">
      <div class="stars">{'⭐'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>
      <div class="done-title">סיימת! 🎉</div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="done-line">{@html doneLineHtml}</div>
      <button class="btn" onclick={() => location.reload()}>שחקו שוב 🔄</button>
    </div>
  {/if}
</div>

<style>
  .wrap { max-width: 760px; margin: 0 auto; }
  .page-brand { display: flex; justify-content: center; padding: 1rem 0 0.9rem; }
  header { text-align: center; margin-bottom: 0.5rem; }
  h1 { font-size: clamp(1.25rem, 4vw, 1.8rem); font-weight: 900; }
</style>

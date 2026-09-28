<script lang="ts">
  /**
   * Port of games/number-line.html — touch behaviour is load-bearing here
   * (played on phones), so `touch-action: none`, the `pointerdown`/
   * `pointermove` handlers and the `e.touches?.[0].clientX ?? e.clientX`
   * fallback are carried over intact, not "modernized" away.
   *
   * The svg is rebuilt as a markup string and re-inserted via `{@html}`
   * on every guess (same as the original's `draw()` replacing
   * `#line`'s innerHTML each time) — so the `$effect` below, which
   * (re)attaches the pointer listeners, is keyed on `markup` and reruns
   * every time a fresh `<svg>` node lands in the DOM. Because that node
   * is never part of Svelte's own template, the CSS reaching into it is
   * `:global(...)`, same reasoning as Labelling.svelte.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, offersHints, type GameEngineContext, type GameData } from './engine.ts';
  import RoundHint from './RoundHint.svelte';

  type Round = { target: number; label?: string; tolerance?: number; why?: string; hint?: string };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const rounds = (data.rounds as Round[] | undefined) ?? [];
  const lo = (data.min as number | undefined) ?? 0;
  const hi = (data.max as number | undefined) ?? 10;

  const W = 320, H = 70, PAD = 18;

  let idx = $state(0);
  let score = $state(0);
  let guess = $state<number | null>(null);
  let answered = $state(false);
  /** Hints the child asked for — see RoundHint.svelte. */
  let hintsUsed = $state(0);
  let whyText = $state('');
  let markup = $state('');
  let lineEl: HTMLDivElement | undefined = $state();
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  const xOf = (v: number) => PAD + ((v - lo) * (W - 2 * PAD)) / (hi - lo);
  const vOf = (x: number) => lo + ((x - PAD) * (hi - lo)) / (W - 2 * PAD);

  /** A number inside a Hebrew sentence, kept left-to-right: without the
   *  isolate, "-1.5" is laid out as "1.5-" in a right-to-left paragraph. */
  const LRI = String.fromCodePoint(0x2066); // LEFT-TO-RIGHT ISOLATE
  const PDI = String.fromCodePoint(0x2069); // POP DIRECTIONAL ISOLATE
  const isolate = (n: number | string): string => `${LRI}${n}${PDI}`;

  function isOk(): boolean {
    if (guess === null) return false;
    const r = rounds[idx];
    return Math.abs(guess - r.target) <= (r.tolerance ?? (hi - lo) * 0.03);
  }

  function redraw(showAnswer = false) {
    const r = rounds[idx];
    const ticks: string[] = [];
    const step = (hi - lo) / 10;
    for (let i = 0; i <= 10; i++) {
      const v = lo + i * step;
      const x = xOf(v);
      const major = Math.abs(v - Math.round(v)) < 1e-9;
      ticks.push(
        `<line x1="${x.toFixed(1)}" y1="${H / 2 - (major ? 9 : 5)}" x2="${x.toFixed(1)}" y2="${H / 2 + (major ? 9 : 5)}" stroke="#94A3B8" stroke-width="${major ? 1.6 : 1}"/>`,
      );
      if (major) {
        ticks.push(
          `<text x="${x.toFixed(1)}" y="${H / 2 + 24}" font-size="10" fill="#64748B" text-anchor="middle" direction="ltr" font-family="Heebo,sans-serif">${+v.toFixed(2)}</text>`,
        );
      }
    }

    const marker =
      guess === null
        ? ''
        : `<polygon points="${xOf(guess).toFixed(1)},${H / 2 - 4} ${(xOf(guess) - 7).toFixed(1)},${H / 2 - 20} ${(xOf(guess) + 7).toFixed(1)},${H / 2 - 20}"
             fill="${answered ? (isOk() ? '#10B981' : '#DC2626') : '#FA8231'}"/>
           <circle cx="${xOf(guess).toFixed(1)}" cy="${H / 2}" r="4.5" fill="${answered ? (isOk() ? '#10B981' : '#DC2626') : '#FA8231'}"/>`;

    const truth = showAnswer
      ? `<circle cx="${xOf(r.target).toFixed(1)}" cy="${H / 2}" r="6" fill="none" stroke="#10B981" stroke-width="2.5"/>
         <text x="${xOf(r.target).toFixed(1)}" y="${H / 2 - 26}" font-size="11" fill="#047857" text-anchor="middle" direction="ltr" font-weight="700" font-family="Heebo,sans-serif">${r.label ?? r.target}</text>`
      : '';

    markup = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${PAD}" y1="${H / 2}" x2="${W - PAD}" y2="${H / 2}" stroke="#1E293B" stroke-width="2.2" stroke-linecap="round"/>
      ${ticks.join('')}${truth}${marker}
    </svg>`;
  }

  function place(e: PointerEvent) {
    if (answered) return;
    const svg = lineEl?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const touches = (e as unknown as { touches?: { clientX: number }[] }).touches;
    const cx = (touches ? touches[0].clientX : e.clientX) - rect.left;
    const v = vOf((cx * W) / rect.width);
    guess = Math.min(hi, Math.max(lo, v));
    redraw();
  }

  $effect(() => {
    void markup; // reactive dependency: rerun after every fresh <svg> lands
    const svg = lineEl?.querySelector('svg');
    if (!svg) return;
    svg.addEventListener('pointerdown', place);
    svg.addEventListener('pointermove', (e) => { if (e.buttons === 1) place(e); });
  });

  function check() {
    if (guess === null) return;
    answered = true;
    const r = rounds[idx];
    const ok = isOk();
    if (ok) score++;
    else missed.push(r.label ?? String(r.target));
    redraw(true);
    whyText = ok ? `מדויק! ${r.why || ''}` : `כמעט — סימנתם ${isolate(guess.toFixed(2))} והמספר נמצא ב-${isolate(r.target)}. ${r.why || ''}`;
  }

  function next() {
    idx++;
    if (idx < rounds.length) {
      guess = null;
      answered = false;
      whyText = '';
      redraw();
    } else {
      engine.finish({ template: 'number-line', score, total: rounds.length, missed, ...(offersHints(rounds) ? { hints: hintsUsed } : {}) });
    }
  }

  if (rounds.length) {
    engine.startTimer();
    redraw();
  }
</script>

{#if !rounds.length}
  <div class="msg">אין שאלות בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{idx + 1}/{rounds.length}</div><div class="stat-lbl">שאלה</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((idx + 1) / rounds.length) * 100}%"></div></div>

  <div class="target">
    <div class="hint">איפה הממוקם המספר הזה על הציר?</div>
    <div class="target-val">{rounds[idx].label ?? String(rounds[idx].target)}</div>
  </div>
  <div class="line-box">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <div bind:this={lineEl}>{@html markup}</div>
  </div>
  <div class="hint">לחצו או גררו על הציר, ואז אשרו</div>
  <div style="text-align:center">
    {#if !answered}
      <button class="btn" onclick={check} disabled={guess === null}>בדיקה ✓</button>
    {:else}
      <button class="btn" onclick={next}>{idx + 1 < rounds.length ? 'הבא ←' : 'סיום 🏁'}</button>
    {/if}
  </div>
  {#key idx}
    <RoundHint hint={rounds[idx]?.hint} locked={answered} onuse={() => hintsUsed++} />
  {/key}
  {#if whyText}<div class="why">{whyText}</div>{/if}
{/if}

<style>
  .target { text-align: center; margin-bottom: 1rem; }
  .target-val {
    display: inline-block; background: var(--accent); color: #fff;
    font-size: clamp(1.8rem, 7vw, 2.6rem); font-weight: 900;
    padding: 0.4rem 1.6rem; border-radius: 16px; direction: ltr;
  }
  .line-box {
    background: var(--bg-card); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 2.4rem 1rem 1.2rem;
    margin-bottom: 1rem; touch-action: none;
  }
  :global(.line-box svg) { display: block; width: 100%; height: auto; overflow: visible; cursor: pointer; }
</style>

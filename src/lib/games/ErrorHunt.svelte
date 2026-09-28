<script lang="ts">
  /** Port of games/error-hunt.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, offersHints, verdict, type GameEngineContext, type GameData } from './engine.ts';
  import RoundHint from './RoundHint.svelte';

  type Round = { problem: string; steps: string[]; badStep: number; why: string; hint?: string };
  type StepBtn = { text: string; state: 'idle' | 'found' | 'missed' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const rounds = (data.rounds as Round[] | undefined) ?? [];

  let idx = $state(0);
  let score = $state(0);
  let answered = $state(false);
  /** Hints the child asked for — see RoundHint.svelte. */
  let hintsUsed = $state(0);
  let steps = $state<StepBtn[]>([]);
  let whyText = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function renderRound() {
    answered = false;
    whyText = '';
    steps = rounds[idx].steps.map((text) => ({ text, state: 'idle' as const }));
  }

  function choose(i: number) {
    if (answered) return;
    answered = true;
    const r = rounds[idx];
    if (i === r.badStep) {
      steps[i].state = 'found';
      score++;
    } else {
      steps[i].state = 'missed';
      steps[r.badStep].state = 'found';
      missed.push(r.problem);
    }
    whyText = r.why;
    engine.say(verdict(i === r.badStep, { answer: `שורה ${r.badStep + 1}`, note: whyText }));
  }

  function next() {
    idx++;
    if (idx < rounds.length) renderRound();
    else engine.finish({ template: 'error-hunt', score, total: rounds.length, missed, ...(offersHints(rounds) ? { hints: hintsUsed } : {}) });
  }

  if (rounds.length) {
    engine.startTimer();
    renderRound();
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

  <div class="prompt">{rounds[idx].problem}</div>
  <div class="hint">איפה נפלה הטעות? לחצו על השורה השגויה 🔍</div>
  <div>
    {#each steps as s, i (i)}
      <button
        class="step"
        class:found={s.state === 'found'}
        class:missed={s.state === 'missed'}
        disabled={answered}
        onclick={() => choose(i)}
      >
        <span class="step-num">{i + 1}</span>
        <span class="step-txt">{s.text}{#if s.state === 'found'}<span class="mark">✓</span>{:else if s.state === 'missed'}<span class="mark">✗</span>{/if}</span>
      </button>
    {/each}
  </div>
  {#key idx}
    <RoundHint hint={rounds[idx]?.hint} locked={answered} onuse={() => hintsUsed++} />
  {/key}
  {#if whyText}<div class="why"><strong>שורה {rounds[idx].badStep + 1}:</strong> {whyText}</div>{/if}
  {#if answered}
    <div style="text-align:center">
      <button class="btn" onclick={next}>{idx + 1 < rounds.length ? 'הבא ←' : 'סיום 🏁'}</button>
    </div>
  {/if}
{/if}

<style>
  .step {
    display: flex; align-items: center; gap: 0.7rem;
    width: 100%; background: var(--bg-card);
    border: 2px solid var(--border); border-radius: 12px;
    padding: 0.7rem 0.9rem; min-height: 48px; margin-bottom: 0.5rem;
    font-family: inherit; font-size: 1rem; color: var(--text-primary);
    text-align: right; cursor: pointer; direction: rtl;
    transition: border-color 0.18s, background 0.18s;
  }
  .step:hover:not(:disabled) { border-color: var(--accent2-strong); background: var(--accent2-dim); }
  .step:disabled { cursor: default; }
  .step-num {
    flex: 0 0 26px; height: 26px; border-radius: 50%;
    background: var(--accent-dim); color: var(--accent);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8rem; font-weight: 800;
  }
  /* Each step takes the direction of its own text: a formula reads LTR, a
     Hebrew sentence RTL. Forcing LTR reversed every Hebrew step. */
  .step-txt { flex: 1; unicode-bidi: plaintext; text-align: start; font-weight: 600; }
  .step.found { border-color: var(--accent3); background: var(--accent3-dim); }
  .step.found .step-num { background: var(--accent3); color: #fff; }
  .step.missed { border-color: var(--danger); background: var(--danger-dim); }
  .step.missed .step-num { background: var(--danger); color: #fff; }
  .step:focus-visible { outline: 3px solid var(--accent2-strong); outline-offset: 3px; }
</style>

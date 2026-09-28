<script lang="ts">
  /**
   * Port of games/quiz.html. `data` is unchecked JSON off disk (same trust
   * level games/game.js always had for it) — the casts below are the one
   * place that trust boundary is visible, same as every other template.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, offersHints, verdict, type GameEngineContext, type GameData } from './engine.ts';
  import RoundHint from './RoundHint.svelte';

  type Question = { q: string; options: string[]; answer: number; why?: string; hint?: string };
  type Opt = { text: string; right: boolean; state: 'idle' | 'correct' | 'wrong' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const questions = (data.questions as Question[] | undefined) ?? [];

  let idx = $state(0);
  let score = $state(0);
  let answered = $state(false);
  /** Hints the child asked for — see RoundHint.svelte. */
  let hintsUsed = $state(0);
  let opts = $state<Opt[]>([]);
  let whyText = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function renderQuestion() {
    const q = questions[idx];
    answered = false;
    whyText = '';
    opts = engine.shuffle(q.options.map((text, i) => ({ text, right: i === q.answer, state: 'idle' as const })));
  }

  function choose(o: Opt) {
    if (answered) return;
    answered = true;
    opts.forEach((x) => { if (x.right) x.state = 'correct'; });
    if (o.right) score++;
    else { o.state = 'wrong'; missed.push(questions[idx].q); }
    whyText = questions[idx].why ?? '';
    engine.say(verdict(o.right, { answer: opts.find((x) => x.right)?.text, note: whyText }));
  }

  function next() {
    idx++;
    if (idx < questions.length) renderQuestion();
    else engine.finish({ template: 'quiz', score, total: questions.length, missed, ...(offersHints(questions) ? { hints: hintsUsed } : {}) });
  }

  if (questions.length) {
    engine.startTimer();
    renderQuestion();
  }
</script>

{#if !questions.length}
  <div class="msg">אין שאלות בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{idx + 1}/{questions.length}</div><div class="stat-lbl">שאלה</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((idx + 1) / questions.length) * 100}%"></div></div>

  <div class="q-text">{questions[idx].q}</div>
  <div>
    {#each opts as o (o.text)}
      <button
        class="opt"
        class:correct={o.state === 'correct'}
        class:wrong={o.state === 'wrong'}
        disabled={answered}
        onclick={() => choose(o)}
      >{o.text}{#if o.state === 'correct'}<span class="mark">✓</span>{:else if o.state === 'wrong'}<span class="mark">✗</span>{/if}</button>
    {/each}
  </div>
  {#key idx}
    <RoundHint hint={questions[idx]?.hint} locked={answered} onuse={() => hintsUsed++} />
  {/key}
  {#if whyText}<div class="why">{whyText}</div>{/if}
  {#if answered}
    <div style="text-align:center">
      <button class="btn" onclick={next}>{idx + 1 < questions.length ? 'הבא ←' : 'סיום 🏁'}</button>
    </div>
  {/if}
{/if}

<style>
  .q-text { font-size: 1.12rem; font-weight: 800; line-height: 1.5; margin-bottom: 0.9rem; text-align: center; }
</style>

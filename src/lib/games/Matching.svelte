<script lang="ts">
  /** Port of games/matching.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, type GameEngineContext, type GameData } from './engine.ts';

  type Pair = { left: string; right: string; hint?: string };
  type Card = { text: string; pairIdx: number; side: 'left' | 'right'; state: 'idle' | 'picked' | 'done' | 'miss' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const pairs = (data.pairs as Pair[] | undefined) ?? [];

  let lefts = $state<Card[]>([]);
  let rights = $state<Card[]>([]);
  let picked = $state<Card | null>(null);
  let solved = $state(0);
  let tries = $state(0);
  let whyText = $state('');
  /* Help the child ASKED for, which is a different measurement from the
     `hint` already shown after a correct match — that one is explanatory
     feedback and says nothing about what they needed. Reported with the
     result so the suggestion engine can honour §3.2's "no hints on the
     last play" rule; a template that offers no help reports nothing, and
     null there means "none were on offer", not "needed none". */
  let hintsUsed = $state(0);
  let shownHint = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function build() {
    lefts = engine.shuffle(pairs.map((p, i) => ({ text: p.left, pairIdx: i, side: 'left' as const, state: 'idle' as const })));
    rights = engine.shuffle(pairs.map((p, i) => ({ text: p.right, pairIdx: i, side: 'right' as const, state: 'idle' as const })));
  }

  /** The hint for the currently selected term. Only meaningful once the
   *  child has picked one — a hint with nothing selected would just reveal
   *  an arbitrary pair. */
  const hintAvailable = $derived(
    !!picked && picked.state !== 'done' && !!pairs[picked.pairIdx]?.hint,
  );

  function revealHint() {
    if (!picked) return;
    const hint = pairs[picked.pairIdx]?.hint;
    if (!hint) return;
    hintsUsed++;
    shownHint = hint;
  }

  function pick(card: Card) {
    /* A new selection clears the previous hint: leaving it on screen would
       let one press of the button help with every pair after it, and the
       count would then understate the help actually used. */
    shownHint = '';
    if (card.state === 'done') return;

    // Tapping a second card on the same side just moves the selection.
    if (!picked || picked.side === card.side) {
      if (picked) picked.state = 'idle';
      picked = card;
      card.state = 'picked';
      return;
    }

    tries++;
    const a = picked, b = card;
    a.state = 'idle';

    if (a.pairIdx === b.pairIdx) {
      a.state = 'done';
      b.state = 'done';
      solved++;
      const hint = pairs[a.pairIdx].hint;
      if (hint) whyText = hint;
      picked = null;
      if (solved === pairs.length) setTimeout(end, 500);
    } else {
      missed.push(pairs[a.pairIdx].left);
      a.state = 'miss';
      b.state = 'miss';
      setTimeout(() => {
        if (a.state === 'miss') a.state = 'idle';
        if (b.state === 'miss') b.state = 'idle';
      }, 550);
      picked = null;
    }
  }

  function end() {
    // Perfect play is one try per pair; every extra try costs a point.
    const score = Math.max(0, pairs.length - (tries - pairs.length));
    engine.finish({
      template: 'matching',
      score,
      total: pairs.length,
      extraLine: hintsUsed ? `${tries} ניסיונות · ${hintsUsed} רמזים` : `${tries} ניסיונות`,
      missed: [...new Set(missed)],
      hints: hintsUsed,
    });
  }

  if (pairs.length >= 2) {
    engine.startTimer();
    build();
  }
</script>

{#if pairs.length < 2}
  <div class="msg">צריך לפחות שני זוגות בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{solved}/{pairs.length}</div><div class="stat-lbl">התאמות</div></div>
    <div class="stat"><div class="stat-val">{tries}</div><div class="stat-lbl">ניסיונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(solved / pairs.length) * 100}%"></div></div>

  <div class="prompt">חברו כל מונח להגדרה שלו 🔗</div>
  <div class="hint">לוחצים על מונח מימין, ואז על ההגדרה המתאימה משמאל</div>
  <!-- Help on demand, not a penalty. Asking for a hint is a legitimate way
       to learn, so the button says nothing discouraging and the count is
       not shown to the child during play — it reaches the tutor, who is
       the person the signal is for. -->
  <div class="help-row">
    <button class="help-btn" onclick={revealHint} disabled={!hintAvailable}>
      💡 רמז
    </button>
    {#if shownHint}<span class="help-text">{shownHint}</span>{/if}
  </div>
  <div class="cols">
    <div>
      <div class="col-title">הגדרות</div>
      {#each rights as c (c.pairIdx + '-r')}
        <button
          class="card"
          class:picked={c.state === 'picked'}
          class:done={c.state === 'done'}
          class:miss={c.state === 'miss'}
          disabled={c.state === 'done'}
          onclick={() => pick(c)}
        >{c.text}</button>
      {/each}
    </div>
    <div>
      <div class="col-title">מונחים</div>
      {#each lefts as c (c.pairIdx + '-l')}
        <button
          class="card"
          class:picked={c.state === 'picked'}
          class:done={c.state === 'done'}
          class:miss={c.state === 'miss'}
          disabled={c.state === 'done'}
          onclick={() => pick(c)}
        >{c.text}</button>
      {/each}
    </div>
  </div>
  {#if whyText}<div class="why">{whyText}</div>{/if}
{/if}

<style>
  /* Help on demand. 44px tap target like every control a child uses on a
     phone, and disabled-with-reason rather than hidden: a button that
     appears only sometimes is harder to find than one that is always
     there. */
  .help-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; }
  .help-btn {
    font-family: inherit; font-size: .9rem; font-weight: 700;
    min-height: 44px; padding: 0 16px; border-radius: 10px;
    border: 1px solid var(--border, #E2E8F0); background: #fff; cursor: pointer;
  }
  .help-btn:disabled { opacity: .5; cursor: default; }
  .help-text { font-size: .9rem; line-height: 1.5; }

  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 0.4rem; }
  .col-title { font-size: 0.78rem; font-weight: 800; color: var(--text-muted); text-align: center; margin-bottom: 6px; }
  .card {
    display: block; width: 100%;
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 14px;
    padding: 12px 10px; margin-bottom: 10px; cursor: pointer; font-size: 0.95rem;
    line-height: 1.4; text-align: center; transition: all 0.15s; font-family: inherit;
  }
  .card:hover:not(:disabled) { border-color: var(--accent); }
  .card.picked { border-color: var(--accent); background: var(--accent-dim); }
  .card.done { border-color: var(--accent3); background: var(--accent3-dim); color: var(--accent3-strong); cursor: default; }
  .card.miss { border-color: var(--danger); background: var(--danger-dim); }
</style>

<script lang="ts">
  /**
   * Port of games/memory.html — the one template that had forked away
   * from games/game.js entirely (its own timer, its own scoring, its own
   * /api/game-result POST, 128 lines of inline CSS duplicating game.css).
   *
   * Diffed against game.js, memory's fork was doing exactly two things
   * differently on purpose: (1) its stars come from tries-per-pair, not
   * score/total, and (2) its result line says "סיימתם ב-N ניסיונות תוך
   * M:SS" rather than "ענית נכון על X מתוך Y" — the generic wording is
   * trivially true for memory (a finished board always has score ===
   * total, see `stars` below) and tries is the actually meaningful
   * number. Everything else (elapsed timer, shuffle, the fire-and-forget
   * report) was a byte-for-byte reimplementation of logic game.js already
   * had. Decision: fold memory back onto the shared engine and
   * GameShell's done panel like every other template, and extend
   * `FinishInput` with optional `stars`/`resultLine` overrides for these
   * two genuine divergences — see engine.ts's doc comments on those
   * fields. The Hebrew wording below is byte-identical to memory.html's
   * original `el('done-stats').innerHTML` line. No second engine survives
   * this port.
   *
   * The 8-pair board cap (`slice(0, 8)`) is preserved as-is: it's a
   * playability choice about board size (16 cards fits the grid cleanly),
   * not a bug this task is fixing, even though the registry allows up to
   * 16 pairs in a data file.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, verdict, type GameEngineContext, type GameData } from './engine.ts';

  type Pair = { a: string; b: string };
  type Card = { id: number; pair: number; text: string; flipped: boolean; matched: boolean; wrong: boolean };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const pairs = ((data.pairs as Pair[] | undefined) ?? []).slice(0, 8);
  const totalPairs = pairs.length;

  let cards = $state<Card[]>([]);
  let tries = $state(0);
  let matched = $state(0);
  let lock = $state(false);
  let first: Card | null = null;
  const elapsed = $derived(engine.secs());

  function build() {
    const list: Card[] = [];
    pairs.forEach((p, i) => {
      list.push({ id: i * 2, pair: i, text: p.a, flipped: false, matched: false, wrong: false });
      list.push({ id: i * 2 + 1, pair: i, text: p.b, flipped: false, matched: false, wrong: false });
    });
    cards = engine.shuffle(list);
  }

  function flip(card: Card) {
    if (lock || card.flipped || card.matched) return;
    card.flipped = true;

    if (!first) { first = card; engine.say(card.text); return; }

    tries++;
    const a = first, b = card;
    engine.say(`${b.text}. ${a.pair === b.pair ? verdict(true, { note: 'זוג!' }) : verdict(false, { note: 'לא זוג.' })}`);

    if (a.pair === b.pair) {
      a.matched = true;
      b.matched = true;
      first = null;
      matched++;
      if (matched === totalPairs) finish();
    } else {
      lock = true;
      a.wrong = true;
      b.wrong = true;
      setTimeout(() => {
        a.flipped = false; a.wrong = false;
        b.flipped = false; b.wrong = false;
        first = null;
        lock = false;
      }, 950);
    }
  }

  function finish() {
    const stars = tries <= totalPairs * 2.5 ? 3 : tries <= totalPairs * 4 ? 2 : 1;
    engine.finish({
      template: 'memory',
      score: totalPairs,
      total: totalPairs,
      stars,
      // Byte-identical to memory.html's original done-stats line — see
      // this file's header comment. Built from our own trusted
      // numeric interpolations only, same as GameShell's generic line.
      resultLine: `סיימתם ב-<strong>${tries}</strong> ניסיונות תוך <strong>${engine.fmt(engine.secs())}</strong>`,
    });
  }

  if (totalPairs) {
    engine.startTimer();
    build();
  }
</script>

{#if !totalPairs}
  <div class="msg">קובץ המשחק ריק — אין זוגות להצגה.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{matched}/{totalPairs}</div><div class="stat-lbl">זוגות</div></div>
    <div class="stat"><div class="stat-val">{tries}</div><div class="stat-lbl">ניסיונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(matched / totalPairs) * 100}%"></div></div>

  <div id="board">
    {#each cards as c (c.id)}
      <div class="cell">
        <button
          class="card"
          class:flipped={c.flipped}
          class:matched={c.matched}
          class:wrong={c.wrong}
          aria-label={c.flipped || c.matched ? c.text : 'קלף הפוך'}
          disabled={c.matched}
          onclick={() => flip(c)}
        >
          <span class="face back">?</span>
          <span class="face front">{c.text}{#if c.matched}<span class="mark">✓</span>{:else if c.wrong}<span class="mark">✗</span>{/if}</span>
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  #board { display: grid; gap: 0.6rem; grid-template-columns: repeat(4, 1fr); }
  @media (max-width: 460px) { #board { grid-template-columns: repeat(3, 1fr); gap: 0.45rem; } }

  .cell { perspective: 900px; }
  .card {
    position: relative; width: 100%; aspect-ratio: 3 / 4;
    min-height: 66px;
    transform-style: preserve-3d;
    transition: transform 0.45s cubic-bezier(0.3, 1, 0.4, 1);
    cursor: pointer; border: none; background: none; padding: 0;
    font-family: inherit;
  }
  .card.flipped { transform: rotateY(180deg); }
  .face {
    position: absolute; inset: 0;
    backface-visibility: hidden; -webkit-backface-visibility: hidden;
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    padding: 0.4rem; text-align: center;
    font-weight: 700; font-size: clamp(0.72rem, 2.4vw, 0.95rem);
    line-height: 1.25; word-break: break-word;
  }
  .back {
    background: var(--text-primary);
    background-image: radial-gradient(rgba(255, 255, 255, 0.16) 1.4px, transparent 1.4px);
    background-size: 13px 13px;
    color: #fff; font-size: 1.5rem;
  }
  .front {
    transform: rotateY(180deg);
    background: var(--bg-card);
    border: 2px solid var(--accent);
    color: var(--text-primary);
  }
  .card.matched .front {
    border-color: var(--accent3);
    background: var(--accent3-dim);
    color: var(--accent3-strong);
  }
  .card.matched { cursor: default; }
  .card.wrong .front { border-color: var(--danger); animation: memory-shake 0.42s; }
  @keyframes memory-shake {
    0%, 100% { transform: rotateY(180deg) translateX(0); }
    25% { transform: rotateY(180deg) translateX(-6px); }
    75% { transform: rotateY(180deg) translateX(6px); }
  }
  .card:focus-visible { outline: 3px solid var(--accent2-strong); outline-offset: 3px; border-radius: 14px; }
</style>

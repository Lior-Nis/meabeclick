<script lang="ts">
  /**
   * Port of games/speed-drill.html. This is where tracked bug
   * 6hJh337GrfGQj5Hq is actually fixed: the old localStorage read/write
   * for a personal best is gone — GameShell already renders the real,
   * server-side best (getBest(), src/lib/server/db.ts) generically above
   * every game, and the one thing this template still needed a "previous
   * best" for — deciding whether to show "שיא אישי חדש!" — reads it from
   * `engine.best()` (the same value GameShell was given) instead.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, verdict, type GameEngineContext, type GameData } from './engine.ts';

  type Item = { q: string; a: string; options: string[] };
  type OptBtn = { text: string; state: 'idle' | 'correct' | 'wrong' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const items = (data.items as Item[] | undefined) ?? [];
  const seconds = (data.seconds as number | undefined) ?? 60;

  let phase = $state<'intro' | 'playing'>('intro');
  let left = $state(seconds);
  let score = $state(0);
  let asked = $state(0);
  let streak = $state(0);
  let bestStreak = $state(0);
  let cur = $state<Item | null>(null);
  let opts = $state<OptBtn[]>([]);
  let answering = $state(false);
  const missed: string[] = [];

  let queue: Item[] = [];
  let tick: ReturnType<typeof setInterval> | null = null;

  $effect(() => () => { if (tick) clearInterval(tick); }); // stop the countdown if navigated away mid-drill

  function nextQ() {
    if (!queue.length) queue = engine.shuffle([...items]);
    cur = queue.pop() ?? null;
    if (!cur) return;
    answering = false;
    opts = engine.shuffle([...cur.options]).map((text) => ({ text, state: 'idle' as const }));
  }

  function begin() {
    phase = 'playing';
    queue = engine.shuffle([...items]);
    engine.startTimer();
    tick = setInterval(() => {
      left--;
      if (left <= 0) { left = 0; end(); }
    }, 1000);
    nextQ();
  }

  function answer(o: OptBtn) {
    if (answering || !cur) return;
    answering = true;
    asked++;
    const ok = o.text === cur.a;
    if (ok) {
      score++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      o.state = 'correct';
    } else {
      streak = 0;
      o.state = 'wrong';
      missed.push(cur.q);
      opts.forEach((x) => { if (x.text === cur!.a) x.state = 'correct'; });
    }
    engine.say(verdict(ok, { answer: cur.a }));
    setTimeout(() => { if (left > 0) nextQ(); }, ok ? 180 : 850);
  }

  function end() {
    if (tick) { clearInterval(tick); tick = null; }
    const prevBest = engine.best() ?? 0;
    let line = `הרצף הארוך ביותר: <strong>${bestStreak}</strong> 🔥`;
    if (score > prevBest) line += '<br>שיא אישי חדש! 🏆';
    engine.finish({ template: 'speed-drill', score, total: Math.max(asked, 1), extraLine: line, missed });
  }
</script>

{#if !items.length}
  <div class="msg">אין תרגילים בקובץ המשחק.</div>
{:else if phase === 'intro'}
  <div class="start-card">
    <div style="font-size:2.6rem">⚡</div>
    <div class="done-title">כמה תספיקו?</div>
    <div class="done-line">{seconds} שניות · {items.length} תרגילים בבנק</div>
    <button class="btn" onclick={begin}>יאללה, מתחילים! 🚀</button>
  </div>
{:else if cur}
  <div class="stats">
    <div class="stat"><div class="stat-val clock" class:low={left <= 10}>{engine.fmt(Math.max(0, left))}</div><div class="stat-lbl">נשאר</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{streak}</div><div class="stat-lbl">רצף 🔥</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((seconds - left) / seconds) * 100}%"></div></div>

  <div class="q">{cur.q}</div>
  <div class="grid">
    {#each opts as o (o.text)}
      <button
        class="opt"
        class:correct={o.state === 'correct'}
        class:wrong={o.state === 'wrong'}
        disabled={answering}
        onclick={() => answer(o)}
      >{o.text}{#if o.state === 'correct'}<span class="mark">✓</span>{:else if o.state === 'wrong'}<span class="mark">✗</span>{/if}</button>
    {/each}
  </div>
{/if}

<style>
  .start-card { text-align: center; background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 20px; padding: 2rem 1.2rem; }
  .q {
    background: var(--text-primary); color: #fff; border-radius: 18px;
    padding: 2rem 1rem; text-align: center;
    font-size: clamp(1.7rem, 7vw, 2.6rem); font-weight: 900;
    unicode-bidi: plaintext; margin-bottom: 1rem;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .grid .opt { margin: 0; text-align: center; unicode-bidi: plaintext; font-size: 1.15rem; font-weight: 800; }
</style>

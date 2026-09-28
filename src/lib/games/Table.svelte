<script lang="ts">
  /** Port of games/table.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, type GameEngineContext, type GameData } from './engine.ts';

  type Blank = { answer: string };
  type Cell = string | Blank;
  type Row = { label: string; cells: Cell[] };

  const isBlank = (c: Cell): c is Blank => typeof c === 'object' && c !== null && 'answer' in c;

  type BlankState = { row: number; col: number; answer: string; where: string; value: string; state: 'idle' | 'right' | 'wrong'; revealed?: boolean };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const cols = (data.columns as string[] | undefined) ?? [];
  const rows = (data.rows as Row[] | undefined) ?? [];

  let blanks = $state<BlankState[]>([]);
  let checked = $state(false);
  let tries = $state(0);
  let whyHtml = $state('');
  let revealed = $state(false);
  const elapsed = $derived(engine.secs());
  const score = $derived(blanks.filter((b) => b.state === 'right').length);
  /* Answered by the child, not filled in by the game: a revealed table used
     to finish with every cell "right", three stars and 100% for the tutor. */
  const earned = $derived(blanks.filter((b) => b.state === 'right' && !b.revealed).length);
  const filled = $derived(blanks.filter((b) => b.value.trim()).length);
  const allSolved = $derived(blanks.length > 0 && score === blanks.length);

  function build() {
    const bs: BlankState[] = [];
    rows.forEach((r, ri) => {
      (r.cells || []).forEach((cell, ci) => {
        if (isBlank(cell)) bs.push({ row: ri, col: ci, answer: String(cell.answer), where: r.label, value: '', state: 'idle' });
      });
    });
    blanks = bs;
  }

  const cellBlank = (ri: number, ci: number) => blanks.find((b) => b.row === ri && b.col === ci);

  // Spacing and a trailing period should not fail an otherwise correct answer.
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.।]$/, '').toLowerCase();

  function check() {
    blanks.forEach((b) => {
      b.state = norm(b.value) === norm(b.answer) ? 'right' : 'wrong';
    });
    checked = true;

    if (score === blanks.length) {
      engine.finish({
        template: 'table', score: earned, total: blanks.length,
        missed: blanks.filter((b) => b.revealed).map((b) => b.where),
      });
      return;
    }

    whyHtml = `נכונים: <b>${score}</b> מתוך <b>${blanks.length}</b>. תקנו את האדומים ונסו שוב.`;
    tries++;

    // A second failed pass is where a student gets stuck, so open the answers.
    if (tries >= 3) {
      blanks.forEach((b) => { if (b.state !== 'right') { b.value = b.answer; b.revealed = true; } });
      whyHtml = 'הנה התשובות — קראו אותן ולחצו בדיקה כדי לסיים.';
      revealed = true;
    }
  }

  if (cols.length && rows.length) {
    build();
    if (blanks.length) engine.startTimer();
  }
</script>

{#if !cols.length || !rows.length}
  <div class="msg">חסרות עמודות או שורות בקובץ המשחק.</div>
{:else if !blanks.length}
  <div class="msg">אין תאים למילוי בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{filled}/{blanks.length}</div><div class="stat-lbl">מולאו</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(filled / blanks.length) * 100}%"></div></div>

  <div class="prompt">השלימו את הטבלה 📊</div>
  <div class="hint">מלאו את התאים הריקים ולחצו על בדיקה</div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th></th>
          {#each cols as c}<th>{c}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r, ri (ri)}
          <tr>
            <td class="rowlabel">{r.label}</td>
            {#each r.cells as cell, ci (ci)}
              {@const b = cellBlank(ri, ci)}
              <td>
                {#if b}
                  <input
                    type="text"
                    aria-label={r.label}
                    bind:value={b.value}
                    disabled={b.state === 'right'}
                    class:right={b.state === 'right'}
                    class:wrong={checked && b.state === 'wrong'}
                  />
                {:else}
                  {cell ?? ''}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div style="text-align:center">
    <button class="btn" onclick={check} disabled={allSolved}>{tries ? 'בדיקה שוב ✓' : 'בדיקה ✓'}</button>
  </div>
  {#if whyHtml}<div class="why">{@html whyHtml}</div>{/if}
{/if}

<style>
  .table-wrap { overflow-x: auto; margin: 0.3rem 0 1rem; }
  table {
    width: 100%; border-collapse: collapse; background: var(--bg-card);
    border: 2px solid var(--border); border-radius: 14px; overflow: hidden; min-width: 320px;
  }
  th, td { padding: 10px 8px; text-align: center; font-size: 0.92rem; border: 1px solid var(--border); }
  th { background: var(--accent-dim); color: var(--accent); font-weight: 800; font-size: 0.85rem; }
  td.rowlabel { background: var(--bg-base); font-weight: 800; text-align: right; }
  td input {
    width: 100%; min-width: 84px; border: 2px solid var(--border); border-radius: 9px;
    padding: 7px 6px; font-family: inherit; font-size: 0.9rem; text-align: center; background: #fff;
  }
  td input:focus { outline: none; border-color: var(--accent); }
  td input.right { border-color: var(--accent3); background: var(--accent3-dim); color: var(--accent3-strong); font-weight: 800; }
  td input.wrong { border-color: var(--danger); background: var(--danger-dim); }
</style>

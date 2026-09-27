<script lang="ts">
  /**
   * The tutor's "שיווק" report. See +page.server.ts for the guard and the
   * window computation; this component only renders what that load already
   * decided.
   *
   * Summary line first (spec: visitors / bookings / lessons held for the
   * window), then the funnel table grouped source → campaign → content
   * (rows arrive pre-sorted from +page.server.ts's sortRows), then the
   * "איך שמעתם עלינו?" counts. No client-side fetch: the whole page is one
   * server render per `?days=` navigation, exactly like app/plan/[code].
   */
  import { HEARD_FROM_LABELS } from '$lib/marketing-labels.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const DAY_OPTIONS = [7, 30, 90] as const;

  // funnel()'s own GROUP BY makes a NULL utm_source its own group — see
  // src/lib/server/marketing.ts's doc comment — so this is the one place
  // that turns "no UTM at all" into the label a human reads, per spec.
  const UNTAGGED_SOURCE = 'ישיר / לא מתויג';
  const EMPTY_CELL = '—';

  const sourceLabel = (source: string | null): string => source ?? UNTAGGED_SOURCE;

  // bookings and lessonsHeld are plain COUNT()s in funnel() — each event row
  // belongs to exactly one (source, campaign, content) group, so summing
  // them across the already-grouped rows is exact, unlike visitors (below).
  let rowTotals = $derived(
    data.rows.reduce(
      (acc, row) => ({
        bookings: acc.bookings + row.bookings,
        lessonsHeld: acc.lessonsHeld + row.lessonsHeld,
      }),
      { bookings: 0, lessonsHeld: 0 },
    ),
  );

  let heardFromEntries = $derived(Object.entries(data.heardFrom));

  // The one date every "since" mention on this page refers to — when
  // measurement (migration 016) started. One constant so the note and the
  // empty state can never end up naming two different dates.
  const MEASUREMENT_START = '24.9.2026';
</script>

<svelte:head>
  <title>שיווק — לוח בקרה</title>
</svelte:head>

<div class="page">
  <a class="back" href="/app/dashboard">← לוח בקרה</a>
  <h1 class="title">שיווק</h1>
  <p class="note">נתונים מאז {MEASUREMENT_START} · אירועים נשמרים 12 חודשים</p>

  <nav class="toggle" aria-label="טווח זמן">
    {#each DAY_OPTIONS as d (d)}
      <a class="chip" class:active={data.days === d} href="?days={d}" aria-current={data.days === d ? 'true' : undefined}>
        {d} ימים
      </a>
    {/each}
  </nav>

  <div class="summary">
    <div class="stat">
      <span class="stat-value">{data.visitors}</span>
      <span class="stat-label">מבקרים</span>
    </div>
    <div class="stat">
      <span class="stat-value">{rowTotals.bookings}</span>
      <span class="stat-label">הזמנות</span>
    </div>
    <div class="stat">
      <span class="stat-value">{rowTotals.lessonsHeld}</span>
      <span class="stat-label">שיעורים שהתקיימו</span>
    </div>
  </div>

  {#if data.rows.length === 0}
    <p class="empty">
      המדידה התחילה ב-{MEASUREMENT_START} — עדיין אין נתונים בטווח הזה. הנתונים
      יופיעו כאן ככל שמשפחות מבקרות באתר.
    </p>
  {:else}
    <div class="table-wrap">
      <table class="funnel">
        <thead>
          <tr>
            <th scope="col">מקור</th>
            <th scope="col">קמפיין</th>
            <th scope="col">תוכן</th>
            <th scope="col">מבקרים</th>
            <th scope="col">לחיצות על בדיקת מועד</th>
            <th scope="col">וואטסאפ</th>
            <th scope="col">טלפון</th>
            <th scope="col">התחילו הזמנה</th>
            <th scope="col">הזמנות</th>
            <th scope="col">שיעורים שהתקיימו</th>
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row (`${row.source}|${row.campaign}|${row.content}`)}
            <tr>
              <td>{sourceLabel(row.source)}</td>
              <td>{row.campaign ?? EMPTY_CELL}</td>
              <td>{row.content ?? EMPTY_CELL}</td>
              <td>{row.visitors}</td>
              <td>{row.bookingClicks}</td>
              <td>{row.whatsappClicks}</td>
              <td>{row.phoneClicks}</td>
              <td>{row.bookingsStarted}</td>
              <td>{row.bookings}</td>
              <td>{row.lessonsHeld}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <h2 class="section-title">איך שמעתם עלינו?</h2>
  {#if heardFromEntries.length === 0}
    <p class="empty">אין עדיין תשובות בטווח הזה.</p>
  {:else}
    <ul class="heard-from">
      {#each heardFromEntries as [value, count] (value)}
        <li>
          <span>{HEARD_FROM_LABELS[value] ?? value}</span>
          <b>{count}</b>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  :global(body) { background: var(--bg-base); }

  .page { max-width: 820px; margin: 0 auto; padding: 1.4rem 1rem 4rem; }

  .back {
    display: inline-flex; align-items: center; min-height: 44px;
    font-size: .88rem; font-weight: 700; color: var(--text-muted);
    text-decoration: none;
  }

  .title { font-size: 1.4rem; font-weight: 900; color: var(--text-primary); margin: 6px 0 4px; }
  .note { font-size: .82rem; color: var(--text-muted); margin: 0 0 14px; }

  .toggle { display: flex; gap: 8px; margin-bottom: 16px; }
  .chip {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; padding: 6px 16px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); background: var(--bg-card);
    color: var(--text-muted); font-family: inherit; font-size: .82rem; font-weight: 700;
    text-decoration: none;
  }
  .chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  .summary {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
    margin-bottom: 20px;
  }
  .stat {
    display: flex; flex-direction: column; gap: 2px;
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px;
    padding: 12px 10px; text-align: center;
  }
  .stat-value {
    font-size: 1.5rem; font-weight: 900; color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .stat-label { font-size: .76rem; color: var(--text-muted); font-weight: 700; }

  .empty {
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px;
    padding: 14px; font-size: .88rem; color: var(--text-muted); line-height: 1.6;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1.5px solid var(--border); border-radius: 14px;
    margin-bottom: 24px;
  }
  table.funnel {
    border-collapse: collapse; width: 100%; min-width: 760px;
    font-size: .84rem;
  }
  table.funnel th, table.funnel td {
    padding: 9px 10px; text-align: start; white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }
  table.funnel thead th {
    background: var(--bg-card-solid); color: var(--text-muted);
    font-weight: 700; font-size: .76rem;
  }
  table.funnel tbody td { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  table.funnel tbody tr:last-child td { border-bottom: none; }

  .section-title { font-size: 1.05rem; font-weight: 900; color: var(--text-primary); margin: 0 0 10px; }

  .heard-from { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .heard-from li {
    display: flex; align-items: center; justify-content: space-between;
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 12px;
    padding: 10px 14px; font-size: .88rem; color: var(--text-primary);
  }
  .heard-from b { font-variant-numeric: tabular-nums; }
</style>

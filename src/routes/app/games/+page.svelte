<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';
  /**
   * Port of pages/app/games.html — the games CATALOG (a tool for picking a
   * template), not a game. Data now arrives already loaded (and gated by
   * requireAuth) from +page.server.ts instead of an unauthenticated client
   * fetch of /games/registry.json.
   */
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>מאגר המשחקים — מאה בקליק</title>
</svelte:head>

<div class="wrap">
  <div class="page-brand"><BrandMark height={26} /></div>

  <header>
    <h1>🎮 מאגר המשחקים</h1>
    <div class="subject">כל סוגי המשחקים והדוגמאות שלהם</div>
  </header>

  <div style="margin-top:1.4rem">
    <h2>מוכנים לשימוש ({data.ready.length})</h2>
    {#each data.ready as t (t.key)}
      <div class="card">
        <div class="row">
          <span class="name">{t.title}</span>
          <span class="pill ready">מוכן</span>
        </div>
        <div class="best">{t.bestFor}</div>
        <div class="meta">גילאים {t.ageRange[0]}–{t.ageRange[1]} · {t.itemRange[0]}–{t.itemRange[1]} פריטים</div>
        {#if t.exampleUrl}
          <div style="margin-top:.7rem">
            <a class="play" href={t.exampleUrl}>▶ נסו את הדוגמה</a>
            <code class="url">{t.exampleUrl}</code>
          </div>
        {/if}
      </div>
    {/each}

    <h2>מתוכננים ({data.soon.length})</h2>
    {#each data.soon as t (t.key)}
      <div class="card soon">
        <div class="row">
          <span class="name">{t.title}</span>
          <span class="pill soon">בקרוב</span>
        </div>
        <div class="best">{t.bestFor}</div>
        <div class="meta">גילאים {t.ageRange[0]}–{t.ageRange[1]} · {t.itemRange[0]}–{t.itemRange[1]} פריטים</div>
      </div>
    {/each}
  </div>
</div>

<style>
  .wrap { max-width: 820px; margin: 0 auto; padding: 1rem; }
  .page-brand { display: flex; padding-bottom: 0.9rem; }
  header h1 { font-size: 1.6rem; font-weight: 900; }
  .subject { color: var(--text-muted); font-size: .95rem; margin-top: 2px; }

  .card {
    background: var(--bg-card); border: 1.5px solid var(--border);
    border-radius: 16px; padding: 1rem 1.1rem; margin-bottom: 0.8rem;
  }
  .card.soon { opacity: 0.62; }
  .row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .name { font-size: 1.1rem; font-weight: 900; }
  .pill {
    font-size: 0.7rem; font-weight: 800; border-radius: 999px; padding: 2px 10px;
  }
  .pill.ready { background: var(--accent3-dim); color: var(--accent3-strong); }
  .pill.soon  { background: var(--border); color: var(--text-muted); }
  .best { color: var(--text-muted); font-size: 0.9rem; margin: 0.35rem 0 0.6rem; line-height: 1.5; }
  .meta { color: var(--text-muted); font-size: 0.78rem; }
  .play {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--accent2); color: #1E293B; text-decoration: none;
    border-radius: 999px; padding: 0.5rem 1.1rem; min-height: 40px;
    font-weight: 800; font-size: 0.88rem;
  }
  .play:hover { opacity: 0.9; }
  .url {
    display: block; margin-top: 0.55rem; direction: ltr; text-align: left;
    background: var(--accent-dim); color: var(--accent);
    border-radius: 8px; padding: 0.4rem 0.6rem;
    font-size: 0.76rem; word-break: break-all; font-family: ui-monospace, monospace;
  }
  h2 { font-size: 1rem; color: var(--text-muted); margin: 1.6rem 0 0.7rem; font-weight: 700; }
</style>

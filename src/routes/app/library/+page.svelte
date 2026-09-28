<script lang="ts">
  /**
   * The prepared library: per skill of a plan template, one lesson — deck,
   * examples, homework with its answer key, games — made once and used by
   * every booking on that skill. See +page.server.ts and
   * docs/superpowers/specs/2026-09-28-prepared-library-design.md.
   */
  import { onMount, untrack } from 'svelte';
  import type { PageData } from './$types';
  import type { LibraryStatus } from '$server/library/store.ts';

  let { data }: { data: PageData } = $props();
  /* Refreshed by polling while anything is on its way; seeded from the load. */
  let view = $state(untrack(() => data));
  $effect(() => { view = data; });

  let error = $state('');
  let busy = $state<Record<string, boolean>>({});

  const STATUS: Record<LibraryStatus, { label: string; cls: string }> = {
    ready:     { label: 'מוכן ✓', cls: 'ready' },
    preparing: { label: 'בהכנה…', cls: 'working' },
    queued:    { label: 'בתור', cls: 'working' },
    held:      { label: 'נעצר לבדיקה', cls: 'held' },
    failed:    { label: 'נכשל', cls: 'failed' },
  };

  const working = $derived(view.topics.some(t => t.skills.some(s => s.item && ['queued', 'preparing'].includes(s.item.status))));

  async function refresh() {
    try {
      const r = await fetch(`/api/library?template=${encodeURIComponent(view.template.id)}`, { cache: 'no-store' });
      if (r.ok) view = await r.json();
    } catch { /* the next tick tries again */ }
  }

  onMount(() => {
    const id = setInterval(() => { if (working) refresh(); }, 8000);
    return () => clearInterval(id);
  });

  async function prepare(body: { topic?: string; skill?: string }, key: string) {
    busy[key] = true;
    error = '';
    try {
      const r = await fetch('/api/library/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: view.template.id, ...body }),
      });
      if (r.status === 401) { location.href = '/login?next=/app/library'; return; }
      if (!r.ok) error = (await r.json().catch(() => ({}))).error || 'ההכנה לא התחילה';
      await refresh();
    } catch {
      error = 'אין חיבור לשרת';
    } finally {
      busy[key] = false;
    }
  }

  const readyCount = (t: (typeof view.topics)[number]) => t.skills.filter(s => s.item?.status === 'ready').length;
</script>

<svelte:head><title>ספריית חומרים — מאה בקליק</title></svelte:head>

<main class="wrap">
  <a class="back" href="/app/dashboard">→ חזרה ללוח הבקרה</a>
  <h1>ספריית חומרים</h1>
  <p class="lead">
    לכל מיומנות בתכנית: מצגת, דוגמאות, שיעורי בית עם תשובון ומשחקים — מוכנים פעם אחת.
    כשתלמיד/ה מגיע/ה למיומנות מוכנה, השיעור נבנה מכאן, בלי לחכות ליצירה.
    עריכה כאן משנה את השיעורים הבאים; עריכה בשיעור של תלמיד/ה משנה רק אצלו/ה.
  </p>

  <nav class="templates" aria-label="תכנית">
    {#each view.templates as t (t.id)}
      <a href="/app/library?template={t.id}" class:active={t.id === view.template.id} data-sveltekit-reload>{t.track}</a>
    {/each}
  </nav>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#each view.topics as topic (topic.key)}
    <section class="topic">
      <header>
        <h2>{topic.title}</h2>
        <span class="count">{readyCount(topic)}/{topic.skills.length} מוכנים</span>
        <button
          class="btn"
          disabled={busy[topic.key] || readyCount(topic) === topic.skills.length}
          onclick={() => prepare({ topic: topic.key }, topic.key)}
        >{busy[topic.key] ? 'מתחילים…' : 'הכנת הנושא'}</button>
      </header>
      <ul>
        {#each topic.skills as s (s.key)}
          {@const st = s.item ? STATUS[s.item.status] : null}
          <li>
            <div class="skill">
              <span class="title">{s.title}</span>
              <span class="chip {st?.cls ?? 'none'}">{st?.label ?? 'טרם הוכן'}</span>
            </div>
            {#if s.item?.problem}<p class="problem">{s.item.problem}</p>{/if}
            <div class="actions">
              {#if s.item?.status === 'ready' && s.item.slug}
                <a href="/lessons/{s.item.slug}" target="_blank" rel="noopener">צפייה</a>
                <a href="/app/lessons/{s.item.slug}/edit">עריכה</a>
              {/if}
              {#if s.item && !['queued', 'preparing'].includes(s.item.status)}
                <button class="link" disabled={busy[s.key]} onclick={() => prepare({ skill: s.key }, s.key)}>הכנה מחדש</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</main>

<style>
  .wrap { max-width: 820px; margin: 0 auto; padding: 20px 16px 60px; }
  .back { display: inline-block; min-height: 44px; line-height: 44px; color: var(--accent); font-weight: 700; text-decoration: none; }
  h1 { font-size: 1.6rem; font-weight: 900; margin: 4px 0 8px; }
  .lead { color: var(--text-muted); line-height: 1.7; margin: 0 0 16px; }
  .templates { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
  .templates a {
    padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card);
    color: var(--text-primary); text-decoration: none; font-weight: 700; font-size: .9rem;
  }
  .templates a.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .topic { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 14px 16px; margin-bottom: 14px; }
  .topic header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .topic h2 { font-size: 1.1rem; font-weight: 800; margin: 0; flex: 1; }
  .count { color: var(--text-muted); font-size: .85rem; }
  .btn {
    min-height: 40px; padding: 0 16px; border-radius: 999px; border: 0; background: var(--accent); color: #fff;
    font: inherit; font-weight: 800; cursor: pointer;
  }
  .btn:disabled { opacity: .5; cursor: default; }
  ul { list-style: none; padding: 0; margin: 12px 0 0; }
  li { border-top: 1px solid var(--border); padding: 10px 0; }
  .skill { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
  .title { font-weight: 700; line-height: 1.5; }
  .chip { flex: none; font-size: .78rem; font-weight: 800; padding: 3px 10px; border-radius: 999px; background: var(--bg-surface); color: var(--text-muted); }
  .chip.ready { background: var(--accent3-dim); color: var(--accent3-strong); }
  .chip.working { background: var(--accent-dim); color: var(--accent); }
  .chip.held, .chip.failed { background: var(--danger-dim, #fef2f2); color: var(--danger); }
  .problem { color: var(--danger); font-size: .85rem; margin: 6px 0 0; }
  .actions { display: flex; gap: 14px; margin-top: 6px; font-size: .88rem; }
  .actions a { color: var(--accent); font-weight: 700; }
  .link { background: none; border: 0; padding: 0; color: var(--text-muted); font: inherit; font-weight: 700; cursor: pointer; text-decoration: underline; }
  .error { color: var(--danger); font-weight: 700; }
</style>

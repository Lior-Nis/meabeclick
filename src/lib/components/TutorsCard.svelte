<script lang="ts">
  /**
   * Each tutor's Meet room, and the setup link that connects it
   * (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md). The
   * link goes straight to the tutor's WhatsApp when the tutor has a phone.
   */
  type Tutor = { id: number; name: string; phone: string | null; meetUrl: string | null; account: string | null };
  let { tutors, defaultId, googleReady }: { tutors: Tutor[]; defaultId: number | null; googleReady: boolean } = $props();

  let links = $state<Record<number, string>>({});
  let busy = $state<number | null>(null);
  let copied = $state<number | null>(null);
  let problem = $state('');

  const message = (t: Tutor, link: string): string =>
    `היי ${t.name}, זה הקישור לחיבור חדר ה-Meet שלך לאתר מאה בקליק. לוקח דקה, פעם אחת: ${link}`;

  /** 0501234567 and 972501234567 both reach the same chat; no phone opens
   *  WhatsApp's contact picker. */
  function waHref(t: Tutor, link: string): string {
    const digits = (t.phone ?? '').replace(/\D/g, '');
    const to = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(message(t, link))}`;
  }

  async function mint(t: Tutor) {
    busy = t.id;
    problem = '';
    try {
      const r = await fetch(`/api/teachers/${t.id}/setup-link`, { method: 'POST' });
      if (r.status === 401) { problem = 'ההתחברות פגה. רעננו את הדף והתחברו שוב.'; return; }
      if (!r.ok) { problem = 'לא הצלחתי להכין קישור. נסו שוב.'; return; }
      links = { ...links, [t.id]: (await r.json()).link };
    } catch {
      problem = 'אין חיבור לשרת.';
    } finally {
      busy = null;
    }
  }

  async function copy(t: Tutor) {
    try {
      await navigator.clipboard.writeText(message(t, links[t.id]));
      copied = t.id;
      setTimeout(() => { if (copied === t.id) copied = null; }, 2000);
    } catch {
      problem = `ההעתקה לא הצליחה. הקישור: ${links[t.id]}`;
    }
  }
</script>

<div class="tutors">
  {#if !googleReady}
    <p class="off">החיבור ל-Google עוד לא הוגדר בשרת, ולכן אי אפשר עדיין לשלוח קישור הגדרה.</p>
  {/if}
  {#each tutors as t (t.id)}
    <div class="row">
      <div class="who">
        <b>{t.name}</b>
        {#if t.id === defaultId}<span class="tag">החדר שנשלח למשפחות</span>{/if}
        {#if t.meetUrl}
          <div class="status ok">✓ חדר Meet{#if t.account} · <span dir="ltr">{t.account}</span>{/if} · <a href={t.meetUrl} target="_blank" rel="noopener">פתיחה</a></div>
        {:else}
          <div class="status missing">✗ אין חדר Meet</div>
        {/if}
      </div>
      {#if googleReady}
        <div class="actions">
          {#if links[t.id]}
            <a class="act wa" href={waHref(t, links[t.id])} target="_blank" rel="noopener">שליחה בוואטסאפ</a>
            <button class="act" onclick={() => copy(t)}>{copied === t.id ? 'הועתק ✓' : 'העתקה'}</button>
          {:else}
            <button class="act" disabled={busy === t.id} onclick={() => mint(t)}>{busy === t.id ? 'מכין…' : 'שליחת קישור הגדרה'}</button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</div>

<style>
  .tutors { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 6px 14px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .row:last-of-type { border-bottom: 0; }
  .who { min-width: 0; }
  .tag { font-size: .7rem; font-weight: 700; color: var(--accent); border: 1px solid currentColor; border-radius: 999px; padding: 1px 8px; margin-inline-start: 6px; }
  .status { font-size: .85rem; margin-top: 4px; overflow-wrap: anywhere; }
  .status.ok { color: var(--text); }
  .status.missing { color: var(--text-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .act { min-height: 44px; display: inline-flex; align-items: center; border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 0 16px; cursor: pointer; font: inherit; font-size: .85rem; color: inherit; text-decoration: none; }
  .act.wa { background: #25d366; border-color: #25d366; color: #fff; font-weight: 700; }
  .act:disabled { opacity: .6; cursor: default; }
  .off, .problem { font-size: .85rem; margin: 10px 0; }
  .problem { color: var(--danger); font-weight: 700; overflow-wrap: anywhere; }
</style>

<script lang="ts">
  /**
   * Each tutor: whether they take bookings, their booking settings and their
   * Meet room (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md,
   * 2026-10-16-tutor-meet-setup-design.md). The busy addresses are secrets:
   * the card only ever learns how many are saved, and replacing them means
   * pasting them again. The setup link goes straight to the tutor's
   * WhatsApp when the tutor has a phone.
   */
  import { untrack } from 'svelte';
  import { WEEKDAYS, WEEKDAY_NAMES, type TeachingHours, type Weekday } from '$lib/teaching-hours.ts';

  type Missing = 'calendar' | 'busy';
  type Tutor = {
    id: number; name: string; phone: string | null; meetUrl: string | null; account: string | null;
    calendarId: string | null; busyCount: number; teachingHours: TeachingHours; missing: Missing[];
  };
  type Draft = {
    calendarId: string;
    addresses: string;
    /** Showing the address box: no addresses saved yet, or "החלפה" pressed. */
    replacing: boolean;
    days: Record<Weekday, { on: boolean; from: string; to: string }>;
  };
  let { tutors, googleReady, onsaved }: {
    tutors: Tutor[]; googleReady: boolean;
    /** Told after each save, so the rest of the page sees the tutor as saved. */
    onsaved?: (t: Tutor) => void;
  } = $props();

  // A one-time seed: from here on the card's own saves keep it current.
  let list = $state<Tutor[]>(untrack(() => tutors));
  let links = $state<Record<number, string>>({});
  let busy = $state<number | null>(null);
  let copied = $state<number | null>(null);
  let problem = $state('');
  let open = $state<number | null>(null);
  let draft = $state<Draft | null>(null);
  let saving = $state(false);
  let saved = $state<number | null>(null);

  const MISSING: Record<Missing, string> = { calendar: 'אין יומן שיעורים', busy: 'אין כתובת יומן פרטית' };
  const savedCount = (n: number) => (n === 1 ? 'כתובת אחת שמורה' : `${n} כתובות שמורות`);

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

  function edit(t: Tutor) {
    problem = '';
    open = t.id;
    draft = {
      calendarId: t.calendarId ?? '',
      addresses: '',
      replacing: t.busyCount === 0,
      days: Object.fromEntries(WEEKDAYS.map(d => [d, {
        on: !!t.teachingHours[d],
        from: t.teachingHours[d]?.[0] ?? '08:00',
        to: t.teachingHours[d]?.[1] ?? '16:00',
      }])) as Draft['days'],
    };
  }

  function close() { open = null; draft = null; }

  async function save(t: Tutor) {
    if (!draft) return;
    saving = true;
    problem = '';
    const d = draft;
    const body: Record<string, unknown> = {
      calendarId: d.calendarId.trim() || null,
      teachingHours: Object.fromEntries(WEEKDAYS.filter(w => d.days[w].on).map(w => [w, [d.days[w].from, d.days[w].to]])),
    };
    /* An empty box while replacing saved addresses keeps them: clearing a
       tutor's busy times by accident would make them look free all week. */
    if (d.replacing && (d.addresses.trim() || t.busyCount === 0)) body.busyIcs = d.addresses;
    try {
      const r = await fetch(`/api/teachers/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.status === 401) { problem = 'ההתחברות פגה. רעננו את הדף והתחברו שוב.'; return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { problem = j.error || 'השמירה לא הצליחה. נסו שוב.'; return; }
      list = list.map(x => (x.id === t.id ? { ...x, ...j.tutor } : x));
      onsaved?.(j.tutor);
      close();
      saved = t.id;
      setTimeout(() => { if (saved === t.id) saved = null; }, 2500);
    } catch {
      problem = 'אין חיבור לשרת.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="tutors">
  {#if !googleReady}
    <p class="off">החיבור ל-Google עוד לא הוגדר בשרת, ולכן אי אפשר עדיין לשלוח קישור הגדרה.</p>
  {/if}
  {#each list as t (t.id)}
    <div class="row">
      <div class="who">
        <b>{t.name}</b>
        {#if t.missing.length === 0}
          <div class="status ok">מקבל/ת הזמנות ✓</div>
        {:else}
          <div class="status missing">לא מקבל/ת הזמנות עדיין: {t.missing.map(m => MISSING[m]).join(' · ')}</div>
        {/if}
        {#if t.meetUrl}
          <div class="status ok">✓ חדר Meet{#if t.account} · <span dir="ltr">{t.account}</span>{/if} · <a href={t.meetUrl} target="_blank" rel="noopener">פתיחה</a></div>
        {:else}
          <div class="status missing">✗ אין חדר Meet</div>
        {/if}
        {#if t.busyCount}<div class="status">{savedCount(t.busyCount)}</div>{/if}
        {#if saved === t.id}<div class="status ok" role="status">✓ נשמר</div>{/if}
      </div>
      <div class="actions">
        <button class="act" aria-expanded={open === t.id} onclick={() => (open === t.id ? close() : edit(t))}>הגדרות הזמנה</button>
        {#if googleReady}
          {#if links[t.id]}
            <a class="act wa" href={waHref(t, links[t.id])} target="_blank" rel="noopener">שליחה בוואטסאפ</a>
            <button class="act" onclick={() => copy(t)}>{copied === t.id ? 'הועתק ✓' : 'העתקה'}</button>
          {:else}
            <button class="act" disabled={busy === t.id} onclick={() => mint(t)}>{busy === t.id ? 'מכין…' : 'שליחת קישור הגדרה'}</button>
          {/if}
        {/if}
      </div>
      {#if open === t.id && draft}
        <form class="settings" onsubmit={(e) => { e.preventDefault(); save(t); }}>
          <label class="field">
            <span class="label">יומן השיעורים (מזהה היומן ב-Google)</span>
            <input dir="ltr" bind:value={draft.calendarId} placeholder="…@group.calendar.google.com" />
          </label>
          <div class="field">
            <span class="label" id="busy-label-{t.id}">כתובות יומן פרטיות (iCal) — מהן יודעים מתי {t.name} עסוק/ה</span>
            {#if !draft.replacing}
              <div class="saved">{savedCount(t.busyCount)} <button type="button" class="act small" onclick={() => { if (draft) draft.replacing = true; }}>החלפה</button></div>
            {:else}
              <textarea dir="ltr" rows="3" aria-labelledby="busy-label-{t.id}" bind:value={draft.addresses} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></textarea>
              <span class="hint">כתובת אחת בכל שורה. אחרי השמירה הן לא מוצגות שוב.</span>
            {/if}
          </div>
          <fieldset class="hours">
            <legend class="label">שעות הוראה (שעה אחרונה = סוף השיעור)</legend>
            {#each WEEKDAYS as d (d)}
              <div class="day">
                <label class="day-on"><input type="checkbox" bind:checked={draft.days[d].on} /> {WEEKDAY_NAMES[d]}</label>
                {#if draft.days[d].on}
                  <span class="range">
                    <input type="time" bind:value={draft.days[d].from} aria-label={`${WEEKDAY_NAMES[d]} — משעה`} />
                    <span aria-hidden="true">–</span>
                    <input type="time" bind:value={draft.days[d].to} aria-label={`${WEEKDAY_NAMES[d]} — עד שעה`} />
                  </span>
                {:else}
                  <span class="off-day">לא מלמד/ת</span>
                {/if}
              </div>
            {/each}
          </fieldset>
          <div class="form-actions">
            <button class="act primary" type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמירה'}</button>
            <button class="act" type="button" onclick={close}>ביטול</button>
          </div>
        </form>
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
  .status { font-size: .85rem; margin-top: 4px; overflow-wrap: anywhere; }
  .status.ok { color: var(--text); }
  .status.missing { color: var(--text-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .act { min-height: 44px; display: inline-flex; align-items: center; border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 0 16px; cursor: pointer; font: inherit; font-size: .85rem; color: inherit; text-decoration: none; }
  .act.wa { background: #25d366; border-color: #25d366; color: #fff; font-weight: 700; }
  .act.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .act.small { padding: 0 12px; }
  .act:disabled { opacity: .6; cursor: default; }
  .settings { flex-basis: 100%; display: grid; gap: 14px; padding: 4px 0 6px; min-width: 0; }
  .field { display: grid; gap: 6px; min-width: 0; }
  .label { font-size: .85rem; font-weight: 700; }
  .settings input:not([type="checkbox"]), .settings textarea { width: 100%; max-width: 100%; box-sizing: border-box; min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 10px; padding: 8px 10px; font: inherit; background: var(--bg-card); color: inherit; }
  .settings input[type="time"] { width: auto; }
  .saved { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: .9rem; }
  .hint { font-size: .8rem; color: var(--text-muted); }
  .hours { border: 0; padding: 0; margin: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-width: 0; }
  .day { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  /* A day's from–to stay together: on a narrow phone the pair moves under
     the day's name instead of splitting across two lines. */
  .range { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; }
  .range input[type="time"] { flex: 1 1 7.5em; min-width: 0; }
  .day-on { display: inline-flex; align-items: center; gap: 6px; min-width: 5.5em; min-height: 44px; }
  .off-day { color: var(--text-muted); font-size: .85rem; }
  .form-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .off, .problem { font-size: .85rem; margin: 10px 0; }
  .problem { color: var(--danger); font-weight: 700; overflow-wrap: anywhere; }
</style>

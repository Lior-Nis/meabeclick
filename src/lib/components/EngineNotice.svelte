<script lang="ts">
  /**
   * The lesson engine is down: why, until when, and which coming lessons
   * have nothing prepared — so the tutor reads it here rather than learning
   * it from a booking that failed. From engine-health.ts engineAlert().
   * Amber, not the calendar banner's red: nothing she did is wrong, and
   * library lessons still arrive.
   */
  import { formatDateTime } from '$lib/dates.ts';

  type Alert = { kind: string; until: string | null; affected: { student: string; lessonAt: string }[] } | null;
  let { alert }: { alert: Alert } = $props();

  /* «12/10/2026 בשעה 22:26»: two numbers with only a space between them
     swap places in a right-to-left line («22:26 12/10/2026»). */
  const when = (iso: string) => formatDateTime(iso).replace(' ', ' בשעה ');

  const REASON: Record<string, string> = {
    'engine-quota': 'נגמרה המכסה של מנוע השיעורים (Codex)',
    'engine-auth': 'החיבור למנוע השיעורים (Codex) נותק, וצריך להתחבר אליו מחדש בשרת',
    'engine-missing': 'מנוע השיעורים (Codex) לא מותקן בשרת',
  };
</script>

{#if alert}
  <div class="engine-notice" role="status">
    <div class="en-title">⚠️ יצירת שיעורים אוטומטית לא זמינה</div>
    <p>
      {REASON[alert.kind] ?? 'מנוע השיעורים לא זמין'}{#if alert.kind === 'engine-quota'}{alert.until ? `, עד ${when(alert.until)}` : ', עד שהמכסה תתחדש'}{/if}.
    </p>
    <p>
      שיעורים על מיומנויות שמוכנות <a href="/app/library">בספרייה</a> ממשיכים להגיע כרגיל.
      שיעור על מיומנות שלא הוכנה לא ייווצר עד אז, וצריך להכין אותו ידנית.
    </p>
    {#if alert.affected.length}
      <div class="en-sub">שיעורים קרובים בלי חומר מוכן:</div>
      <ul>
        {#each alert.affected as a (a.student + a.lessonAt)}
          <li><span>{a.student}</span><span class="en-when">{when(a.lessonAt)}</span></li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .engine-notice { background: #FFFBEB; border: 1.5px solid #FCD34D; border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; color: var(--text-primary); }
  .en-title { font-weight: 800; color: #92400E; margin-bottom: 6px; }
  p { margin: 0 0 6px; font-size: .92rem; line-height: 1.6; }
  a { color: var(--accent-deep); font-weight: 700; }
  .en-sub { font-weight: 700; font-size: .88rem; margin: 10px 0 4px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-top: 1px solid #FDE68A; font-size: .9rem; }
  .en-when { color: var(--text-muted); white-space: nowrap; }
</style>

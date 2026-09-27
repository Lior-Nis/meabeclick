<script lang="ts">
  /**
   * The dashboard's "lessons still need a report" banner.
   *
   * Same shape as the calendar-failure banner beside it (.cf-banner in
   * src/routes/app/dashboard/+page.svelte) — a titled block, one row per
   * item, a same-weight action on each row. It holds no state of its own:
   * `lessons` comes straight from lessonsAwaitingReport(), so a lesson
   * disappears from here the moment it is reported, without any client-side
   * bookkeeping to keep in sync.
   */
  interface PendingLesson {
    bookingId: number;
    studentId: number;
    studentCode: string;
    studentName: string;
    // NULL for exactly the enrollment-less bookings migration 006 leaves
    // behind (a student with more than one subject) — see reports/store.ts.
    subject: string | null;
    enrollmentId: number | null;
    start: string;
    end: string;
  }

  let { lessons }: { lessons: PendingLesson[] } = $props();

  function fmtWhen(iso: string): string {
    try {
      const d = new Date(iso);
      const date = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      return `${date} ${time}`;
    } catch {
      return iso;
    }
  }

  /** The student name, alone when there is no subject (an enrollment-less
   *  booking) rather than rendering an empty "· ·" segment. */
  function fmtWho(l: PendingLesson): string {
    return l.subject ? `${l.studentName} · ${l.subject}` : l.studentName;
  }
</script>

{#if lessons.length}
  <div class="rq-banner">
    <div class="rq-title">
      ⚠ {lessons.length === 1 ? 'שיעור אחד מחכה לדיווח' : `${lessons.length} שיעורים מחכים לדיווח`}
    </div>
    {#each lessons as l (l.bookingId)}
      <div class="rq-row">
        <!-- fmtWhen's output is an LTR run (digits and ':') sitting inside
             RTL text with '·' separators around it — left unwrapped, the
             bidi algorithm can reorder it against its neighbours. <bdi>
             isolates it so it always reads left-to-right in place. -->
        <span class="rq-info">{fmtWho(l)} · <bdi>{fmtWhen(l.start)}</bdi></span>
        <a class="rq-link" href="/app/report/{l.bookingId}">דיווח</a>
      </div>
    {/each}
  </div>
{/if}

<style>
  .rq-banner {
    background: var(--accent2-dim); border: 1.5px solid var(--accent2-strong);
    border-radius: 14px; padding: 14px 16px; margin-bottom: 16px;
  }
  .rq-title { font-weight: 800; color: var(--accent2-strong); font-size: .92rem; margin-bottom: 4px; }
  .rq-row {
    display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
    gap: 10px; padding: 8px 0; border-top: 1px solid var(--accent2-glow); font-size: .88rem;
    color: var(--text-primary);
  }
  .rq-info { min-width: 0; }
  .rq-link {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; min-width: 44px; padding: 4px 18px; border-radius: 999px;
    border: 1.5px solid var(--accent2-strong); color: var(--accent2-strong);
    font-weight: 700; font-size: .82rem;
  }
</style>

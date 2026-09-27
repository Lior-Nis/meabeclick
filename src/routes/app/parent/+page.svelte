<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  /**
   * The parent view: one child's lessons, homework, progress and balance,
   * plus the controls for handing that child their own way in.
   *
   * Guarded in +page.server.ts, not here. This page no longer authenticates
   * anything: it used to list every enrolled child from an open endpoint and
   * then ask for a shared password, which is why it carried three views
   * ('choose', 'pin', 'main'). Only 'main' survives, and which children it
   * can show comes from the session.
   *
   * Ruling P13 — same normalization/leading-slash caveat as
   * src/routes/app/student/+page.svelte; see the comment there. toHref()
   * ($lib/urls.ts, shared with student/ and dashboard/) is the identical fix.
   *
   * Not ported: the original's `?demo` mode, a no-op since before the
   * SvelteKit migration (it set `currentId` but never the `CURRENT` the
   * render function read, so the page rendered an empty shell).
   *
   * The payments section no longer computes totals from `sessions`. Those
   * rows carry a hardcoded `amount: 0` — nothing in the portal file has ever
   * held a per-lesson price — so the summary read "₪0 / ₪0 / ₪0" above a
   * list of ₪0 charges. The real figures now come from `/api/portal`'s
   * `balance` (an `AccountBalance` in integer agorot) and `charges` (this
   * child's own rows from the payments table), both backed by the account's
   * actual charge history rather than a hand-maintained ledger.
   */
  import { toHref } from '$lib/urls.ts';
  import { formatAgorot } from '$lib/plans.ts';
  import type { ProgressFacts } from '$lib/progress-facts.ts';
  import { homeworkState, HOMEWORK_STATE_LABEL, type FamilyHomework } from '$lib/family-homework.ts';
  import type { PageData } from './$types';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import { contactTutor, tutorNames } from '$lib/tutors.ts';

  const noStudentsWhatsAppHref =
    `https://wa.me/${TUTOR_PHONE}?text=${encodeURIComponent('היי, הזמנתי שיעור אבל הדף האישי עוד לא נפתח')}`;

  const KIND_LABEL: Record<string, string> = {
    single: 'יחיד', double: 'כפול', triple: 'משולש',
  };
  const STATUS_LABEL: Record<string, string> = {
    owed: 'לתשלום', paid: 'שולם', void: 'בוטל',
  };

  let { data }: { data: PageData } = $props();

  const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const DAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function formatDateHe(dateStr?: string | null): string {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return `${d} ${MONTHS_HE[m - 1]} ${y} (${DAYS_HE[date.getDay()]})`;
  }

  interface Session { date: string; type: string; notes: string; amount: number; paid: boolean }
  type Hw = FamilyHomework & { date?: string | null; url?: string | null };
  interface Balance {
    owedAgorot: number; paidAgorot: number;
    dueAgorot: number; upcomingAgorot: number;
  }
  interface Charge {
    id: number; date: string; kind: string; amount_agorot: number; status: string;
  }
  interface PortalData {
    name: string; emoji?: string; subject?: string; level?: string; tutor?: string;
    style?: string; progress?: ProgressFacts; progressNote?: string; balance?: Balance | null;
    charges?: Charge[];
    nextLesson?: { date?: string; time?: string; type?: string } | null;
    lessons?: Array<{ date: string; topic?: string; summary?: string }>;
    homework?: FamilyHomework[];
  }
  interface Dashboard extends PortalData {
    sessions: Session[];
    homework: Hw[];
  }

  function toDashboardShape(d: PortalData): Dashboard {
    return {
      ...d,
      sessions: (d.lessons ?? []).map(l => ({
        date: l.date, type: 'שיעור',
        notes: [l.topic, l.summary].filter(Boolean).join(' — '),
        amount: 0, paid: false,
      })),
      homework: (d.homework ?? []).map(h => ({ ...h, date: h.assigned ?? h.due })),
    };
  }

  /* No 'choose' and no 'pin' view any more. Which children this parent may
     open is decided in +page.server.ts from their session, so the page
     opens straight onto a board. */
  let currentId = $state<string | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  let CURRENT = $state<Dashboard | null>(null);

  const seen = $derived(CURRENT?.progress?.seen ?? null);
  /* The same three readings the student page gives, so a parent is never
     told "progress" about what is really a homework count. */
  const progressWords = $derived.by(() => {
    const p = CURRENT?.progress;
    if (!p || p.kind === 'none' || !p.total) return 'עוד אין מה למדוד — זה יתחיל אחרי השיעור הראשון';
    return p.kind === 'skills'
      ? `${p.done} מתוך ${p.total} יכולות בתכנית הובנו`
      : `${p.done} מתוך ${p.total} שיעורי בית הוגשו`;
  });

  async function fetchPortal(code: string): Promise<PortalData | null> {
    const r = await fetch(`/api/portal/${encodeURIComponent(code)}?kind=parent`, { cache: 'no-store' });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  async function openStudent(code: string) {
    currentId = code;
    loading = true;
    loadError = '';
    share = null;
    shareOpen = false;

    try {
      const d = await fetchPortal(code);
      if (!d) {
        // The session stopped being valid while the page was open — a
        // six-month cookie outliving a student the tutor removed, say.
        location.href = '/portal';
        return;
      }
      CURRENT = toDashboardShape(d);
      document.title = `פורטל הורים — ${CURRENT.name}`;
      // Keeps the address bar honest when switching between siblings, so a
      // bookmark or a reload lands on the same child.
      history.replaceState(null, '', `/app/parent?s=${encodeURIComponent(code)}`);
    } catch {
      loadError = 'לא הצלחנו לטעון את הדף. נסו לרענן.';
    } finally {
      loading = false;
    }
  }

  async function signOut() {
    await fetch('/api/family', { method: 'DELETE' }).catch(() => {});
    location.href = '/';
  }

  /* ── The family overview ──────────────────────────────────────────────
     Shown only when the account has siblings and no child was named, and
     rendered from the server load rather than fetched — see +page.server.ts.
     A parent of one still lands straight on the board. */
  const overview = $derived(data.overview);

  /* Which child is on screen follows the NAVIGATION, not the mount.
     /app/parent → /app/parent?s=<code> is a navigation within the same
     route, so SvelteKit reuses this component: the server load re-runs and
     `data` is swapped, but the component never mounts again. This was
     `onMount`, so tapping a child from the family overview re-ran the load,
     changed the URL, and then made no request at all — leaving a spinner
     that only a full reload could clear. The sibling <select> kept working
     the whole time because it calls openStudent directly, which is what
     made the bug look intermittent rather than total.

     `lastOpened` is a plain variable, not $state: it exists to stop this
     effect re-entering itself, so it must not be something the effect
     tracks. */
  let lastOpened: string | null = null;

  $effect(() => {
    /* Read exactly the navigation inputs and nothing else. openStudent
       writes loading/CURRENT/share, and none of those are read here, so
       this cannot loop. */
    const wantsOverview = data.view === 'overview';
    /* `||` rather than `??`: a student row with an empty code slips past
       the load's `selected?.code ?? null`, and an empty string is a code
       that opens nothing. Falling back to the first child beats ending the
       spinner on nothing — the screen that reaches tells a family their
       page is not ready, which for them is false. */
    const target = wantsOverview ? null : (data.selected || data.students[0]?.code || null);

    if (!target) {
      lastOpened = null;
      loading = false;
      /* Back from a child's board leaves the tab named after that child
         otherwise — openStudent is the only other thing that sets this, and
         it does not run on the way out. */
      if (wantsOverview) document.title = 'פורטל הורים — מאה בקליק';
      return;
    }
    if (target === lastOpened) return;
    lastOpened = target;
    openStudent(target);
  });

  /* ── Handing a child their own way in ──────────────────────────────────
     The parent's link opens the parent view; a child needs a session
     scoped to themselves. Both artifacts are minted server-side. */
  interface Share { name: string; link: string; joinCode: string }
  let share = $state<Share | null>(null);
  let shareOpen = $state(false);
  let shareBusy = $state(false);
  let shareErr = $state('');
  let copied = $state(false);

  async function loadShare() {
    if (!currentId || shareBusy) return;
    shareBusy = true;
    shareErr = '';
    try {
      const r = await fetch('/api/student-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentId }),
      });
      if (!r.ok) throw new Error(String(r.status));
      share = await r.json();
      shareOpen = true;
    } catch {
      shareErr = 'לא הצלחנו להכין את הקישור. נסו שוב.';
    } finally {
      shareBusy = false;
    }
  }

  async function copyShare() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      copied = true;
      setTimeout(() => { copied = false; }, 2400);
    } catch { /* the link is rendered in full below for exactly this case */ }
  }

  const shareHref = $derived(share
    ? `https://wa.me/?text=${encodeURIComponent(`${share.name}, זה הדף שלך במאה בקליק:\n${share.link}`)}`
    : '');

  const totalSessions = $derived(CURRENT?.sessions.length ?? 0);
  const hwPending = $derived((CURRENT?.homework ?? []).filter(h => homeworkState(h) === 'open').length);
  const hwTotal = $derived((CURRENT?.homework ?? []).length);
  const sortedSessions = $derived([...(CURRENT?.sessions ?? [])].sort((a, b) => b.date.localeCompare(a.date)));
  const reversedHomework = $derived([...(CURRENT?.homework ?? [])].reverse());
  /** Day one is not "everything submitted" and not "₪0 of ₪0" — it is a
   *  family that has not had a lesson yet, which is a different thing and
   *  reads as a bug when the page claims otherwise. */
  const isDayOne = $derived(!!CURRENT && !totalSessions && !hwTotal);
</script>

<svelte:head>
  <title>פורטל הורים — מאה בקליק</title>
</svelte:head>

{#if overview}
  <nav class="top-nav">
    <div class="nav-brand"><BrandMark height={22} /> <span>פורטל הורים</span></div>
    <div class="nav-actions">
      <button class="nav-logout" onclick={signOut}>יציאה</button>
    </div>
  </nav>

  <main class="page">
    <div class="fam-head">
      <!-- enroll.ts names an account after its first learner, so on an
           overview the account name is usually one of the cards below it.
           Repeating it as the page title reads as a mistake; a generic
           heading is true either way, and a genuinely distinct family name
           still gets shown. -->
      <h1 class="fam-title">
        {overview.children.some(c => c.name === overview.accountName)
          ? 'התלמידים שלי'
          : overview.accountName}
      </h1>
      <p class="fam-sub">{overview.children.length} תלמידים בחשבון</p>
    </div>

    <div class="stats-bar">
      <div class="stat-card">
        <div class="s-label">לתשלום עכשיו</div>
        <div class="s-value" class:coral={overview.family.dueAgorot > 0} class:green={overview.family.dueAgorot <= 0}>
          {formatAgorot(overview.family.dueAgorot)}
        </div>
        <div class="s-sub">{overview.family.dueAgorot > 0 ? 'שיעורים שניתנו' : 'מעודכן ✓'}</div>
      </div>
      <div class="stat-card">
        <div class="s-label">מתוכנן קדימה</div>
        <div class="s-value accent">{formatAgorot(overview.family.upcomingAgorot)}</div>
        <div class="s-sub">שיעורים שנקבעו</div>
      </div>
      <div class="stat-card">
        <div class="s-label">שולם עד כה</div>
        <div class="s-value green">{formatAgorot(overview.family.paidAgorot)}</div>
        <div class="s-sub">כל המשפחה</div>
      </div>
    </div>

    <div class="kid-grid">
      {#each overview.children as kid (kid.code)}
        <!-- One card per child, each carrying enough state that a parent
             can see who needs attention without opening anything. -->
        <a class="kid-card" href="/app/parent?s={encodeURIComponent(kid.code)}">
          <div class="kid-top">
            <span class="kid-emoji">{kid.emoji}</span>
            <div>
              <div class="kid-name">{kid.name}</div>
              <div class="kid-meta">{[kid.subject, kid.level].filter(Boolean).join(' · ')}</div>
            </div>
          </div>

          <div class="kid-rows">
            <div class="kid-row">
              <span>השיעור הבא</span>
              <b>{kid.nextLesson ? `${formatDateHe(kid.nextLesson.date)}${kid.nextLesson.time ? ' · ' + kid.nextLesson.time : ''}` : 'טרם נקבע'}</b>
            </div>
            <div class="kid-row">
              <span>שיעורי בית פתוחים</span>
              <b class:coral={kid.openHomework > 0}>{kid.openHomework}</b>
            </div>
            <!-- What this child's money actually needs saying. "לתשלום ₪0"
                 is true for a lesson that has not happened yet and tells a
                 parent nothing; the booked commitment does. -->
            {#if kid.dueAgorot > 0}
              <div class="kid-row">
                <span>לתשלום</span>
                <b class="coral">{formatAgorot(kid.dueAgorot)}</b>
              </div>
            {:else if kid.upcomingAgorot > 0}
              <div class="kid-row">
                <span>מתוכנן</span>
                <b>{formatAgorot(kid.upcomingAgorot)}</b>
              </div>
            {:else}
              <div class="kid-row">
                <span>לתשלום</span>
                <b>{formatAgorot(0)}</b>
              </div>
            {/if}
          </div>

          <span class="kid-open">פתיחת הלוח ←</span>
        </a>
      {/each}
    </div>

    <div class="fam-actions">
      <a class="fam-book" href="/booking"><Icon name="booking" size={17} /> הזמנת שיעור נוסף</a>
    </div>
  </main>

  <div class="footer">
    <p>פורטל הורים · {tutorNames()} שיעורים פרטיים</p>
  </div>
{:else if loading}
  <div class="boot" role="status">
    <BrandMark height={26} />
    <div class="boot-spinner"></div>
    <p>טוען…</p>
  </div>
{:else if loadError}
  <div class="boot">
    <BrandMark height={26} />
    <p class="boot-err">{loadError}</p>
    <button class="boot-retry" onclick={() => currentId && openStudent(currentId)}>נסו שוב</button>
  </div>
{:else if data.students.length === 0}
  <!-- An account with no students: reachable when the tutor removes the
       last one, and after a booking that failed to enrol. Those two cases
       look identical from here, so the copy must stay neutral — it must
       never tell a family who already booked to go book again, and it
       must never promise a page that isn't ready yet either. -->
  <div class="boot">
    <BrandMark height={26} />
    <div class="boot-icon"><Icon name="portal" size={40} /></div>
    <p class="boot-title">הדף האישי עדיין בהכנה</p>
    <p class="boot-sub">
      <!-- "We", not "<name> will": a verb agreeing with one tutor's name is
           wrong the day the contact tutor is someone else. -->
      אם כבר הזמנתם שיעור — ניצור איתכם קשר לאישור המועד, והדף ייפתח
      ברגע שהכל מוכן.
    </p>
    <a class="boot-cta" href={noStudentsWhatsAppHref} target="_blank" rel="noopener">
      <Icon name="message" size={17} /> פנייה ל{contactTutor().name} בוואטסאפ
    </a>
    <a class="boot-cta-secondary" href="/booking">להזמנת שיעור</a>
  </div>
{:else if CURRENT}
  <nav class="top-nav">
    <div class="nav-brand">
      <BrandMark height={28} label={null} />
      <span class="nav-brand-title">{data.isSelf ? 'הדף שלי' : 'פורטל הורים'}</span>
      <span class="nav-brand-name">{CURRENT.name}</span>
    </div>
    <div class="nav-actions">
      {#if data.students.length > 1}
        <!-- Only ever this parent's own children — the list comes from
             their session, not from a global roster. -->
        <label class="switcher">
          <span class="sr-only">בחירת תלמיד/ה</span>
          <select
            value={currentId}
            onchange={(e) => openStudent((e.currentTarget as HTMLSelectElement).value)}
          >
            {#each data.students as s (s.code)}
              <option value={s.code}>{s.emoji} {s.name}</option>
            {/each}
          </select>
        </label>
      {/if}
      <button class="nav-logout" onclick={signOut}>יציאה</button>
    </div>
  </nav>

  <main class="page">
    <div class="student-header">
      <div class="sh-avatar">{CURRENT.emoji || '👩‍🎓'}</div>
      <div>
        <h1 class="sh-name">{CURRENT.name}</h1>
        <div class="sh-meta">{[CURRENT.subject, CURRENT.level, CURRENT.tutor ? 'מורה: ' + CURRENT.tutor : ''].filter(Boolean).join(' · ')}</div>
        <div class="sh-badges">
          {#each [CURRENT.subject, CURRENT.level, CURRENT.style ? 'סגנון: ' + CURRENT.style : ''].filter(Boolean) as t}
            <span class="sh-badge">{t}</span>
          {/each}
        </div>
      </div>
    </div>

    {#if isDayOne}
      <!-- Day one used to be six zero-states and a 0% bar: the family's
           first look at the thing they had just paid for. It is a promise
           now, and it names what is actually happening. -->
      <div class="dayone">
        <div class="dayone-icon"><Icon name="celebrate" size={40} /></div>
        <div>
          <div class="dayone-title">הכל מוכן, {CURRENT.name} רשום/ה</div>
          <p class="dayone-sub">
            אחרי השיעור הראשון יופיעו כאן סיכום השיעור, המצגת ושיעורי הבית —
            כולל משחקי תרגול שאפשר לשחק מהטלפון.
          </p>
        </div>
      </div>
    {/if}

    {#if !data.isSelf}
      <!-- The child's own way in. A parent link opens the parent view, so a
           child needs a session scoped to themselves — this is where they
           get one. -->
      <div class="section share">
        <div class="sec-header">
          <span class="sec-icon"><Icon name="student" /></span>
          <span class="sec-title">כניסה ל{CURRENT.name}</span>
        </div>

        {#if !shareOpen}
          <p class="share-intro">
            שלחו ל{CURRENT.name} קישור אישי — לוח משלו/ה עם שיעורי הבית והמשחקים,
            בלי גישה לתשלומים.
          </p>
          <button class="share-open" onclick={loadShare} disabled={shareBusy}>
            {shareBusy ? '...מכין' : 'הכנת קישור וקוד'}
          </button>
          {#if shareErr}<p class="share-err" role="alert">{shareErr}</p>{/if}
        {:else if share}
          <div class="share-actions">
            <a class="share-primary" href={shareHref} target="_blank" rel="noopener">
              <Icon name="message" size={17} /> שליחה בוואטסאפ
            </a>
            <button class="share-secondary" onclick={copyShare}>
              {#if copied}<Icon name="check" size={16} /> הועתק{:else}<Icon name="link" size={16} /> העתקת קישור{/if}
            </button>
          </div>
          <div class="share-link" dir="ltr">{share.link}</div>

          <div class="share-code">
            <div class="share-code-label">אין וואטסאפ? הקלידו את הקוד הזה ב-<span dir="ltr">/portal</span></div>
            <div class="share-code-value" dir="ltr">{share.joinCode}</div>
            <div class="share-code-note">תקף לשבוע, לשימוש חד-פעמי.</div>
          </div>
        {/if}
      </div>
    {/if}

    <div class="stats-bar">
      <div class="stat-card">
        <div class="s-label">שיעורים שנעשו</div>
        <div class="s-value accent">{totalSessions}</div>
        <div class="s-sub">שיעורים סה"כ</div>
      </div>
      <div class="stat-card">
        <div class="s-label">שיעורי בית פתוחים</div>
        <div class="s-value" class:coral={hwPending > 0} class:green={hwPending === 0}>{hwPending}</div>
        <!-- "הכל הוגש ✓" on a family with zero assignments is simply
             false, and it was the first thing a new parent read. -->
        <div class="s-sub">{hwPending > 0 ? 'ממתינים לביצוע' : hwTotal ? 'הכל הוגש ✓' : 'עוד לא ניתנו'}</div>
      </div>
      {#if CURRENT.balance}
        <!-- "מתוך" is paid + owed, the total ever charged. It cannot be
             `owedAgorot` alone: marking a lesson paid MOVES it out of that
             sum, so a family who had settled everything read "שולם ₪215
             מתוך ₪0". The two figures have to come from disjoint sets
             whose union is the whole ledger. -->
        <div class="stat-card">
          <div class="s-label">שולם</div>
          <div class="s-value green">{formatAgorot(CURRENT.balance.paidAgorot)}</div>
          <div class="s-sub">מתוך {formatAgorot(CURRENT.balance.paidAgorot + CURRENT.balance.owedAgorot)}</div>
        </div>
        <!-- The same number the Payments section below prints as
             לתשלום עכשיו. Two different answers about one family's money on
             one page is worse than either answer being slightly coarse. -->
        <div class="stat-card">
          <div class="s-label">יתרה לתשלום</div>
          <div class="s-value" class:coral={CURRENT.balance.dueAgorot > 0} class:green={CURRENT.balance.dueAgorot <= 0}>{formatAgorot(CURRENT.balance.dueAgorot)}</div>
          <div class="s-sub">{CURRENT.balance.dueAgorot > 0 ? 'ממתין לתשלום' : 'מעודכן ✓'}</div>
        </div>
      {/if}
    </div>

    <div class="section">
      <div class="sec-header"><span class="sec-icon"><Icon name="calendar" /></span><span class="sec-title">השיעור הבא</span></div>
      {#if CURRENT.nextLesson?.date}
        <div class="next-lesson-box">
          <div class="nl-icon"><Icon name="calendar" size={22} /></div>
          <div>
            <div class="nl-label">שיעור הבא</div>
            <div class="nl-date">{formatDateHe(CURRENT.nextLesson.date)}</div>
            <div class="nl-meta">{CURRENT.nextLesson.time ? 'שעה ' + CURRENT.nextLesson.time : ''} {CURRENT.nextLesson.type ? '· ' + CURRENT.nextLesson.type : ''}</div>
          </div>
        </div>
      {:else}
        <div class="no-upcoming">אין שיעור קבוע — ניצור קשר לתאום 🗓️</div>
      {/if}
    </div>

    <div class="section">
      <div class="sec-header">
        <span class="sec-icon"><Icon name="subjects" /></span><span class="sec-title">יומן שיעורים</span>
        <span class="sec-badge">{totalSessions} שיעורים</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>תאריך</th><th>סוג / משך</th><th>נושא / הערות</th></tr></thead>
          <tbody>
            {#if !sortedSessions.length}
              <tr><td colspan="3" class="empty-row">עדיין לא נרשמו שיעורים</td></tr>
            {:else}
              {#each sortedSessions as sess}
                <tr>
                  <td>{formatDateHe(sess.date)}</td>
                  <td><span class="pill">{sess.type || 'שיעור'}</span></td>
                  <td><div class="lesson-topic">{sess.notes || '—'}</div></td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="sec-header">
        <span class="sec-icon"><Icon name="homework" /></span><span class="sec-title">שיעורי בית</span>
        <span class="sec-badge">{hwPending} פתוח{hwPending !== 1 ? 'ים' : ''}</span>
      </div>
      <div class="hw-list">
        {#if !reversedHomework.length}
          <!-- "🎉" celebrated an empty list at a family whose child had
               just enrolled and had nothing yet. The emoji belongs to
               finishing, not to never having started. -->
          <div class="hw-empty">
            {isDayOne ? 'שיעורי הבית יופיעו כאן אחרי השיעור הראשון.' : 'אין שיעורי בית פתוחים כרגע 🎉'}
          </div>
        {:else}
          {#each reversedHomework as h}
            {@const state = homeworkState(h)}
            <div class="hw-item">
              <div class="hw-status-icon"><Icon name={state === 'open' ? 'homework' : 'done'} label={HOMEWORK_STATE_LABEL[state]} /></div>
              <div class="hw-content">
                <div class="hw-task" class:done={state !== 'open'}>{h.task}</div>
                <div class="hw-meta">ניתן: {formatDateHe(h.date)}</div>
                {#if h.url}
                  <a class="hw-play" href={toHref(h.url)} target="_blank" rel="noopener"><Icon name="games" size={17} /> שחקו</a>
                {/if}
              </div>
              <span class="hw-badge" class:done={state !== 'open'} class:open={state === 'open'}>{HOMEWORK_STATE_LABEL[state]}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="section">
      <div class="sec-header"><span class="sec-icon"><Icon name="progress" /></span><span class="sec-title">התקדמות</span></div>
      <div class="progress-overall">
        <div class="po-top">
          <!-- Says WHAT is counted. It said «רמת התקדמות כללית» for a
               homework count too, which dressed diligence up as
               understanding — the student page already told them apart. -->
          <span class="po-label">{progressWords}</span>
          <!-- `percent`, not the object. This rendered "[object Object]%"
               to parents after #93 turned progress into ProgressFacts and
               this page kept treating it as an integer. -->
          <span class="po-pct">{CURRENT.progress?.percent ?? 0}%</span>
        </div>
        <div class="bar-bg"><div class="bar-fill" style="width:{CURRENT.progress?.percent ?? 0}%"></div></div>
        <!-- The skills behind the number, by name: what was covered and what
             was understood (PRODUCT.md, "Progress parents can see"). Server
             computed — see seenIn() in src/lib/server/progress.ts. -->
        {#if seen && (seen.understood.length || seen.covered.length)}
          <div class="seen">
            {#if seen.understood.length}
              <div class="seen-group">
                <div class="seen-title">מה כבר הובן</div>
                <ul>
                  {#each seen.understood as u (u.title)}
                    <li><span>{u.title}</span><span class="seen-tag">{u.label}</span></li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if seen.covered.length}
              <div class="seen-group">
                <div class="seen-title">נלמד בשיעורים, עוד בדרך</div>
                <ul>
                  {#each seen.covered as title (title)}
                    <li><span>{title}</span></li>
                  {/each}
                </ul>
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="notes-card">
        {#if CURRENT.progress?.note}
          <!-- The tutor's note, written for the parent: the dashboard labels
               it «מוצגת להורים בלבד». It used to be read from a portal-file
               field nothing writes, while the real note went to the CHILD's
               page. Plain text now — it is no longer trusted HTML. -->
          <p class="notes-text">{CURRENT.progress.note}</p>
        {:else}
          <!-- Was --border-strong, a BORDER token used as a text colour:
               #cbd5e1 on white is 1.48:1, barely visible. -->
          <em class="notes-empty">אין הערות עדיין.</em>
        {/if}
      </div>
    </div>

    <div class="section">
      <div class="sec-header"><span class="sec-icon"><Icon name="payments" /></span><span class="sec-title">תשלומים</span></div>
      {#if CURRENT.balance}
        <div class="payments-summary">
          <div class="pay-sum-card pending">
            <div class="psc-amount">{formatAgorot(CURRENT.balance.dueAgorot)}</div>
            <div class="psc-label">לתשלום עכשיו</div>
          </div>
          <div class="pay-sum-card total">
            <div class="psc-amount">{formatAgorot(CURRENT.balance.upcomingAgorot)}</div>
            <div class="psc-label">מתוכנן קדימה</div>
          </div>
          <div class="pay-sum-card paid">
            <div class="psc-amount">{formatAgorot(CURRENT.balance.paidAgorot)}</div>
            <div class="psc-label">שולם עד כה</div>
          </div>
        </div>
        <p class="pay-note">הסכומים הם של כל המשפחה. הרשימה למטה היא של {CURRENT.name}.</p>
      {/if}

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>תאריך</th><th>שיעור</th><th>סכום</th><th>סטטוס</th></tr></thead>
          <tbody>
            {#if !(CURRENT.charges ?? []).length}
              <tr><td colspan="4" class="empty-row">אין עדיין חיובים</td></tr>
            {:else}
              {#each CURRENT.charges ?? [] as c (c.id)}
                <tr>
                  <td>{formatDateHe(c.date)}</td>
                  <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                  <td style="font-weight:700">{formatAgorot(c.amount_agorot)}</td>
                  <td><span class="pay-badge {c.status}">{STATUS_LABEL[c.status] ?? c.status}</span></td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <div class="board-actions">
    <a class="fam-book" href="/booking"><Icon name="booking" size={17} /> הזמנת שיעור נוסף</a>
  </div>

  <div class="footer">
    <p>פורטל הורים · {tutorNames()} שיעורים פרטיים</p>
  </div>
{:else}
  <!-- Students exist and none is on screen: the moment between choosing a
       child and their board arriving, and the moment after a stale session
       sends us to /portal. Transient either way, so it says nothing it
       would have to take back. -->
  <div class="boot" role="status">
    <BrandMark height={26} />
    <div class="boot-spinner"></div>
    <p>טוען…</p>
  </div>
{/if}

<style>
  :global(body) { background: var(--bg-base); }

  /* ── NAV ── */
  .top-nav {
    position: sticky; top: 0; z-index: 100;
    background: var(--nav-bg); backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border); padding: 0 2rem; height: 60px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .nav-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .nav-brand-title { font-size: 1rem; font-weight: 800; color: var(--accent); white-space: nowrap; }
  .nav-brand-name { color: var(--text-muted); font-weight: 400; font-size: 0.85rem; }
  .nav-logout {
    font-family: inherit; font-size: 0.82rem; font-weight: 700;
    color: var(--text-muted); background: none; border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 6px 16px; cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
  }
  .nav-logout:hover { color: var(--accent); border-color: var(--accent-soft); }

  /* ── MAIN ── */
  .page { max-width: 1100px; margin: 0 auto; padding: 2.5rem 1.5rem 6rem; }

  .student-header {
    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-soft) 100%);
    border-radius: var(--r-lg); padding: 26px 30px;
    display: flex; align-items: center; gap: 18px; margin-bottom: 1.8rem;
    box-shadow: 0 6px 30px var(--accent-glow);
  }
  .sh-avatar {
    width: 60px; height: 60px; border-radius: 50%;
    background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.4);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.9rem; flex-shrink: 0;
  }
  .sh-name {
    margin: 0; font-size: 1.6rem; font-weight: 900; color: #fff; line-height: 1.2; }
  .sh-meta { font-size: 0.85rem; color: rgba(255,255,255,0.75); margin-top: 3px; }
  .sh-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .sh-badge {
    font-size: 0.72rem; font-weight: 700; padding: 3px 11px; border-radius: 20px;
    /* 0.18 white over the blue gradient lifts the ground enough to drop
       white text to 3.76:1. A transparent pill keeps the badge shape
       without eating the contrast. */
    background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.45);
  }

  .stats-bar { display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 14px; margin-bottom: 2rem; }
  .stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); padding: 18px 20px; box-shadow: 0 2px 12px var(--shadow); }
  .stat-card .s-label { font-size: 0.72rem; font-weight: 700; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-card .s-value { font-size: 1.9rem; font-weight: 900; color: var(--text-primary); line-height: 1.1; }
  .stat-card .s-value.accent { color: var(--accent); }
  .stat-card .s-value.green  { color: var(--accent3-strong); }
  .stat-card .s-value.coral  { color: var(--accent2-strong); }
  .stat-card .s-sub { font-size: 0.76rem; color: var(--text-muted); margin-top: 4px; }

  .section { margin-bottom: 2.2rem; }
  .sec-header { display: flex; align-items: center; gap: 10px; margin-bottom: 1rem; padding-bottom: 10px; border-bottom: 2px solid var(--border); }
  .sec-icon { font-size: 1.2rem; }
  .sec-title { font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }
  /* --accent on --accent-dim is 4.44:1 at this size — just under AA.
     --accent-deep is the same hue one step darker, for small text on the
     tinted fills. */
  .sec-badge { margin-right: auto; font-size: 0.72rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; background: var(--accent-dim); color: var(--accent-deep); border: 1px solid rgba(37,99,235,0.25); }

  .next-lesson-box {
    background: linear-gradient(135deg, var(--accent-dim), rgba(250,130,49,0.04));
    border: 1.5px solid rgba(37,99,235,0.22); border-radius: var(--r-md);
    padding: 18px 22px; display: flex; align-items: center; gap: 18px;
  }
  .nl-icon { font-size: 2.2rem; flex-shrink: 0; }
  /* text-transform: uppercase does nothing to Hebrew but announce an
     LTR template; the tracking only loosens the join between letters. */
  .nl-label { font-size: 0.75rem; font-weight: 700; color: var(--accent-deep); margin-bottom: 4px; }
  .nl-date { font-size: 1.45rem; font-weight: 900; color: var(--text-primary); }
  .nl-meta { font-size: 0.85rem; color: var(--text-muted-strong); margin-top: 2px; }
  .no-upcoming { color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px; background: var(--bg-surface); border: 1px dashed var(--border); border-radius: var(--r-md); }

  .table-wrap { overflow-x: auto; border-radius: var(--r-md); box-shadow: 0 2px 12px var(--shadow); }
  .data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; background: var(--bg-card); border-radius: var(--r-md); overflow: hidden; }
  .data-table thead { background: var(--accent-dim); }
  .data-table th { text-align: right; padding: 11px 15px; color: var(--accent); font-size: 0.72rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; border-bottom: 1.5px solid rgba(37,99,235,0.18); }
  .data-table td { padding: 11px 15px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: top; }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tr:hover td { background: var(--accent-dim); }
  .pill { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 3px 9px; border-radius: 20px; background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(37,99,235,0.2); }
  .lesson-topic { font-weight: 700; }
  .empty-row { text-align: center; color: var(--text-muted); padding: 24px; font-size: 0.9rem; }

  .hw-list { display: flex; flex-direction: column; gap: 10px; }
  .hw-empty { text-align: center; color: var(--text-muted); padding: 22px; font-size: .9rem; }
  .hw-item { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); padding: 13px 16px; display: flex; align-items: flex-start; gap: 12px; box-shadow: 0 2px 8px var(--shadow); }
  .hw-status-icon { font-size: 1.2rem; flex-shrink: 0; margin-top: 2px; }
  .hw-content { flex: 1; }
  .hw-task { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); }
  .hw-task.done { text-decoration: line-through; color: var(--text-muted); font-weight: 400; }
  .hw-meta { font-size: 0.76rem; color: var(--text-muted); margin-top: 2px; }
  .hw-play {
    display: inline-flex; align-items: center; gap: 4px;
    margin-top: 7px; padding: 7px 14px; min-height: 34px;
    background: var(--accent2-dim); color: var(--accent2-strong);
    border: 1.5px solid var(--accent2-strong); border-radius: 999px;
    font-size: 0.8rem; font-weight: 700; text-decoration: none;
  }
  .hw-play:hover { background: var(--accent2); color: var(--btn-text); }
  .hw-badge { flex-shrink: 0; font-size: 0.72rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; align-self: flex-start; margin-top: 2px; }
  .hw-badge.done { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); color: var(--accent3-strong); }
  .hw-badge.open { background: #FEF3C7; border: 1px solid #D97706; color: #D97706; }

  .progress-overall { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); padding: 20px 22px; box-shadow: 0 2px 10px var(--shadow); margin-bottom: 14px; }
  .po-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .po-label { font-size: 0.9rem; font-weight: 700; color: var(--text-primary); }
  .po-pct { font-size: 1.4rem; font-weight: 900; color: var(--accent); }
  .bar-bg { height: 10px; background: var(--border); border-radius: 6px; overflow: hidden; }
  .seen { display: grid; gap: 14px; margin-top: 16px; }
  .seen-title { font-size: 0.85rem; font-weight: 700; color: var(--text-muted-strong); margin-bottom: 6px; }
  .seen ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .seen li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 0.92rem; color: var(--text-primary); }
  .seen li > span:first-child { min-width: 0; overflow-wrap: anywhere; }
  .seen-tag { flex: none; font-size: 0.78rem; font-weight: 700; color: var(--accent); background: var(--accent-dim); border-radius: var(--r-sm); padding: 2px 8px; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-soft)); border-radius: 6px; transition: width 0.7s cubic-bezier(.4,0,.2,1); }
  .notes-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--r-md); padding: 18px 20px; box-shadow: 0 2px 10px var(--shadow); font-size: 0.9rem; color: var(--text-muted); line-height: 1.8; }
  .notes-card :global(strong) { color: var(--text-primary); }

  .payments-summary { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 12px; margin-bottom: 1.2rem; }
  .pay-sum-card { border-radius: var(--r-md); padding: 15px 18px; text-align: center; }
  .pay-sum-card.paid    { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); }
  .pay-sum-card.pending { background: #FEF3C7; border: 1px solid #D97706; }
  .pay-sum-card.total   { background: var(--accent-dim); border: 1px solid rgba(37,99,235,0.22); }
  .psc-amount { font-size: 1.5rem; font-weight: 900; }
  .pay-sum-card.paid    .psc-amount { color: var(--accent3-strong); }
  .pay-sum-card.pending .psc-amount { color: #D97706; }
  .pay-sum-card.total   .psc-amount { color: var(--accent); }
  .psc-label { font-size: 0.72rem; font-weight: 700; color: var(--text-muted); letter-spacing: 0.06em; text-transform: uppercase; margin-top: 4px; }

  .footer { text-align: center; padding: 3rem 1rem 2rem; font-size: 0.8rem; color: var(--text-muted); }

  @media (max-width: 600px) {
    .student-header { flex-direction: column; text-align: center; gap: 12px; }
    .sh-badges { justify-content: center; }
    .stats-bar { grid-template-columns: 1fr 1fr; }
    .next-lesson-box { flex-direction: column; gap: 10px; }
    .top-nav { padding: 0 1rem; }
    /* The student's name repeats immediately below in .student-header (and
       in the switcher when there is more than one), so it is the safe thing
       to drop when the nav runs out of room. */
    .nav-brand-name { display: none; }
    .page { padding: 1.5rem 1rem 5rem; }
  }

  /* ── Boot, day one, sharing ── */
  .boot {
    min-height: 70vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 0.6rem;
    padding: 2rem; text-align: center; color: var(--text-muted);
  }
  .boot-spinner {
    width: 34px; height: 34px; border: 3px solid var(--border);
    border-top-color: var(--accent); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .boot-icon { font-size: 2.6rem; }
  .boot-title { font-size: 1.15rem; font-weight: 800; color: var(--text-primary); }
  .boot-sub { font-size: 0.9rem; line-height: 1.6; max-width: 22rem; }
  .boot-err { color: var(--danger); font-weight: 600; }
  .boot-retry, .boot-cta {
    margin-top: 0.6rem; background: var(--accent); color: #fff;
    border: 0; border-radius: 12px; padding: 0.75rem 1.6rem; min-height: 48px;
    font-family: inherit; font-size: 0.95rem; font-weight: 800;
    cursor: pointer; text-decoration: none; display: inline-flex;
    align-items: center;
  }
  /* A secondary action next to .boot-cta — kept visually quieter so the
     primary instruction (reach Nicole) isn't competed with by "book
     again," which would be the wrong first move for a family that already
     has. */
  .boot-cta-secondary {
    margin-top: 0.6rem; background: transparent; color: var(--text-primary);
    border: 1.5px solid var(--border-strong); border-radius: 12px;
    padding: 0.7rem 1.6rem; min-height: 44px;
    font-family: inherit; font-size: 0.9rem; font-weight: 700;
    cursor: pointer; text-decoration: none; display: inline-flex;
    align-items: center;
  }

  .nav-actions { display: flex; align-items: center; gap: 0.6rem; }
  /* The nav sign-out inherited a 34px height from the shared button
     rule — under the 44px touch minimum on the one control a parent
     reaches for on a shared device. */
  .nav-actions .nav-logout { min-height: 44px; padding-inline: 1rem; }
  .notes-text { margin: 0; white-space: pre-line; }
  .notes-empty { color: var(--text-muted); }
  .switcher select {
    font-family: inherit; font-size: 0.9rem; font-weight: 700;
    padding: 0.5rem 0.7rem; min-height: 44px;
    border: 1.5px solid var(--border-strong); border-radius: 10px;
    background: var(--bg-card); color: var(--text-primary);
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  .dayone {
    display: flex; gap: 0.9rem; align-items: flex-start;
    background: var(--bg-surface); border: 1.5px solid var(--accent);
    border-radius: var(--r-lg); padding: 1.1rem 1.2rem; margin-bottom: 1.2rem;
  }
  .dayone-icon { font-size: 1.7rem; line-height: 1; }
  .dayone-title { font-weight: 800; font-size: 1.02rem; color: var(--text-primary); }
  .dayone-sub { font-size: 0.89rem; color: var(--text-muted-strong); line-height: 1.65; margin-top: 0.25rem; }

  .share-intro { font-size: 0.9rem; color: var(--text-muted); line-height: 1.65; margin-bottom: 0.8rem; }
  .share-open {
    background: var(--accent); color: #fff; border: 0; border-radius: 12px;
    padding: 0.75rem 1.4rem; min-height: 48px;
    font-family: inherit; font-size: 0.95rem; font-weight: 800; cursor: pointer;
  }
  .share-open:disabled { opacity: 0.6; cursor: default; }
  .share-err { color: var(--danger); font-size: 0.85rem; font-weight: 600; margin-top: 0.5rem; }
  .share-actions { display: flex; gap: 0.55rem; flex-wrap: wrap; }
  .share-primary, .share-secondary {
    flex: 1 1 10rem; text-align: center; border-radius: 12px;
    padding: 0.75rem 0.6rem; min-height: 48px;
    font-family: inherit; font-size: 0.92rem; font-weight: 800;
    text-decoration: none; cursor: pointer;
  }
  .share-primary { background: var(--accent); color: #fff; border: 0; }
  .share-secondary {
    background: var(--bg-card); color: var(--text-primary);
    border: 1.5px solid var(--border-strong);
  }
  .share-secondary:hover { border-color: var(--accent); color: var(--accent); }
  .share-link {
    margin-top: 0.7rem; font-size: 0.72rem; color: var(--text-muted);
    word-break: break-all; background: var(--bg-base);
    border-radius: 8px; padding: 0.5rem 0.6rem; user-select: all;
  }
  .share-code {
    margin-top: 1rem; padding-top: 0.9rem; border-top: 1px dashed var(--border-strong);
    text-align: center;
  }
  .share-code-label { font-size: 0.85rem; color: var(--text-muted); }
  .share-code-value {
    font-size: 1.7rem; font-weight: 900; letter-spacing: 0.14em;
    color: var(--accent); margin: 0.35rem 0 0.2rem; user-select: all;
  }
  .share-code-note { font-size: 0.78rem; color: var(--text-muted); }

  .pay-note { font-size: 0.82rem; color: var(--text-muted); margin: 0.7rem 0 0.2rem; }
  .pay-badge { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .pay-badge.paid { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); color: var(--accent3-strong); }
  .pay-badge.owed { background: #fef3c7; border: 1px solid #92400e; color: #92400e; }
  .pay-badge.void { background: var(--bg-base); border: 1px solid var(--border-strong); color: var(--text-muted); text-decoration: line-through; }

  /* ── Family overview ── */
  .fam-head { margin-bottom: 1.2rem; }
  .fam-title { font-size: 1.6rem; font-weight: 900; margin: 0; }
  .fam-sub { color: var(--text-muted); font-size: 0.9rem; margin-top: 0.2rem; }

  .kid-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
    gap: 1rem;
    margin-top: 1.4rem;
  }
  .kid-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.1rem 1.2rem;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 2px 12px var(--shadow);
    transition: border-color 0.15s, transform 0.1s;
  }
  .kid-card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .kid-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  .kid-top { display: flex; align-items: center; gap: 0.7rem; }
  .kid-emoji {
    font-size: 1.5rem; width: 44px; height: 44px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg-surface); border-radius: 50%;
  }
  .kid-name { font-weight: 800; font-size: 1.05rem; }
  .kid-meta { font-size: 0.83rem; color: var(--text-muted); margin-top: 1px; }

  .kid-rows {
    margin-top: 0.9rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 0.45rem;
  }
  .kid-row {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 0.8rem; font-size: 0.88rem; color: var(--text-muted);
  }
  .kid-row b { color: var(--text-primary); font-weight: 700; }
  .kid-row b.coral { color: var(--accent2-strong); }

  .kid-open {
    margin-top: 0.9rem; font-size: 0.85rem; font-weight: 700; color: var(--accent);
  }

  .fam-actions { margin-top: 1.6rem; text-align: center; }
  .board-actions { max-width: 1100px; margin: 0 auto; padding: 0 1.2rem 1.6rem; text-align: center; }
  .fam-book {
    display: inline-block; background: var(--accent); color: #fff;
    border-radius: 12px; padding: 0.8rem 1.8rem; min-height: 48px;
    font-weight: 800; font-size: 0.98rem; text-decoration: none;
  }
  .fam-book:hover { background: var(--accent-soft); }
</style>

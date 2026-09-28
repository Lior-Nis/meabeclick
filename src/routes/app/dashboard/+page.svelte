<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import ReportQueue from '$lib/components/ReportQueue.svelte';
  import LearningPlanTree from '$lib/components/LearningPlanTree.svelte';
  import { tutorNames } from '$lib/tutors.ts';
  import type { TutorHomework } from '$lib/tutor-homework.ts';
  import { GRADES, GRADE_BUTTON, GRADE_LABEL, type HomeworkGrade } from '$lib/homework-grade.ts';
  import { israelDay, israelToday } from '$lib/dates.ts';
  /**
   * Port of pages/app/dashboard.html. Auth is handled entirely by
   * +page.server.ts (requireAuth) — see the comment there for why the old
   * page's client-side lock screen (a readable PASSWORD constant, gated by
   * sessionStorage) is not carried forward.
   *
   * Two independent data stores, exactly as in the source page — this is
   * not something introduced by the port:
   *   - `data.students` — legacy local data used only for the one-time import
   *     bridge and as a temporary fallback while server activity loads.
   *   - the REAL entity model (/api/students) — accounts and students,
   *     rendered in the "כניסה לפורטל" panel below and created via the
   *     "+ תלמיד חדש" modal. It carries no passwords: families reach their
   *     page through a signed link (/api/students/:code/link).
   *   These share no identity (a local student's `id` is a client-generated
   *   `stu_<timestamp>`, unrelated to a real student's `code`) and never did.
   *
   * Ruling P13: the old dashboard.html:725 rendered a lesson's game links as
   * `href="/${g.url}"` unguarded — a new-shape {template,dataId} entry (no
   * `url`) rendered `href="/undefined"`. Fixed at the source: GET
   * /api/lessons (src/routes/api/lessons/+server.ts) now normalizes every
   * game entry the same way /api/portal/[code] already did, and — because
   * this is the tutor's own admin view rather than a child's — keeps a
   * malformed entry visible with `broken: true` instead of dropping it, so
   * a bad link is never silently missing. See that file's header comment
   * for the full reasoning, including why `slidesUrl` is derived via
   * lessonUrl(slug) rather than trusting the stored `slides` string (always
   * a fresh lessonUrl() call, never a stored value — nothing to normalize).
   *
   * `g.url` itself is still mixed-shape the same way parent/student's `url`
   * field is (an old-shape entry has no leading slash; a new-shape one,
   * already run through gameUrl() by the endpoint above, does) — rendering
   * it raw would resolve a legacy link relative to /app/dashboard instead
   * of root, a third silent-failure mode (a real but wrong URL, no visible
   * sign anything's off) that P13 exists to rule out just as much as the
   * other two. toHref() ($lib/urls.ts, shared with parent/ and student/)
   * reconciles it — see that file's header for the full shape writeup.
   *
   * Scoped-CSS trap inventory (every class the old inline <script> toggled
   * via classList after initial render) — all converted to reactive
   * `class:` directives, none left to a bare classList.toggle():
   *   - #save-indicator.show      → saveIndicatorVisible
   *   - .sc-tab.active / .sc-panel.active (per-student tab switch) → activeTab record
   *   - .add-form.open (add-session / add-hw inline forms) → openForms record
   *   - #modal-bg.open (add-student modal)  → modalOpen
   *   - #confirm-bg.open (confirm dialog)   → confirmMsg !== null
   */
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { toHref } from '$lib/urls.ts';
  import { formatAgorot } from '$lib/plans.ts';
  import { idsForPanel } from '$lib/payments-selection.ts';
  import { computeImportCandidates, buildImportPayload, type ImportCandidate } from '$lib/import-candidates.ts';
  import type { PageData } from './$types';

  // Named apart from the local fake-CRM `data` below (see that variable's
  // own comment) — this one is the real, server-rendered roster.
  let { data: pageData }: { data: PageData } = $props();
  let dashboardPlans = $state(untrack(() => pageData.learningPlans ?? {}));

  /* ═══════════════════ local fake-CRM store ═══════════════════
   * As of this change, this store is no longer where the card's profile
   * comes from (see the real `/api/students` roster below) — only
   * sessions/homework/next-lesson are still genuinely local (task 3: they
   * are explicitly out of scope for this migration and stay in the
   * browser). The old per-field shape (`LocalStudent`) is kept ONLY so a
   * browser that already has a `tutor_dashboard_v2` blob can still be read
   * for the one-time import panel below — nothing here writes goals/
   * style/notes/progress into it any more.
   *
   * Going forward, local extras are keyed by the real student's `code`
   * (`cardExtras`), not by the old client-generated `stu_<timestamp>` id —
   * that id never matched a real student and can't be used to reattach a
   * session/homework list to the card that now renders from the server. */
  interface SessionRec { id: string; date: string; type: string; amount: number; paid: boolean; notes: string; void?: boolean }
  interface NextLesson { date: string; time: string; type: string }
  interface LocalStudent {
    id: string; name: string; subject: string; level: string; style: string; emoji: string;
    goals: string; phone: string; parent: string; progress: number; progressNote: string;
    nextLesson: NextLesson; sessions: SessionRec[]; homework: TutorHomework[]; notes: string;
  }
  interface CardExtras { nextLesson: NextLesson; sessions: SessionRec[]; homework: TutorHomework[] }
  interface ServerActivity extends CardExtras { lessons: { id: number; slug: string; title: string | null; topic: string | null; status: string; lessonAt: string | null }[] }
  interface Store {
    students: LocalStudent[];
    cardExtras?: Record<string, CardExtras>;
    // Set once the tutor has actually clicked "import to server" (see
    // runImport). Its only job is stopping the import panel from silently
    // reappearing every reload and re-offering to overwrite whatever she has
    // since typed on the server — a stale-but-non-empty local value would
    // otherwise clobber freely, since "never blank a real value" only
    // protects an *empty* local value. Persisted via the same save() as
    // everything else in this blob, never touched by anything but a
    // successful import.
    importedProfilesAt?: string;
  }

  function loadData(): Store {
    if (typeof localStorage === 'undefined') return { students: [] };
    try {
      const raw = localStorage.getItem('tutor_dashboard_v2');
      return raw ? JSON.parse(raw) : { students: [] };
    } catch {
      return { students: [] };
    }
  }

  let data = $state<Store>({ students: [] });
  let serverExtras = $state<Record<string, CardExtras>>({});
  let saveIndicatorVisible = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function save() {
    localStorage.setItem('tutor_dashboard_v2', JSON.stringify(data));
    saveIndicatorVisible = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveIndicatorVisible = false; }, 1800);
  }

  const emptyExtras = (): CardExtras => ({ nextLesson: { date: '', time: '', type: 'יחיד' }, sessions: [], homework: [] });

  /** Read-only lookup — used by derived totals, never mutated in place. */
  function extrasFor(code: string): CardExtras {
    return serverExtras[code] ?? emptyExtras();
  }


  // Still used by the add-student modal below: it sets the *enrollment's*
  // level (enrollments.level, a real server column), which is a different
  // thing from the per-card "level" badge/select the old profile tab had —
  // that had no server column at all and is dropped, not migrated (see the
  // profile tab's comment).
  const LEVELS = ['מתחיל', 'בינוני', 'מתקדם', 'מצטיין'];
  const STYLES = ['ויזואלי', 'שמיעתי', 'קינסתטי', 'קריאה/כתיבה'];

  function formatDate(d?: string | null): string {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  function studentTotals(code: string) {
    const ex = extrasFor(code);
    const paid = ex.sessions.reduce((a, x) => a + (x.paid ? x.amount : 0), 0);
    const owed = ex.sessions.reduce((a, x) => a + x.amount, 0);
    return { paid, owed, balance: owed - paid, hwPending: ex.homework.filter(h => !h.submitted && !h.graded).length };
  }

  // totalSessions / nextLessonsCount are declared further down, once
  // `realStudents` (the real roster) exists — both now depend on it.

  /* The headline money used to be $derived from data.students, the
     browser-local fake CRM — so the tutor's total differed per device and
     vanished when she cleared her browser. It is the same query the parents'
     figures come from now, so the two screens cannot disagree. */
  let allBalance = $state<{ dueAgorot: number; upcomingAgorot: number; paidAgorot: number } | null>(null);

  async function loadAllBalance() {
    try {
      const r = await fetch('/api/payments/all', { cache: 'no-store' });
      if (r.ok) allBalance = (await r.json()).balance;
    } catch { /* the tile renders a dash */ }
  }

  /* ═══════════════════ notifications ═══════════════════
     Non-blocking replacements for alert()/confirm(), same as the source. */
  interface Toast { id: number; message: string; kind: 'info' | 'success' | 'error'; sticky: boolean }
  let toasts = $state<Toast[]>([]);
  let toastSeq = 0;

  function toast(message: string, opts: { kind?: Toast['kind']; sticky?: boolean } = {}) {
    const id = ++toastSeq;
    const kind = opts.kind ?? 'info';
    const sticky = opts.sticky ?? false;
    toasts.push({ id, message, kind, sticky });
    if (!sticky) setTimeout(() => dismissToast(id), 5000);
  }
  function dismissToast(id: number) {
    toasts = toasts.filter(t => t.id !== id);
  }

  let confirmMsg = $state<string | null>(null);
  let confirmResolver: ((ok: boolean) => void) | null = null;
  function confirmDialog(message: string): Promise<boolean> {
    return new Promise(resolve => {
      confirmMsg = message;
      confirmResolver = resolve;
    });
  }
  function confirmDone(ok: boolean) {
    confirmResolver?.(ok);
    confirmResolver = null;
    confirmMsg = null;
  }

  /* ═══════════════════ add-student modal ═══════════════════ */
  let modalOpen = $state(false);
  let nsName = $state(''); let nsSubject = $state(''); let nsCode = $state(''); let nsEmail = $state('');
  let nsLevel = $state(LEVELS[0]); let nsStyle = $state('');
  let nsGoals = $state(''); let nsPhone = $state('');

  /**
   * Ends the tutor's session.
   *
   * POST /api/logout has existed since the Express port and nothing ever
   * called it — this dashboard shows every family's name, lesson history and
   * balance, and the only way off it was clearing cookies. Same pattern as
   * the entity model and the payments table before them: built, correct, and
   * left unwired.
   *
   * Full document navigation, not goto(), so no student data stays in memory
   * on a shared machine.
   */
  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  }

  function openModal() { modalOpen = true; }
  function closeModal() { modalOpen = false; }

  async function addStudent() {
    const name = nsName.trim();
    if (!name) { toast('נא להזין שם', { kind: 'error' }); return; }

    const code = nsCode.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(code)) {
      toast('הקוד האישי חייב להיות באנגלית קטנה, בלי רווחים', { kind: 'error' });
      return;
    }
    const email = nsEmail.trim();
    try {
      const r = await fetch('/api/students', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, email, subject: nsSubject || '', level: nsLevel || '', phone: nsPhone || '' }),
      });
      const body = await r.json();
      if (!r.ok) { toast(body.error || 'שמירת הקוד נכשלה', { kind: 'error' }); return; }

      // goals/style have a server home now (migration 010) — write them
      // right after creation if the tutor filled them in. Best-effort: the
      // student was already created successfully, so a failure here is
      // reported but does not undo that.
      const createdCode = body.student?.code as string | undefined;
      const extra: Record<string, string> = {};
      if (nsGoals.trim()) extra.goals = nsGoals.trim();
      if (nsStyle) extra.style = nsStyle;
      if (createdCode && Object.keys(extra).length) {
        try {
          const pr = await fetch(`/api/students/${createdCode}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(extra),
          });
          if (!pr.ok) toast('התלמיד/ה נוצר/ה, אך המטרות/הסגנון לא נשמרו', { kind: 'error' });
        } catch {
          toast('התלמיד/ה נוצר/ה, אך המטרות/הסגנון לא נשמרו — אין חיבור לשרת', { kind: 'error' });
        }
      }

      /* No password to read out any more. The family gets in through a
         link, which the codes panel below mints on demand — so the useful
         thing to say here is where to find it. */
      toast(
        `נוצר/ה ${name}. הקישור למשפחה נמצא בטבלת «כניסה לפורטל» למטה.`,
        { kind: 'success', sticky: true },
      );
    } catch {
      toast('אין חיבור לשרת — התלמיד לא נוסף', { kind: 'error' });
      return;
    }

    closeModal();
    loadCodes();
  }

  /* ═══════════════════ per-student card UI state ═══════════════════ */
  let activeTab = $state<Record<string, string>>({});
  function tabFor(sid: string): string { return activeTab[sid] ?? 'overview'; }
  function switchTab(sid: string, tab: string) { activeTab[sid] = tab; }

  let openForms = $state<Record<string, boolean>>({});
  function toggleForm(key: string) { openForms[key] = !openForms[key]; }

  interface SessionForm { date: string; type: string; amount: number; paid: string; notes: string }
  let sessionForms = $state<Record<string, SessionForm>>({});
  function sessionForm(sid: string): SessionForm {
    return sessionForms[sid] ?? { date: israelToday(), type: 'יחיד · 45 דק׳', amount: 120, paid: 'true', notes: '' };
  }
  function setSessionField<K extends keyof SessionForm>(sid: string, field: K, value: SessionForm[K]) {
    sessionForms[sid] = { ...sessionForm(sid), [field]: value };
  }

  interface HwForm { task: string; date: string }
  let hwForms = $state<Record<string, HwForm>>({});
  function hwForm(sid: string): HwForm {
    return hwForms[sid] ?? { task: '', date: israelToday() };
  }
  function setHwField<K extends keyof HwForm>(sid: string, field: K, value: HwForm[K]) {
    hwForms[sid] = { ...hwForm(sid), [field]: value };
  }

  /** Only `nextLesson` is left here — the rest of what this function used
   *  to touch (name/subject/level/style/emoji/phone/parent/goals/notes/
   *  progress/progressNote) is now either server-backed (see
   *  saveProfileField below) or dropped for having no server home
   *  (see the profile tab's comment). Keyed by the student's real `code`,
   *  same as every other local extra now. */
  async function refreshActivity(code: string) {
    const r = await fetch(`/api/students/${code}/activity`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('activity load failed');
    const activity = await r.json() as ServerActivity;
    serverExtras = { ...serverExtras, [code]: activity };
  }

  async function addSession(code: string) {
    const f = sessionForm(code);
    if (!f.date || !f.amount) return;
    try {
      const r = await fetch('/api/payments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentCode: code, date: f.date, kind: f.type.startsWith('כפול') ? 'double' : f.type.startsWith('משולש') ? 'triple' : 'single', amountAgorot: Math.round(+f.amount * 100), paid: f.paid === 'true', note: f.notes }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לשמור את השיעור בשרת', { kind: 'error' }); }
  }

  async function togglePaid(code: string, sessId: string) {
    const sess = extrasFor(code).sessions.find(x => x.id === sessId);
    if (!sess) return;
    try {
      const r = await fetch('/api/payments/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(sessId)], status: sess.paid ? 'owed' : 'paid' }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לעדכן את התשלום', { kind: 'error' }); }
  }
  async function voidSession(code: string, sessId: string) {
    try {
      const r = await fetch('/api/payments/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(sessId)], status: 'void' }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לבטל את הרישום', { kind: 'error' }); }
  }

  async function addHomework(code: string) {
    const f = hwForm(code);
    const task = f.task.trim();
    if (!task) return;
    try {
      const r = await fetch(`/api/students/${code}/activity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', task, date: f.date }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לשמור את שיעורי הבית בשרת', { kind: 'error' }); }
  }
  async function toggleHw(code: string, hwId: string) {
    const hw = extrasFor(code).homework.find(x => x.id === hwId);
    if (!hw) return;
    try {
      const r = await fetch(`/api/students/${code}/activity`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', id: Number(hwId), submitted: !hw.submitted }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לעדכן את שיעורי הבית', { kind: 'error' }); }
  }
  /** Stage two: she judged it. `null` takes a grade back — a slip of the
   *  finger must be as cheap to undo as the checkbox is. */
  async function gradeHw(code: string, hwId: string, grade: HomeworkGrade | null) {
    try {
      const r = await fetch(`/api/students/${code}/activity`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'homework', id: Number(hwId), grade }) });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן לשמור את הבדיקה', { kind: 'error' }); }
  }

  async function deleteHw(code: string, hwId: string) {
    try {
      const r = await fetch(`/api/students/${code}/activity?id=${encodeURIComponent(hwId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      await refreshActivity(code);
    } catch { toast('לא ניתן למחוק את שיעורי הבית', { kind: 'error' }); }
  }

  /**
   * The card is now a real server student, so "delete" means the real
   * DELETE /api/students/:code — leaving the button wired to nothing but a
   * local-only cleanup would make it lie about what it does. The endpoint
   * already refuses (409) a student with real history (lessons, payments,
   * results), so this cannot silently erase the ledger — see
   * deleteStudentCascade's own comment in entities.ts.
   */
  async function deleteStudent(code: string) {
    if (!await confirmDialog('למחוק את התלמיד/ה?')) return;
    try {
      const r = await fetch(`/api/students/${code}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(body.error || 'המחיקה נכשלה', { kind: 'error' });
        return;
      }
      realStudents = realStudents.filter(x => x.code !== code);
      if (data.cardExtras) delete data.cardExtras[code];
      save();
    } catch {
      toast('אין חיבור לשרת — התלמיד/ה לא נמחק/ה', { kind: 'error' });
    }
  }

  /* ═══════════════════ real /api/students — access panel ═══════════════════ */
  // Mirrors server/entities.ts RosterRow — this is also now the shape the
  // student cards render from (task: the card's profile comes from the
  // server, not from `tutor_dashboard_v2`).
  interface RealStudent {
    code: string; name: string; emoji: string | null;
    progress: number; progress_note: string | null;
    goals: string | null; style: string | null; notes: string | null;
    email: string | null; account_name: string; account_phone: string | null;
    subjects: string | null;
  }
  interface StudentLinks { name: string; familyLink: string; studentLink: string; joinCode: string }
  // Seeded from the server load so a first, JS-free GET already carries the
  // roster (and the plan link on each row); loadCodes() below still keeps
  // it fresh after a link is minted or a student is added client-side.
  // untrack: this is a one-time seed of the initial value, not a binding —
  // the panel never needs to react to `pageData` changing again, and
  // loadCodes() below is what keeps it fresh from here on.
  let realStudents = $state<RealStudent[]>(untrack(() => pageData.roster ?? []));
  let codesLoading = $state(false);
  let codesError = $state('');

  async function updateDashboardPlanStatus(code: string, nodeId: number, status: string) {
    const plan = dashboardPlans[code];
    if (!plan?.planId) return;
    const response = await fetch(`/api/plans/${plan.planId}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'status', nodeId, status, evidence: null, note: null }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'עדכון הסטטוס נכשל');
    dashboardPlans = { ...dashboardPlans, [code]: { ...plan, topics: body.tree } };
  }

  async function loadCodes() {
    codesLoading = true;
    codesError = '';
    try {
      const r = await fetch('/api/students', { cache: 'no-store' });
      realStudents = ((await r.json()).students ?? []) as RealStudent[];
    } catch {
      codesError = 'אין חיבור לשרת';
    } finally {
      codesLoading = false;
    }
  }

  async function loadActivities() {
    const codes = realStudents.map(s => s.code);
    const loaded = await Promise.allSettled(codes.map(async code => {
      const r = await fetch(`/api/students/${code}/activity`, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      return [code, await r.json() as ServerActivity] as const;
    }));
    const next = { ...serverExtras };
    for (const result of loaded) if (result.status === 'fulfilled') next[result.value[0]] = result.value[1];
    serverExtras = next;
  }

  // Depend on the real roster now that the student cards render from it —
  // declared here (rather than up near the other derived values) because
  // `realStudents` doesn't exist yet at that point in the script.
  /** Handed in, not yet judged — across every student, for the header. */
  const awaitingReview = $derived(realStudents.reduce(
    (n, st) => n + extrasFor(st.code).homework.filter(h => h.submitted && !h.graded).length, 0));
  const totalSessions = $derived(realStudents.reduce((n, s) => n + extrasFor(s.code).sessions.length, 0));
  const nextLessonsCount = $derived(realStudents.filter(s => {
    const nl = extrasFor(s.code).nextLesson;
    return nl?.date && nl.date >= israelToday();
  }).length);

  /* ═══════════════════ server-backed profile fields ═══════════════════
   * goals / style / notes / progress / progress-note — the five fields
   * PATCH /api/students/:code actually accepts (name/emoji/phone/account
   * name/subjects have no write endpoint and stay read-only display pulled
   * from `realStudents`).
   *
   * Saving here is never optimistic (repo rule): `realStudents` is only
   * ever updated from a server response, never from what the tutor just
   * typed. On failure the input is explicitly reverted to the value it had
   * before the edit — see onProfileFieldChange — so a rejected save cannot
   * leave a value on screen that the server never actually stored.
   */
  let profileSaving = $state<Record<string, boolean>>({});
  let profileSaved = $state<Record<string, boolean>>({});
  let profileError = $state<Record<string, string>>({});
  const profileSavedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  type ProfileField = 'goals' | 'style' | 'notes' | 'progress' | 'progressNote';

  /** Returns whether the save succeeded, so the caller can decide whether
   *  to revert what's on screen. */
  async function saveProfileField(code: string, field: ProfileField, value: string | number): Promise<boolean> {
    profileSaving = { ...profileSaving, [code]: true };
    profileError = { ...profileError, [code]: '' };
    try {
      const r = await fetch(`/api/students/${code}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        profileError = { ...profileError, [code]: body.error || 'השמירה נכשלה' };
        return false;
      }
      // The only place `realStudents` changes for this student: a whole-row
      // replace from what the server just confirmed, not a client patch.
      realStudents = realStudents.map(rs => rs.code === code ? { ...rs, ...body.student } : rs);
      profileSaved = { ...profileSaved, [code]: true };
      clearTimeout(profileSavedTimers[code]);
      profileSavedTimers[code] = setTimeout(() => { profileSaved = { ...profileSaved, [code]: false }; }, 1800);
      return true;
    } catch {
      profileError = { ...profileError, [code]: 'אין חיבור לשרת — לא נשמר' };
      return false;
    } finally {
      profileSaving = { ...profileSaving, [code]: false };
    }
  }

  /** Wires one input/textarea/select to a server field. `previous` is read
   *  from `realStudents` (the last confirmed value) before the request goes
   *  out, so a failed save can put exactly that back on screen — never the
   *  value the tutor just typed, and never a blank. */
  async function onProfileFieldChange(
    s: RealStudent, field: ProfileField, el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ) {
    const key = field === 'progressNote' ? 'progress_note' : field;
    const previous = (s as unknown as Record<string, unknown>)[key];
    const raw = el.value;

    let value: string | number = raw;
    if (field === 'progress') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        toast('ההתקדמות חייבת להיות מספר', { kind: 'error' });
        el.value = String(previous ?? 0);
        return;
      }
      value = n;
    }

    const ok = await saveProfileField(s.code, field, value);
    if (!ok) el.value = String(previous ?? '');
  }

  /* Replaces "regenerate their password". Minting a link revokes nothing,
     so helping one parent on the phone cannot lock out the child already
     using theirs. */
  let links = $state<Record<string, StudentLinks>>({});
  let linkBusy = $state('');

  async function loadLinks(code: string) {
    linkBusy = code;
    try {
      const r = await fetch(`/api/students/${code}/link`, { method: 'POST' });
      if (!r.ok) { toast('לא הצלחתי להכין קישור', { kind: 'error' }); return; }
      links = { ...links, [code]: await r.json() };
    } catch {
      toast('אין חיבור לשרת', { kind: 'error' });
    } finally {
      linkBusy = '';
    }
  }

  function copyText(label: string, value: string) {
    navigator.clipboard.writeText(value)
      .then(() => toast(`${label} הועתק`, { kind: 'success' }))
      .catch(() => toast(`${label}:\n${value}`, { sticky: true }));
  }

  /* ═══════════════════ explicit, reviewed import of the browser's local
     goals/style/notes/progress/progressNote ═══════════════════
   * Never automatic (אין להעתיק נתוני דפדפן אוטומטית בלי בדיקה) — this
   * panel only ever appears when the browser actually has something to
   * show, requires a click to do anything, and never touches localStorage
   * afterwards EXCEPT to record that the click happened (importedProfilesAt
   * — see the Store interface's comment): a stale-but-non-empty local value
   * would otherwise re-offer to overwrite a server edit made since, and the
   * "never blank a real value" rule the server enforces only protects an
   * *empty* local value, not a stale one.
   *
   * computeImportCandidates / buildImportPayload live in
   * $lib/import-candidates.ts — pure, unit-tested there — this file only
   * wires them to the browser's local blob, the roster, and the fetch call.
   * The server side (importLocalStudentProfiles) independently enforces
   * "never blank a real value with an empty local one" and "never create a
   * student"; this UI's job is only to show the tutor, before she clicks,
   * exactly what would be sent, to which student, and what it would replace.
   */
  type ImportOutcome =
    | { code: string; result: 'updated'; fields: string[] }
    | { code: string; result: 'skipped-no-match' }
    | { code: string; result: 'skipped-empty' };
  interface ImportResultRow {
    label: string;
    result: ImportOutcome['result'] | 'skipped-ambiguous';
    fields?: string[];
  }

  let importCandidates = $state<ImportCandidate[]>([]);
  let importRunning = $state(false);
  let importResults = $state<ImportResultRow[] | null>(null);
  // The panel hides itself once `data.importedProfilesAt` is set (see the
  // Store comment) — this is the escape hatch for the genuine "I have
  // another device/browser to import from" case, set only by an explicit
  // click, never automatically.
  let showImportPanelAnyway = $state(false);

  async function runImport() {
    const toSend = buildImportPayload(importCandidates);

    importRunning = true;
    try {
      const r = await fetch('/api/students/import-local', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: toSend }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { toast('הייבוא נכשל', { kind: 'error' }); return; }
      const outcomes = (body.results ?? []) as ImportOutcome[];

      // Line up every candidate with an outcome, including the ones that
      // never had a match (or had more than one, and so were never sent) —
      // the tutor sees the full picture, not just what reached the server.
      importResults = importCandidates.map((c): ImportResultRow => {
        if (c.status === 'ambiguous') return { label: c.localName, result: 'skipped-ambiguous' };
        if (c.status !== 'matched' || !c.code) return { label: c.localName, result: 'skipped-no-match' };
        const found = outcomes.find(o => o.code === c.code);
        if (!found) return { label: c.localName, result: 'skipped-no-match' };
        return { label: c.localName, result: found.result, fields: 'fields' in found ? found.fields : undefined };
      });

      // Record that the click happened — this is what keeps the panel from
      // reappearing (and re-offering to overwrite) on the next reload. Set
      // regardless of how many entries actually matched: the tutor reviewed
      // and clicked, which is the action this marker exists to remember.
      data.importedProfilesAt = new Date().toISOString();
      save();
      showImportPanelAnyway = false;

      // Re-render the cards with whatever the import just wrote.
      await loadCodes();
    } catch {
      toast('אין חיבור לשרת — הייבוא לא בוצע', { kind: 'error' });
    } finally {
      importRunning = false;
    }
  }

  /* ═══════════════════ real payments — tutor marks charges ═══════════════════
     Driven by realStudents (the real entity model above), not data.students
     (the localStorage CRM) — see this file's header comment. */
  const KIND_LABEL: Record<string, string> = { single: 'יחיד', double: 'כפול', triple: 'משולש' };
  const STATUS_LABEL: Record<string, string> = { owed: 'לתשלום', paid: 'שולם', void: 'בוטל' };

  let chargesFor = $state<Record<string, Array<{ id: number; date: string; kind: string; amount_agorot: number; status: string }>>>({});
  let picked = $state(new SvelteSet<number>());

  async function loadCharges(code: string) {
    const r = await fetch(`/api/payments?student=${encodeURIComponent(code)}`, { cache: 'no-store' });
    if (!r.ok) { toast('לא הצלחתי לטעון חיובים', { kind: 'error' }); return; }
    chargesFor = { ...chargesFor, [code]: (await r.json()).charges };
  }

  function toggle(id: number) {
    if (picked.has(id)) picked.delete(id); else picked.add(id);
  }

  async function mark(code: string, status: 'owed' | 'paid' | 'void') {
    // Only this panel's charges — see payments-selection.ts for why.
    const ids = idsForPanel(picked, chargesFor[code] ?? []);
    if (!ids.length) { toast('לא נבחרו חיובים', { kind: 'error' }); return; }

    const r = await fetch('/api/payments/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    });
    if (!r.ok) { toast('העדכון נכשל', { kind: 'error' }); return; }

    // Clear only what this action consumed, so a selection in another open
    // panel survives.
    for (const id of ids) picked.delete(id);
    await Promise.all([loadCharges(code), loadAllBalance()]);
  }

  /* ═══════════════════ calendar-write failures ═══════════════════ */
  interface CalendarFailure { id: number; name: string; start: string }
  let calendarFailures = $state<CalendarFailure[]>([]);

  /* ═══════════════════ calendar-READ issues ═══════════════════
     A feed /api/availability couldn't read this cycle — never identified by
     URL (that's a secret), only by position among the configured feeds. */
  interface CalendarSourceIssue { index: number; total: number; at: string; reason: string }
  let calendarSourceIssues = $state<CalendarSourceIssue[]>([]);

  async function loadCalendarFailures() {
    try {
      const r = await fetch('/api/calendar-failures');
      if (!r.ok) return;
      const j = await r.json();
      calendarFailures = (j.failures ?? []) as CalendarFailure[];
      calendarSourceIssues = (j.sourceIssues ?? []) as CalendarSourceIssue[];
    } catch { /* not critical — the booking email already has the same warning */ }
  }
  async function resolveCalendarFailure(id: number) {
    await fetch(`/api/calendar-failures/${id}/resolve`, { method: 'POST' }).catch(() => {});
    loadCalendarFailures();
  }

  /* ═══════════════════ homework results (/api/results) ═══════════════════ */
  interface TopMissed { item: string; times: number }
  interface ResultsStudent { plays: number; lastPlayed: string | null; accuracy: number | null; wrong: number; tries: number | null; minutes: number; topMissed: TopMissed[] }
  let hwResults = $state<Record<string, ResultsStudent> | null>(null);
  let hwLoading = $state(true);
  let hwError = $state('');

  async function loadHomeworkResults() {
    hwLoading = true;
    hwError = '';
    try {
      const r = await fetch('/api/results', { credentials: 'same-origin' });
      const j = await r.json();
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.status !== 200) throw new Error(j.error || String(r.status));
      hwResults = j.students ?? {};
    } catch {
      hwError = 'לא הצלחתי לטעון תוצאות כרגע';
    } finally {
      hwLoading = false;
    }
  }
  function accuracyColor(acc: number | null): string {
    if (acc === null) return 'var(--text-muted)';
    if (acc >= 80) return 'var(--accent3-strong)';
    if (acc >= 55) return 'var(--accent2-strong)';
    return 'var(--danger)';
  }

  /* ═══════════════════ auto-generated lessons (/api/lessons) ═══════════════════ */
  interface LessonGame { title: string; url: string | null; broken: boolean }
  interface LessonEntry {
    slug: string; student: string; subject: string | null; title: string | null; topic: string | null;
    context: string | null; status: string; problem: string | null; slidesUrl: string | null;
    homework: unknown[]; games: LessonGame[]; level: string | null;
  }
  let lessons = $state<LessonEntry[]>([]);
  let lessonsLoading = $state(true);
  let lessonsError = $state('');

  const LESSON_BADGE: Record<string, [string, string, string]> = {
    generating: ['בתהליך…', 'var(--text-muted)', 'var(--bg-surface)'],
    ready:      ['מוכן',    'var(--accent3-strong)', 'var(--accent3-dim)'],
    held:       ['לבדיקה',  'var(--accent2-strong)', 'var(--accent2-dim)'],
    failed:     ['נכשל',    'var(--danger)', 'rgba(220,38,38,0.08)'],
  };
  function lessonBadge(status: string): [string, string, string] {
    return LESSON_BADGE[status] ?? LESSON_BADGE.generating;
  }

  async function loadLessons() {
    lessonsLoading = true;
    lessonsError = '';
    try {
      const r = await fetch('/api/lessons', { credentials: 'same-origin' });
      const j = await r.json();
      lessons = (j.lessons ?? []) as LessonEntry[];
    } catch {
      lessonsError = 'לא הצלחתי לטעון שיעורים';
    } finally {
      lessonsLoading = false;
    }
  }

  onMount(() => {
    data = loadData();
    // Computed once, off the browser's existing local blob and the roster
    // already seeded from the page load — never re-run automatically after
    // this, per the task's "never automatic" rule. Reviewing/importing is a
    // one-time, explicit action for as long as this panel is visible.
    importCandidates = computeImportCandidates(data.students, realStudents);
    loadCodes();
    loadActivities();
    loadAllBalance();
    loadHomeworkResults();
    loadLessons();
    loadCalendarFailures();
  });
</script>

<svelte:head>
  <title>לוח בקרה — שיעורים פרטיים</title>
</svelte:head>

<div id="nav">
  <div class="nav-logo">
    <BrandMark height={28} label={null} />
    <span class="nav-title">לוח בקרה</span>
    <span class="nav-sub">{tutorNames()} · שיעורים פרטיים</span>
  </div>
  <div class="nav-actions">
    <span class="save-indicator" class:show={saveIndicatorVisible}>✓ נשמר</span>
    <button class="btn btn-outline" onclick={openModal}>+ תלמיד חדש</button>
    <a href="/app/marketing" class="btn btn-ghost">שיווק</a>
    <a href="/" class="btn btn-ghost">← האתר</a>
    <button class="btn btn-ghost" onclick={signOut}>יציאה</button>
  </div>
</div>

<div class="page">
  <ReportQueue lessons={pageData.pendingReports} />

  {#if calendarFailures.length}
    <div class="cf-banner">
      <div class="cf-title">⚠️ {calendarFailures.length} שיעור/ים לא נוספו ליומן אוטומטית — צריך להוסיף ידנית</div>
      {#each calendarFailures as f (f.id)}
        <div class="cf-row">
          <span>{f.name} · {String(f.start).slice(0, 16).replace('T', ' ')}</span>
          <button class="cf-resolve" onclick={() => resolveCalendarFailure(f.id)}>הוספתי ליומן <Icon name="check" size={15} /></button>
        </div>
      {/each}
    </div>
  {/if}

  {#if calendarSourceIssues.length}
    <div class="cs-banner" role="alert">
      <div class="cs-title">⛔ קריאת יומן נכשלה — ייתכן ששעות תפוסות מוצגות כפנויות</div>
      {#each calendarSourceIssues as s (s.index)}
        <div class="cs-row">
          <span class="cs-src">יומן {s.index} מתוך {s.total}</span>
          <span class="cs-reason">({s.reason} · {String(s.at).slice(0, 16).replace('T', ' ')})</span>
        </div>
      {/each}
      <div class="cs-note">השעות של היומן/ים האלה לא נבדקו בהצלחה לאחרונה, ולכן ייתכן שהן מוצעות כפנויות בטופס ההזמנה למרות שהן תפוסות בפועל. מומלץ לבדוק ידנית עד שהיומן יחזור להתעדכן.</div>
    </div>
  {/if}

  {#if importResults}
    <div class="import-panel">
      <div class="import-title"><Icon name="done" size={16} /> תוצאות הייבוא</div>
      <ul class="import-results">
        {#each importResults as r}
          <li>
            <b>{r.label}</b> —
            {#if r.result === 'updated'}
              עודכן בשרת ({r.fields?.join(', ') ?? ''})
            {:else if r.result === 'skipped-ambiguous'}
              שם כפול בין כמה תלמידים ברשימה — לא ניתן היה לקבוע התאמה ודאית, לא נשלח (טיפול ידני)
            {:else if r.result === 'skipped-no-match'}
              לא נמצאה התאמה לתלמיד/ה בשרת — לא יובא
            {:else}
              לא נמצא מה לייבא (השדות המקומיים ריקים)
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else if importCandidates.length && data.importedProfilesAt && !showImportPanelAnyway}
    <div class="import-hint">
      <span>💾 נתוני הדפדפן הזה כבר יובאו לשרת בעבר ({formatDate(data.importedProfilesAt.slice(0, 10))}).</span>
      <button class="btn btn-ghost btn-sm tap44" onclick={() => showImportPanelAnyway = true}>
        הצג בכל זאת (למשל, ייבוא ממכשיר/דפדפן נוסף)
      </button>
    </div>
  {:else if importCandidates.length}
    <div class="import-panel">
      <div class="import-title">📋 נמצאו נתונים שקיימים רק בדפדפן הזה</div>
      <p class="import-copy">
        הייבוא מעביר לשרת חמישה שדות שנשמרו עד עכשיו רק בדפדפן הזה: מטרות, סגנון למידה, הערות,
        אחוז התקדמות והערת התקדמות. שדות נוספים מהכרטיס הישן — אימוג'י, רמה, טלפון תלמיד/ה וטלפון
        הורה — <b>אינם</b> מיובאים ואינם ניתנים לעריכה יותר במסך הזה; אם הם חשובים לך, כדאי לשמור
        אותם לפני שמנקים את נתוני הדפדפן. כלום לא נמחק מהדפדפן על ידי הייבוא עצמו, וההעתק המקומי
        יישאר כפי שהוא. הייבוא קורה רק בלחיצה על הכפתור — שום דבר לא מועתק אוטומטית.
      </p>
      <p class="import-copy" style="font-weight:700">
        ⚠️ ערך מקומי ריק לעולם לא ידרוס ערך שכבר קיים בשרת — אבל ערך מקומי שאינו ריק כן יחליף את
        מה שרשום בשרת כרגע, גם אם השרת עודכן מאז מאוחר יותר. עמודת "בשרת" בכל שורה מראה בדיוק מה
        יוחלף — כדאי לבדוק אותה לפני שלוחצים ייבוא.
      </p>
      <div class="import-table-wrap">
        <table class="import-table">
          <thead>
            <tr>
              <th>תלמיד/ה (מקומי)</th><th>מטרות</th><th>סגנון</th><th>הערות</th>
              <th>התקדמות (%)</th><th>הערת התקדמות</th><th>התאמה בשרת</th>
            </tr>
          </thead>
          <tbody>
            {#each importCandidates as c}
              {@const srv = c.code ? realStudents.find(rs => rs.code === c.code) : null}
              <tr>
                <td>{c.localName}</td>
                <td>{c.goals || '—'}<div class="import-server-val">בשרת: {srv?.goals || '—'}</div></td>
                <td>{c.style || '—'}<div class="import-server-val">בשרת: {srv?.style || '—'}</div></td>
                <td>{c.notes || '—'}<div class="import-server-val">בשרת: {srv?.notes || '—'}</div></td>
                <td>{c.progress || 0}%<div class="import-server-val">בשרת: {srv?.progress ?? 0}%</div></td>
                <td>{c.progressNote || '—'}<div class="import-server-val">בשרת: {srv?.progress_note || '—'}</div></td>
                <td>
                  {#if c.status === 'matched'}
                    {c.matchName} · <code style="direction:ltr">{c.code}</code>
                  {:else if c.status === 'ambiguous'}
                    <span style="color:var(--danger)">⚠ שם כפול — אין התאמה ודאית, לא ייובא</span>
                  {:else}
                    <span style="color:var(--danger)">⚠ אין התאמה — לא ייובא</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button class="btn btn-gold tap44" disabled={importRunning} onclick={runImport}>
        {importRunning ? '...מייבא' : '⬆ ייבוא לשרת'}
      </button>
    </div>
  {/if}

  <div class="stats-bar">
    <div class="stat-card">
      <div class="s-label">תלמידים פעילים</div>
      <div class="s-value gold">{realStudents.length}</div>
      <div class="s-sub">תלמידים רשומים</div>
    </div>
    <div class="stat-card">
      <div class="s-label">שיעורים שניתנו</div>
      <div class="s-value">{totalSessions}</div>
      <div class="s-sub">סה"כ שיעורים</div>
    </div>
    <div class="stat-card">
      <div class="s-label">שולם</div>
      <div class="s-value green">{allBalance ? formatAgorot(allBalance.paidAgorot) : '—'}</div>
      <div class="s-sub">{allBalance ? `${formatAgorot(allBalance.dueAgorot)} לגבייה` : ''}</div>
    </div>
    <div class="stat-card">
      <div class="s-label">יתרה לגבייה</div>
      <div class="s-value" class:red={!!allBalance && allBalance.dueAgorot > 0} class:green={!!allBalance && allBalance.dueAgorot <= 0}>{allBalance ? formatAgorot(allBalance.dueAgorot) : '—'}</div>
      <div class="s-sub">{allBalance ? (allBalance.dueAgorot > 0 ? 'טרם שולם' : 'מלא שולם ✓') : ''}</div>
    </div>
    <div class="stat-card">
      <div class="s-label">שיעורים קרובים</div>
      <div class="s-value gold">{nextLessonsCount}</div>
      <div class="s-sub">מתוכננים</div>
    </div>
    <div class="stat-card">
      <div class="s-label">שיעורי בית</div>
      <div class="s-value">{awaitingReview}</div>
      <div class="s-sub">{awaitingReview ? 'ממתינות לבדיקה — בלשונית שיעורי בית' : 'אין עבודות ממתינות לבדיקה'}</div>
    </div>
  </div>

  <div class="sec-header">
    <div>
      <div class="sec-label2">תלמידים פעילים</div>
      <h2 class="sec-h2">לוח תלמידים</h2>
    </div>
  </div>
  <div class="students-grid">
    {#if !realStudents.length}
      <div class="empty">אין תלמידים עדיין — לחץ "תלמיד חדש" כדי להתחיל</div>
    {:else}
      {#each realStudents as s (s.code)}
        {@const t = studentTotals(s.code)}
        {@const ex = extrasFor(s.code)}
        {@const sf = sessionForm(s.code)}
        {@const hf = hwForm(s.code)}
        <div class="student-card">
          <div class="sc-header">
            <div class="sc-header-left">
              <div class="sc-avatar">{s.emoji || '🎓'}</div>
              <div>
                <div class="sc-name">{s.name}</div>
                <div class="sc-subject">{s.subjects || '—'}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
              <div class="sc-badges">
                {#if s.style}<span class="badge badge-style">{s.style}</span>{/if}
                {#if t.balance > 0}
                  <span class="badge badge-warn">₪{t.balance} חוב</span>
                {:else}
                  <span class="badge badge-ok">שולם ✓</span>
                {/if}
                {#if t.hwPending > 0}
                  <span class="badge badge-warn">{t.hwPending} ש"ב פתוחים</span>
                {/if}
              </div>
              <button class="btn btn-danger btn-sm" onclick={() => deleteStudent(s.code)}><Icon name="delete" size={15} /> מחק</button>
            </div>
          </div>

          <div class="sc-body">
            <div class="sc-tabs">
              <div class="sc-tab" class:active={tabFor(s.code) === 'overview'} onclick={() => switchTab(s.code, 'overview')} role="tab" tabindex="0" onkeydown={(e) => e.key === 'Enter' && switchTab(s.code, 'overview')}>סקירה</div>
              <div class="sc-tab" class:active={tabFor(s.code) === 'learning-plan'} onclick={() => switchTab(s.code, 'learning-plan')} role="tab" tabindex="0" onkeydown={(e) => e.key === 'Enter' && switchTab(s.code, 'learning-plan')}>תכנית למידה</div>
              <div class="sc-tab" class:active={tabFor(s.code) === 'payments'} onclick={() => switchTab(s.code, 'payments')} role="tab" tabindex="0" onkeydown={(e) => e.key === 'Enter' && switchTab(s.code, 'payments')}>תשלומים</div>
              <div class="sc-tab" class:active={tabFor(s.code) === 'homework'} onclick={() => switchTab(s.code, 'homework')} role="tab" tabindex="0" onkeydown={(e) => e.key === 'Enter' && switchTab(s.code, 'homework')}>שיעורי בית</div>
              <div class="sc-tab" class:active={tabFor(s.code) === 'profile'} onclick={() => switchTab(s.code, 'profile')} role="tab" tabindex="0" onkeydown={(e) => e.key === 'Enter' && switchTab(s.code, 'profile')}>פרופיל</div>
            </div>

            <!-- OVERVIEW -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'overview'}>
              <div class="server-source-note">נתוני השיעור הבא נטענים מההזמנות שבשרת ומתעדכנים לאחר רענון.</div>
              {#if ex.nextLesson?.date}
                <div class="next-lesson-box" style="margin-bottom:14px">
                  <div class="nl-label">📅 שיעור הבא</div>
                  <div class="nl-date">{formatDate(ex.nextLesson.date)}{ex.nextLesson.time ? ' · ' + ex.nextLesson.time : ''}</div>
                  <div class="nl-meta">סוג: {ex.nextLesson.type || 'יחיד'}</div>
                </div>
              {:else}
                <div class="next-lesson-box" style="margin-bottom:14px">
                  <div class="nl-label">📅 שיעור הבא</div>
                  <div class="nl-date" style="font-size:1rem;color:var(--text-muted)">לא קבוע</div>
                </div>
              {/if}

              <div class="divider"></div>

              <!-- Progress / progress-note are server-backed: saving is
                   never optimistic, so this input only ever shows the
                   server's last confirmed value. -->
              <!-- No hand-typed percentage: families see progress computed
                   from the plan and the homework (src/lib/server/progress.ts),
                   and the number typed here reached nobody. -->
              <div class="field">
                <label for="note-{s.code}">הערה להורים על ההתקדמות — מוצגת להורים בלבד, לא לתלמיד/ה</label>
                <textarea id="note-{s.code}" onchange={(e) => onProfileFieldChange(s, 'progressNote', e.currentTarget)}>{s.progress_note || ''}</textarea>
              </div>
              {#if profileError[s.code]}<div class="field-error">{profileError[s.code]}</div>{/if}
            </div>

            <!-- PERSONAL LEARNING PLAN -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'learning-plan'}>
              <LearningPlanTree
                student={{ id: s.code, name: s.name, subject: s.subjects || '', goals: s.goals || '', level: '', progress: s.progress }}
                lessons={lessons.filter((lesson) => lesson.student === s.name).map((lesson) => ({
                  slug: lesson.slug, title: lesson.title, topic: lesson.topic, context: lesson.context,
                  homework: lesson.homework, games: lesson.games,
                }))}
                topics={dashboardPlans[s.code]?.topics ?? []}
                onstatus={(nodeId, status) => updateDashboardPlanStatus(s.code, nodeId, status)}
              />
            </div>

            <!-- PAYMENTS -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'payments'}>
              <div class="server-source-note">השיעורים והתשלומים מוצגים מרשומות השרת. רישום ידני חדש נשמר בשרת.</div>
              <div class="payment-summary">
                <div class="ps-item"><div class="psi-val" style="color:var(--text-primary)">₪{t.owed}</div><div class="psi-lbl">סה"כ</div></div>
                <div class="ps-item"><div class="psi-val" style="color:var(--accent3-strong)">₪{t.paid}</div><div class="psi-lbl">שולם</div></div>
                <div class="ps-item"><div class="psi-val" style="color:{t.balance > 0 ? 'var(--danger)' : 'var(--accent3-strong)'}">₪{t.balance}</div><div class="psi-lbl">יתרה</div></div>
                <div class="ps-item"><div class="psi-val" style="color:var(--text-primary)">{ex.sessions.length}</div><div class="psi-lbl">שיעורים</div></div>
              </div>

              <div class="add-form" class:open={openForms[`${s.code}:session`]}>
                <h4>➕ הוסף שיעור</h4>
                <div class="field-row three">
                  <div class="field"><label for="sf-date-{s.code}">תאריך</label>
                    <input id="sf-date-{s.code}" type="date" value={sf.date} oninput={(e) => setSessionField(s.code, 'date', e.currentTarget.value)} /></div>
                  <div class="field"><label for="sf-type-{s.code}">סוג</label>
                    <select id="sf-type-{s.code}" value={sf.type} onchange={(e) => setSessionField(s.code, 'type', e.currentTarget.value)}>
                      <option value="יחיד · 45 דק׳">יחיד · 45 דק׳</option>
                      <option value="כפול · 90 דק׳">כפול · 90 דק׳</option>
                      <option value="משולש · 135 דק׳">משולש · 135 דק׳</option>
                    </select>
                  </div>
                  <div class="field"><label for="sf-amount-{s.code}">סכום ₪</label>
                    <input id="sf-amount-{s.code}" type="number" value={sf.amount} oninput={(e) => setSessionField(s.code, 'amount', +e.currentTarget.value)} /></div>
                </div>
                <div class="field-row">
                  <div class="field"><label for="sf-paid-{s.code}">סטטוס</label>
                    <select id="sf-paid-{s.code}" value={sf.paid} onchange={(e) => setSessionField(s.code, 'paid', e.currentTarget.value)}>
                      <option value="true">✅ שולם</option><option value="false">⏳ טרם שולם</option>
                    </select>
                  </div>
                  <div class="field"><label for="sf-notes-{s.code}">הערות</label>
                    <input id="sf-notes-{s.code}" type="text" placeholder="הערות לשיעור..." value={sf.notes} oninput={(e) => setSessionField(s.code, 'notes', e.currentTarget.value)} /></div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn btn-gold btn-sm" onclick={() => addSession(s.code)}>שמור שיעור</button>
                  <button class="btn btn-ghost btn-sm" onclick={() => toggleForm(`${s.code}:session`)}>ביטול</button>
                </div>
              </div>

              <button class="btn btn-outline btn-sm" style="margin-bottom:10px" onclick={() => toggleForm(`${s.code}:session`)}>+ הוסף שיעור</button>

              {#if ex.sessions.length}
                <table class="payments-table">
                  <thead><tr><th>תאריך</th><th>סוג</th><th>סכום</th><th>סטטוס</th><th></th></tr></thead>
                  <tbody>
                    {#each ex.sessions as sess (sess.id)}
                      <tr>
                        <td>{formatDate(sess.date)}</td>
                        <td>{sess.type}</td>
                        <td>₪{sess.amount}</td>
                        <td>{#if sess.paid}<span class="paid-badge">✅ שולם</span>{:else}<span class="unpaid-badge">⏳ טרם שולם</span>{/if}</td>
                        <td style="text-align:left">
                          <button class="btn btn-ghost btn-sm" onclick={() => togglePaid(s.code, sess.id)}>{sess.paid ? 'סמן כלא שולם' : 'סמן כשולם'}</button>
                          <button class="btn btn-danger btn-sm" onclick={() => voidSession(s.code, sess.id)}>בטל</button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {:else}
                <div class="empty">אין שיעורים עדיין</div>
              {/if}
            </div>

            <!-- HOMEWORK -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'homework'}>
              <div class="server-source-note">שיעורי הבית נשמרים בשרת ומשותפים בין מכשירים.</div>
              <div class="add-form" class:open={openForms[`${s.code}:hw`]}>
                <h4>➕ הוסף שיעור בית</h4>
                <div class="field-row">
                  <div class="field"><label for="hf-task-{s.code}">משימה</label>
                    <input id="hf-task-{s.code}" type="text" placeholder="תאר את המשימה..." value={hf.task} oninput={(e) => setHwField(s.code, 'task', e.currentTarget.value)} /></div>
                  <div class="field"><label for="hf-date-{s.code}">תאריך</label>
                    <input id="hf-date-{s.code}" type="date" value={hf.date} oninput={(e) => setHwField(s.code, 'date', e.currentTarget.value)} /></div>
                </div>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <button class="btn btn-gold btn-sm" onclick={() => addHomework(s.code)}>שמור</button>
                  <button class="btn btn-ghost btn-sm" onclick={() => toggleForm(`${s.code}:hw`)}>ביטול</button>
                </div>
              </div>

              <button class="btn btn-outline btn-sm" style="margin-bottom:12px" onclick={() => toggleForm(`${s.code}:hw`)}>+ הוסף שיעור בית</button>

              {#if ex.homework.length}
                <div>
                  {#each ex.homework as hw (hw.id)}
                    <div class="hw-item">
                      <div class="hw-check" class:done={hw.submitted} onclick={() => toggleHw(s.code, hw.id)} role="checkbox" aria-checked={hw.submitted} tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggleHw(s.code, hw.id)}>{hw.submitted ? '✓' : ''}</div>
                      <div class="hw-text">
                        <div class="hw-task" class:done-text={hw.submitted || hw.graded}>{hw.task}</div>
                        <div class="hw-date">{formatDate(hw.date)}</div>
                        {#if hw.submitted && !hw.graded}
                          <!-- Handed in and waiting for her: the child sees
                               «הוגש — ממתין לבדיקה» until one of these. -->
                          <div class="hw-grade" role="group" aria-label="בדיקת שיעורי הבית">
                            {#each GRADES as g (g)}
                              <button class="btn btn-sm hw-grade-btn" onclick={() => gradeHw(s.code, hw.id, g)}>{GRADE_BUTTON[g]}</button>
                            {/each}
                          </div>
                        {:else if hw.graded && hw.grade}
                          <div class="hw-graded">{GRADE_LABEL[hw.grade]} · <button class="link-btn" onclick={() => gradeHw(s.code, hw.id, null)}>ביטול</button></div>
                        {/if}
                        {#if hw.heldUntil}
                          <!-- Held, not missing: the lesson report replaces it with
                               homework from what was taught, or it goes out by itself. -->
                          <div class="hw-held">ממתין לדיווח על השיעור · יישלח לבד ב-{formatDate(israelDay(hw.heldUntil))}</div>
                        {/if}
                      </div>
                      <button class="btn btn-danger btn-sm" aria-label="מחיקת שיעורי הבית" onclick={() => deleteHw(s.code, hw.id)}><Icon name="delete" size={14} /></button>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="empty">אין שיעורי בית עדיין</div>
              {/if}
            </div>

            <!-- PROFILE — every field here is either server-backed (goals/
                 style/notes) or a read-only render of the server row (name/
                 emoji/phone/account name are edited nowhere in this repo yet;
                 there is no PATCH support for them). -->
            <div class="sc-panel" class:active={tabFor(s.code) === 'profile'}>
              <div class="field-row">
                <div class="field"><span class="field-label">שם</span><div class="readonly-value">{s.name}</div></div>
                <div class="field"><span class="field-label">מקצועות</span><div class="readonly-value">{s.subjects || '—'}</div></div>
              </div>
              <div class="field-row">
                <div class="field"><span class="field-label">טלפון</span><div class="readonly-value" dir="ltr">{s.account_phone || '—'}</div></div>
                <div class="field"><span class="field-label">הורה / חשבון</span><div class="readonly-value">{s.account_name}</div></div>
              </div>
              <div class="field-row three">
                <div class="field"><label for="pf-style-{s.code}">סגנון למידה</label>
                  <select id="pf-style-{s.code}" onchange={(e) => onProfileFieldChange(s, 'style', e.currentTarget)}>
                    <option value="" selected={!s.style}>— לא נבחר —</option>
                    {#each STYLES as st}<option value={st} selected={s.style === st}>{st}</option>{/each}
                  </select>
                </div>
              </div>
              <div class="field-row single">
                <div class="field"><label for="pf-goals-{s.code}">מטרות</label>
                  <textarea id="pf-goals-{s.code}" onchange={(e) => onProfileFieldChange(s, 'goals', e.currentTarget)}>{s.goals || ''}</textarea></div>
              </div>
              <div class="field-row single">
                <div class="field"><label for="pf-notes-{s.code}">הערות כלליות</label>
                  <textarea id="pf-notes-{s.code}" onchange={(e) => onProfileFieldChange(s, 'notes', e.currentTarget)}>{s.notes || ''}</textarea></div>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="save-indicator" class:show={profileSaved[s.code]}>✓ נשמר</span>
                {#if profileError[s.code]}<div class="field-error">{profileError[s.code]}</div>{/if}
              </div>
              <div class="divider"></div>
              <div class="field-row">
                <div class="field">
                  <!-- Same-tab in-app link now that /app/* shares a layout (sub-project #4) —
                       the old page opened this target="_blank". -->
                  <a href="/app/parent" class="btn btn-outline btn-sm" style="text-align:center;text-decoration:none">
                    🔗 פתח פורטל הורים
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">גישה</div>
      <h2 class="sec-h2">כניסה לפורטל</h2>
    </div>
  </div>
  <div class="codes-panel">
    {#if codesLoading}
      <div class="codes-msg">טוען…</div>
    {:else if codesError}
      <div class="codes-msg">{codesError}</div>
    {:else if !realStudents.length}
      <div class="codes-msg">עדיין אין תלמידים עם קוד. הוסיפו תלמיד חדש כדי לייצר קודים.</div>
    {:else}
      <table class="codes-table">
        <thead><tr><th>תלמיד</th><th>משפחה / מייל</th><th>כניסה</th></tr></thead>
        <tbody>
          {#each realStudents as rs (rs.code)}
            <tr>
              <td>
                {rs.name}
                <a class="copy-btn plan-link" href="/app/plan/{rs.code}">תכנית</a>
                <div class="rs-sub"><code style="direction:ltr">{rs.code}</code> {rs.subjects || ''}</div>
              </td>
              <td>
                {rs.account_name}
                <div class="rs-sub" style="direction:ltr">{rs.email || '— אין מייל'}</div>
              </td>
              <td>
                {#if links[rs.code]}
                  <div class="rs-links">
                    <button class="copy-btn" onclick={() => copyText('הקישור למשפחה', links[rs.code].familyLink)}><Icon name="family" size={15} /> קישור להורה</button>
                    <button class="copy-btn" onclick={() => copyText('הקישור לתלמיד/ה', links[rs.code].studentLink)}><Icon name="student" size={15} /> קישור לתלמיד/ה</button>
                    <span class="rs-join">קוד: <b style="direction:ltr">{links[rs.code].joinCode}</b></span>
                  </div>
                {:else}
                  <button class="copy-btn" disabled={linkBusy === rs.code} onclick={() => loadLinks(rs.code)}>
                    {linkBusy === rs.code ? '...מכין' : 'הכנת קישורים'}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">גבייה</div>
      <h2 class="sec-h2">תשלומים</h2>
    </div>
  </div>
  <div class="panel">
    {#each realStudents as rs (rs.code)}
      <div class="pay-row">
        <button class="copy-btn" onclick={() => loadCharges(rs.code)}>
          {rs.name} — {chargesFor[rs.code] ? 'רענון' : 'הצגת חיובים'}
        </button>
        {#if chargesFor[rs.code]}
          <table class="codes-table">
            <thead><tr><th></th><th>תאריך</th><th>שיעור</th><th>סכום</th><th>סטטוס</th></tr></thead>
            <tbody>
              {#each chargesFor[rs.code] as c (c.id)}
                <tr>
                  <td><input type="checkbox" checked={picked.has(c.id)} onchange={() => toggle(c.id)} /></td>
                  <td>{c.date}</td>
                  <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                  <td>{formatAgorot(c.amount_agorot)}</td>
                  <td>{STATUS_LABEL[c.status] ?? c.status}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <div class="pay-actions">
            <button class="copy-btn" onclick={() => mark(rs.code, 'paid')}>סימון כשולם</button>
            <button class="copy-btn" onclick={() => mark(rs.code, 'owed')}>החזרה לחוב</button>
            <button class="copy-btn" onclick={() => mark(rs.code, 'void')}>ביטול חיוב</button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">שיעורי בית</div>
      <h2 class="sec-h2">מצב שיעורי בית 🎮</h2>
    </div>
    <button class="btn-ghost" style="align-self:center" onclick={loadHomeworkResults}>רענון ↻</button>
  </div>
  <div id="hw-results">
    {#if hwLoading}
      <div class="empty">טוען תוצאות…</div>
    {:else if hwError}
      <div class="empty">{hwError}</div>
    {:else if !hwResults || !Object.keys(hwResults).length}
      <div class="empty">אף תלמיד עדיין לא סיים משחק</div>
    {:else}
      {#each Object.entries(hwResults) as [name, res] (name)}
        <div class="hwr-card">
          <div class="hwr-head">
            <div class="hwr-name">{name}</div>
            <div class="hwr-when">{res.lastPlayed ? 'שיחק לאחרונה: ' + formatDate(res.lastPlayed.slice(0, 10)) : ''}</div>
          </div>
          <div class="hwr-stats">
            <div class="hwr-stat"><div class="hwr-val">{res.plays}</div><div class="hwr-lbl">משחקים</div></div>
            <div class="hwr-stat"><div class="hwr-val" style="color:{accuracyColor(res.accuracy)}">{res.accuracy === null ? '—' : res.accuracy + '%'}</div><div class="hwr-lbl">דיוק</div></div>
            <div class="hwr-stat"><div class="hwr-val" style="color:var(--danger)">{res.wrong}</div><div class="hwr-lbl">טעויות</div></div>
            {#if res.tries !== null}
              <div class="hwr-stat"><div class="hwr-val">{res.tries}</div><div class="hwr-lbl">ניסיונות</div></div>
            {/if}
            <div class="hwr-stat"><div class="hwr-val">{res.minutes}</div><div class="hwr-lbl">דקות</div></div>
          </div>
          {#if res.topMissed.length}
            <div class="hwr-missed">
              <div class="hwr-missed-title">🔁 מה חוזר על עצמו כטעות</div>
              {#each res.topMissed as m}
                <div class="hwr-miss"><span>{m.item}</span><span class="hwr-miss-n">×{m.times}</span></div>
              {/each}
            </div>
          {:else}
            <div class="hwr-missed"><div class="hwr-missed-title" style="color:var(--accent3-strong)">✅ אין טעויות חוזרות</div></div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">אוטומטי</div>
      <h2 class="sec-h2">שיעורים שנוצרו ✨</h2>
    </div>
    <button class="btn-ghost" style="align-self:center" onclick={loadLessons}>רענון ↻</button>
  </div>
  <div id="lessons-list">
    {#if lessonsLoading}
      <div class="empty">טוען…</div>
    {:else if lessonsError}
      <div class="empty">{lessonsError}</div>
    {:else if !lessons.length}
      <div class="empty">עדיין לא נוצרו שיעורים אוטומטית.<br>שיעור נוצר כשתלמיד מזמין שיעור.</div>
    {:else}
      {#each lessons as l (l.slug)}
        {@const b = lessonBadge(l.status)}
        <div class="lsn-card">
          <div class="lsn-head">
            <div>
              <div class="lsn-title">{l.title || l.topic || '—'}</div>
              <div class="lsn-meta">{l.student} · {l.subject || ''} {l.level || ''}</div>
            </div>
            <span class="lsn-badge" style="color:{b[1]};background:{b[2]}">{b[0]}</span>
          </div>
          {#if l.context}<div class="lsn-context">{l.context}</div>{/if}
          {#if l.problem}<div class="lsn-problem">⚠ {l.problem}</div>{/if}
          <div class="lsn-links">
            {#if l.slidesUrl}<a href={l.slidesUrl} target="_blank" rel="noopener">📊 מצגת</a>{/if}
            <!-- The release valve (PRODUCT.md, Lesson autopilot): only a lesson
                 that generated has a plan to edit. -->
            {#if l.status === 'ready'}<a href="/app/lessons/{l.slug}/edit">✏️ עריכה</a>{/if}
            {#each l.games as g}
              {#if g.url}
                <a href={toHref(g.url)} target="_blank" rel="noopener">🎮 {g.title}</a>
              {:else}
                <span class="lsn-broken" title="לא הצלחתי לבנות קישור למשחק הזה">⚠ {g.title} — קישור שבור</span>
              {/if}
            {/each}
          </div>
          {#if l.homework.length}<div class="lsn-hw">📝 {l.homework.length} משימות</div>{/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- toasts -->
<div class="toast-stack">
  {#each toasts as t (t.id)}
    <div class="toast" class:success={t.kind === 'success'} class:error={t.kind === 'error'}>
      <div style="flex:1;white-space:pre-wrap">{t.message}</div>
      <button class="toast-close" aria-label="סגירה" onclick={() => dismissToast(t.id)}><Icon name="close" size={15} /></button>
    </div>
  {/each}
</div>

<!-- confirm dialog -->
<div class="confirm-bg" class:open={confirmMsg !== null}>
  <div class="confirm-box">
    <p>{confirmMsg}</p>
    <div class="row">
      <button onclick={() => confirmDone(false)}>ביטול</button>
      <button class="danger" onclick={() => confirmDone(true)}>אישור</button>
    </div>
  </div>
</div>

<!-- add-student modal -->
<div class="modal-bg" class:open={modalOpen} role="presentation" onclick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
  <div class="modal">
    <h3>➕ הוספת תלמיד חדש</h3>
    <div class="field-row">
      <div class="field"><label for="ns-name">שם</label><input id="ns-name" type="text" placeholder="שם התלמיד" bind:value={nsName} /></div>
      <div class="field"><label for="ns-subject">מקצוע</label><input id="ns-subject" type="text" placeholder="מתמטיקה, פיזיקה..." bind:value={nsSubject} /></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="ns-code">קוד אישי (באנגלית)</label>
        <input id="ns-code" type="text" placeholder="noga" autocomplete="off" bind:value={nsCode} /></div>
      <div class="field"><label for="ns-email">מייל של ההורה</label>
        <input id="ns-email" type="email" dir="ltr" placeholder="לא חובה — אבל בלעדיו אי אפשר לבקש קישור חדש" bind:value={nsEmail} /></div>
    </div>
    <div class="field-row three">
      <div class="field"><label for="ns-level">רמה</label>
        <select id="ns-level" bind:value={nsLevel}>
          {#each LEVELS as l}<option value={l}>{l}</option>{/each}
        </select>
      </div>
      <div class="field"><label for="ns-style">סגנון למידה</label>
        <select id="ns-style" bind:value={nsStyle}>
          <option value="">— לא נבחר —</option>
          {#each STYLES as st}<option value={st}>{st}</option>{/each}
        </select>
      </div>
      <div class="field"><label for="ns-phone">טלפון</label><input id="ns-phone" type="text" placeholder="05X-XXX-XXXX" bind:value={nsPhone} /></div>
    </div>
    <div class="field-row single">
      <div class="field"><label for="ns-goals">מטרות</label><textarea id="ns-goals" placeholder="המטרות של התלמיד..." bind:value={nsGoals}></textarea></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
      <button class="btn btn-ghost" onclick={closeModal}>ביטול</button>
      <button class="btn btn-gold" onclick={addStudent}><Icon name="add" size={15} /> הוסף תלמיד</button>
    </div>
  </div>
</div>

<style>
  :global(body) { background: var(--bg-base); }

  input, textarea, select, button { font-family: 'Heebo', sans-serif; }
  input[type='text'], input[type='date'], input[type='time'], input[type='number'], textarea, select {
    background: var(--bg-surface); border: 1.5px solid var(--border-strong);
    color: var(--text-primary); border-radius: var(--r-sm); padding: 8px 12px;
    font-size: 0.88rem; width: 100%; outline: none; transition: border-color 0.2s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--accent); }
  textarea { resize: vertical; min-height: 70px; }

  /* ── Nav ── */
  #nav {
    position: sticky; top: 0; z-index: 100;
    background: var(--nav-bg); backdrop-filter: blur(16px) saturate(160%);
    border-bottom: 1px solid var(--border); padding: 0 2rem; height: 60px;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 1px 12px var(--shadow);
  }
  .nav-logo { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .nav-title { font-size: 1.05rem; font-weight: 900; color: var(--text-primary); white-space: nowrap; }
  .nav-sub { color: var(--text-muted); font-weight: 400; font-size: .88rem; }
  .nav-actions { display: flex; gap: 10px; align-items: center; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 6px; border: none; cursor: pointer;
    font-family: 'Heebo', sans-serif; font-weight: 700; border-radius: var(--r-sm);
    padding: 8px 18px; font-size: .85rem; transition: opacity .2s, transform .15s;
    text-decoration: none;
  }
  .btn:hover { opacity: .88; transform: translateY(-1px); }
  .btn-gold { background: var(--accent); color: #fff; }
  .btn-outline { background: var(--accent-dim); border: 1.5px solid rgba(37,99,235,0.22); color: var(--accent); }
  .btn-ghost { background: rgba(37,99,235,0.04); border: 1.5px solid var(--border-strong); color: var(--text-muted); cursor: pointer; font-family: 'Heebo', sans-serif; font-weight: 700; border-radius: var(--r-sm); padding: 8px 18px; font-size: .85rem; }
  .btn-danger { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); color: var(--danger); }
  .btn-sm { padding: 5px 12px; font-size: .78rem; }

  /* ── Layout ── */
  .page { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem 6rem; }

  .cf-banner { background: #FEF2F2; border: 1.5px solid #FCA5A5; border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .cf-title { font-weight: 800; color: #B91C1C; margin-bottom: 8px; }
  .cf-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid #FECACA; font-size: .9rem; }
  .cf-resolve { border: 1.5px solid #B91C1C; background: none; color: #B91C1C; border-radius: 999px; padding: 3px 12px; cursor: pointer; font-size: .8rem; }

  /* Calendar-READ issue banner — a feed /api/availability could not read,
     so its hours may show as free when they aren't. Deliberately distinct
     from .cf-banner by more than colour: a dashed border and its own ⛔
     icon + explicit consequence text, not red alone. */
  .cs-banner { background: var(--bg-card); border: 1.5px dashed var(--danger); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
  .cs-title { font-weight: 800; color: var(--danger); margin-bottom: 8px; }
  .cs-row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 6px 10px; padding: 6px 0; border-top: 1px solid var(--border-strong); font-size: .9rem; }
  .cs-src { font-weight: 700; color: var(--text-primary); }
  .cs-reason { color: var(--text-muted); font-size: .82rem; }
  .cs-note { margin-top: 8px; font-size: .82rem; color: var(--text-muted); line-height: 1.6; }

  /* ── Local-data import panel (task: explicit, reviewed import — never
     automatic) — a calm informational banner, not an alarm; same visual
     weight as .codes-panel rather than .cf-banner's red. ── */
  .import-panel { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 14px; padding: 16px 18px; margin-bottom: 16px; }
  .import-title { font-weight: 800; color: var(--text-primary); margin-bottom: 8px; }
  .import-copy { font-size: .85rem; color: var(--text-muted); line-height: 1.6; margin: 0 0 12px; }
  .import-table-wrap { overflow-x: auto; margin-bottom: 12px; }
  .import-table { width: 100%; border-collapse: collapse; font-size: .82rem; }
  .import-table th, .import-table td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: normal; }
  .import-table th { color: var(--text-muted); font-weight: 700; }
  .import-results { margin: 0; padding-inline-start: 1.2em; font-size: .88rem; color: var(--text-primary); }
  .import-results li { padding: 3px 0; }
  .import-server-val { color: var(--text-muted); font-size: .74rem; margin-top: 2px; }

  /* Shown instead of the full panel once the browser's local data has
     already been imported once (Store.importedProfilesAt) — a quiet nudge
     with an explicit escape hatch, not the full review table again. */
  .import-hint {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 14px;
    padding: 12px 16px; margin-bottom: 16px; font-size: .85rem; color: var(--text-muted);
  }

  /* 44px tap target regardless of any font-size/padding a button's other
     classes (e.g. .btn-sm) set — used where a compact button still needs to
     be reliably tappable. */
  .tap44 { min-height: 44px; }

  .server-source-note { font-size: .78rem; color: var(--text-muted); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 8px 10px; margin-bottom: 12px; }

  /* ── Read-only server-sourced profile fields (no write endpoint exists
     for these) ── */
  .readonly-value { padding: 8px 12px; font-size: .88rem; color: var(--text-primary); background: var(--bg-surface); border: 1.5px solid var(--border); border-radius: var(--r-sm); min-height: 1.4em; }
  .field-error { font-size: .78rem; color: var(--danger); margin-top: 4px; }

  /* ── Stats bar ── */
  .stats-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 2rem; }
  .stat-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-md); padding: 20px; box-shadow: 0 2px 12px var(--shadow); }
  .stat-card .s-label { font-size: .72rem; font-weight: 700; color: var(--text-muted); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-card .s-value { font-size: 2rem; font-weight: 900; color: var(--text-primary); }
  .stat-card .s-value.gold  { color: var(--accent); }
  .stat-card .s-value.green { color: var(--accent3-strong); }
  .stat-card .s-value.red   { color: var(--danger); }
  .stat-card .s-sub { font-size: .78rem; color: var(--text-muted); margin-top: 4px; }

  /* ── Section header ── */
  .sec-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; }
  .sec-label2 { font-size: .75rem; color: var(--accent2-strong); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 4px; }
  .sec-h2 { font-size: 1.3rem; font-weight: 800; }

  /* ── Homework results ── */
  /* min(340px, 100%): a card wants 340px, but on a phone narrower than that
     the column must shrink to the container instead of pushing the page
     into horizontal scroll. Same for #lessons-list below. */
  #hw-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .hwr-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-md); padding: 18px 20px; box-shadow: 0 2px 12px var(--shadow); }
  .hwr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
  .hwr-name { font-size: 1.05rem; font-weight: 800; }
  .hwr-when { font-size: .74rem; color: var(--text-muted); white-space: nowrap; }
  .hwr-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); gap: 8px; margin-bottom: 14px; }
  .hwr-stat { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 8px 4px; text-align: center; }
  .hwr-val { font-size: 1.25rem; font-weight: 900; line-height: 1.15; }
  .hwr-lbl { font-size: .68rem; color: var(--text-muted); margin-top: 2px; }
  .hwr-missed { border-top: 1px solid var(--border); padding-top: 10px; }
  .hwr-missed-title { font-size: .76rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; }
  .hwr-miss { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); border-radius: var(--r-sm); padding: 5px 10px; margin-bottom: 5px; font-size: .82rem; }
  .hwr-miss-n { font-weight: 800; color: var(--danger); flex-shrink: 0; }
  /* ── Auto-generated lessons ── */
  #lessons-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
  .lsn-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-md); padding: 16px 18px; box-shadow: 0 2px 12px var(--shadow); }
  .lsn-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .lsn-title { font-size: 1rem; font-weight: 800; line-height: 1.35; }
  .lsn-meta { font-size: .78rem; color: var(--text-muted); margin-top: 2px; }
  .lsn-badge { font-size: .7rem; font-weight: 800; border-radius: 999px; padding: 2px 10px; white-space: nowrap; flex-shrink: 0; }
  .lsn-context { font-size: .82rem; color: var(--text-muted); margin-top: 8px; line-height: 1.6; }
  .lsn-problem { font-size: .8rem; color: var(--danger); background: rgba(220,38,38,0.08); border-radius: var(--r-sm); padding: 6px 10px; margin-top: 8px; }
  .lsn-links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .lsn-links a { font-size: .78rem; font-weight: 700; text-decoration: none; background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(37,99,235,0.22); border-radius: 999px; padding: 4px 11px; }
  .lsn-links a:hover { background: var(--accent); color: #fff; }
  .lsn-broken { font-size: .78rem; font-weight: 700; background: rgba(220,38,38,0.08); color: var(--danger); border: 1px solid rgba(220,38,38,0.28); border-radius: 999px; padding: 4px 11px; }
  .lsn-hw { font-size: .78rem; color: var(--text-muted); margin-top: 8px; }

  /* ── Students grid ── */
  .students-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(520px, 1fr)); gap: 20px; }

  .student-card { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-lg); overflow: hidden; box-shadow: 0 2px 16px var(--shadow); transition: border-color .2s, box-shadow .2s; }
  .student-card:hover { border-color: var(--accent-soft); box-shadow: 0 4px 24px var(--accent-glow); }

  .sc-header { background: linear-gradient(135deg, var(--accent-dim), rgba(250,130,49,0.04)); border-bottom: 1px solid var(--border-strong); padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sc-header-left { display: flex; align-items: center; gap: 14px; }
  .sc-avatar { width: 48px; height: 48px; border-radius: 50%; background: var(--accent-dim); border: 2px solid rgba(37,99,235,0.22); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; flex-shrink: 0; }
  .sc-name { font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }
  .sc-subject { font-size: .82rem; color: var(--text-muted); margin-top: 2px; }
  .sc-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge { font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; letter-spacing: .04em; }
  .badge-style { background: var(--accent2-dim); border: 1px solid var(--accent2-strong); color: var(--accent2-strong); }
  .badge-ok    { background: var(--accent3-dim); border: 1px solid var(--accent3-strong); color: var(--accent3-strong); }
  .badge-warn  { background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.28); color: var(--danger); }

  /* Tabs */
  .sc-tabs { display: flex; border-bottom: 1px solid var(--border-strong); padding: 0 24px; gap: 0; }
  .sc-tab { font-size: .82rem; font-weight: 700; color: var(--text-muted); padding: 10px 16px; cursor: pointer; border-bottom: 2px solid transparent; transition: color .2s, border-color .2s; white-space: nowrap; }
  .sc-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .sc-tab:hover:not(.active) { color: var(--text-primary); }

  .sc-panel { display: none; padding: 20px 24px; }
  .sc-panel.active { display: block; }

  /* Fields */
  .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .field-row.single { grid-template-columns: 1fr; }
  .field-row.three  { grid-template-columns: 1fr 1fr 1fr; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field label, .field-label { font-size: .72rem; font-weight: 700; color: var(--text-muted); letter-spacing: .05em; text-transform: uppercase; }

  /* Payments table */
  .payments-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  .payments-table th { text-align: right; padding: 8px 10px; color: var(--accent); font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; border-bottom: 1.5px solid var(--border-strong); background: var(--accent-dim); }
  .payments-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-strong); color: var(--text-primary); }
  .payments-table tr:last-child td { border-bottom: none; }
  .payments-table tr:hover td { background: var(--accent-dim); }
  .paid-badge   { color: var(--accent3-strong); font-weight: 700; font-size: .8rem; }
  .unpaid-badge { color: var(--danger);   font-weight: 700; font-size: .8rem; }

  .payment-summary { display: flex; gap: 20px; margin-bottom: 14px; padding: 12px 16px; background: var(--accent-dim); border: 1px solid rgba(37,99,235,0.22); border-radius: var(--r-md); }
  .ps-item { text-align: center; }
  .ps-item .psi-val { font-size: 1.3rem; font-weight: 900; }
  .ps-item .psi-lbl { font-size: .72rem; color: var(--text-muted); margin-top: 2px; }

  /* Next lesson */
  .next-lesson-box { background: var(--accent-dim); border: 1px solid rgba(37,99,235,0.22); border-radius: var(--r-md); padding: 16px; }
  .nl-label { font-size: .72rem; font-weight: 700; color: var(--accent); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
  .nl-date { font-size: 1.5rem; font-weight: 900; color: var(--text-primary); }
  .nl-meta { font-size: .85rem; color: var(--text-muted); margin-top: 4px; }

  /* Homework */
  .hw-item { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-strong); }
  .hw-item:last-child { border-bottom: none; }
  .hw-check { width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0; border: 1.5px solid var(--border-strong); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background .2s, border-color .2s; margin-top: 2px; }
  .hw-check.done { background: var(--accent3-strong); border-color: var(--accent3-strong); color: #fff; font-size: .8rem; }
  .hw-text { flex: 1; }
  .hw-task { font-size: .9rem; color: var(--text-primary); }
  .hw-task.done-text { text-decoration: line-through; color: var(--text-muted); }
  .hw-date { font-size: .75rem; color: var(--text-muted); margin-top: 2px; }
  .hw-grade { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .hw-grade-btn { min-height: 36px; }
  .hw-graded { font-size: .8rem; color: var(--accent3-strong); margin-top: 4px; font-weight: 600; }
  .link-btn { background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; font: inherit; text-decoration: underline; }
  .hw-held { font-size: .75rem; color: var(--accent); margin-top: 2px; font-weight: 600; }

  /* Progress bar */

  /* Add form */
  .add-form { background: var(--bg-surface); border: 1.5px solid var(--border-strong); border-radius: var(--r-md); padding: 16px; margin-bottom: 14px; display: none; }
  .add-form.open { display: block; }
  .add-form h4 { font-size: .85rem; font-weight: 700; color: var(--accent); margin-bottom: 12px; }

  /* Modal */
  .modal-bg { position: fixed; inset: 0; background: rgba(26,51,51,0.4); backdrop-filter: blur(6px); z-index: 500; display: none; align-items: center; justify-content: center; }
  .modal-bg.open { display: flex; }
  .modal { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-lg); padding: 32px; width: min(560px, 95vw); max-height: 90vh; overflow-y: auto; box-shadow: 0 12px 48px var(--shadow-md); }
  .modal h3 { font-size: 1.2rem; font-weight: 800; color: var(--accent); margin-bottom: 20px; }

  /* Toasts */
  .toast-stack { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 900; display: flex; flex-direction: column; gap: 10px; width: min(420px, 92vw); pointer-events: none; }
  .toast { pointer-events: auto; background: var(--bg-card); border: 1.5px solid var(--border); border-radius: var(--r-md); padding: 14px 16px; box-shadow: 0 10px 32px var(--shadow-md); display: flex; align-items: flex-start; gap: 10px; font-size: .88rem; line-height: 1.6; }
  .toast.success { border-color: var(--accent3-strong); background: var(--accent3-dim); }
  .toast.error   { border-color: rgba(220,38,38,0.28);   background: rgba(220,38,38,0.08); }
  .toast-close { border: 0; background: none; cursor: pointer; font-size: 1rem; color: var(--text-muted); line-height: 1; padding: 0 0 0 4px; flex: none; }

  .confirm-bg { position: fixed; inset: 0; background: rgba(26,51,51,0.4); backdrop-filter: blur(6px); z-index: 950; display: none; align-items: center; justify-content: center; }
  .confirm-bg.open { display: flex; }
  .confirm-box { background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--r-lg); padding: 26px 28px; width: min(360px, 92vw); box-shadow: 0 12px 48px var(--shadow-md); text-align: center; }
  .confirm-box p { font-size: .95rem; margin-bottom: 20px; white-space: pre-wrap; }
  .confirm-box .row { display: flex; gap: 10px; }
  .confirm-box button { flex: 1; border-radius: 999px; padding: 10px; font-family: inherit; font-weight: 700; font-size: .88rem; cursor: pointer; border: 1.5px solid var(--border); background: none; }
  .confirm-box button.danger { background: var(--danger); border-color: var(--danger); color: #fff; }

  /* Divider */
  .divider { height: 1px; background: var(--border-strong); margin: 14px 0; }

  /* Empty state */
  .empty { text-align: center; padding: 24px; color: var(--text-muted); font-size: .9rem; grid-column: 1/-1; }

  .save-indicator { font-size: .75rem; color: var(--accent3-strong); opacity: 0; transition: opacity .3s; margin-right: 8px; }
  .save-indicator.show { opacity: 1; }

  /* Codes panel */
  .codes-panel { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 6px 4px; overflow-x: auto; }
  .codes-msg { padding: 16px; color: var(--text-muted); }
  .rs-sub { font-size: .78rem; color: var(--text-muted); margin-top: 3px; }
  .rs-links { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .rs-join { font-size: .82rem; color: var(--text-muted); }
  .rs-join b { direction: ltr; letter-spacing: .08em; color: var(--accent-deep); }
  .codes-table { width: 100%; border-collapse: collapse; font-size: .9rem; min-width: 560px; }
  .codes-table thead th { text-align: right; color: var(--text-muted); font-size: .78rem; padding: 10px 12px; }
  .codes-table tbody tr { border-top: 1px solid var(--border-strong); }
  .codes-table td { padding: 12px; }
  .copy-btn { border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 5px 14px; cursor: pointer; font-size: .82rem; }
  /* .copy-btn alone sits around 28-30px tall — fine for the other buttons in
     this row, which sit beside plenty of other click targets, but this is
     the only way from the roster into the plan page on a phone, so it gets
     its own floor (task 7 review, finding 2). Layout-only: no change to
     .copy-btn's border/background/font-size, so it doesn't touch the
     pre-existing siblings in this row. */
  .plan-link { display: inline-flex; align-items: center; min-height: 44px; text-decoration: none; }

  /* Payments panel */
  .panel { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 16px; overflow-x: auto; }
  .pay-row { padding: 10px 4px; border-bottom: 1px solid var(--border-strong); }
  .pay-row:last-child { border-bottom: none; }
  .pay-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

  @media (max-width: 600px) {
    /* The desktop nav is one 60px row that never wraps: mark + "לוח בקרה" +
       three padded buttons need ~440px, so on a phone the buttons squashed
       onto two lines and, at 320px, pushed the page into horizontal scroll.
       Here the row is allowed to wrap: the logo keeps line one, and the
       actions drop to a full-width two-column grid underneath — primary
       across both columns, the two secondary buttons side by side. */
    #nav {
      padding: 10px 1rem; height: auto; min-height: 60px;
      flex-wrap: wrap; row-gap: 10px;
    }
    /* The mark plus "לוח בקרה" already say where you are; the tagline is
       what this width cannot also fit. */
    .nav-sub { display: none; }
    .nav-actions {
      flex-basis: 100%;
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    }
    .nav-actions .btn {
      justify-content: center; min-height: 44px; padding: 8px 12px;
      white-space: nowrap;
    }
    .nav-actions .btn-outline { grid-column: 1 / -1; }
    /* "✓ נשמר" is a transient flash, not a control; it must not claim a
       grid cell. Park it at the top-left corner of the bar instead. */
    .nav-actions .save-indicator {
      position: absolute; top: 20px; left: 1rem; margin: 0;
    }
    .students-grid { grid-template-columns: 1fr; }
    .field-row { grid-template-columns: 1fr; }
    .field-row.three { grid-template-columns: 1fr 1fr; }
  }
</style>

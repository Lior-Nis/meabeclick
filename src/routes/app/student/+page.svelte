<script lang="ts">
  import { GRADE_LABEL } from '$lib/homework-grade.ts';
  import type { FamilyLesson } from '$lib/family-lesson.ts';
  import { homeworkState, HOMEWORK_STATE_LABEL } from '$lib/family-homework.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import Icon from '$lib/icons/Icon.svelte';
  import BottomNav, { type NavItem } from '$lib/components/BottomNav.svelte';
  /**
   * The student's own board.
   *
   * Guarded in +page.server.ts, which resolves the student from the family
   * session. There is no gate here any more: this page used to read a code
   * from `?s=` or localStorage plus a pin from `student_pin_<code>`, and
   * refused anything under four characters with `צריך 4 ספרות` — a rule
   * inherited from the retired 4-digit PIN model, which locked out every
   * family whose password was not four digits.
   *
   * Ruling P13: /api/portal/[code] already normalizes mixed-shape game/
   * homework records into a single `url` field, so this page never inspects
   * `template`/`dataId` itself. But that normalized `url` is NOT
   * consistently shaped: an old-shape entry's `url` is the raw baked string
   * with no leading slash ("games/memory.html?d=..."), while a new-shape
   * entry's `url` comes from src/lib/server/urls.ts's gameUrl(), which
   * already returns an absolute path ("/app/play/..."). The old page always
   * prepended "/" (`href="/${h.url}"`), which is correct for the old shape
   * and would double-slash the new one. toHref() ($lib/urls.ts, shared with
   * parent/ and dashboard/) normalizes both instead of assuming either
   * shape, per the ruling.
   */
  import { onMount, tick } from 'svelte';
  import type { ProgressFacts } from '$lib/progress-facts.ts';
  import { appendMessage, removeMessage } from '$lib/chat-log.js';
  import MathText from '$lib/math/MathText.svelte';
  import { toHref } from '$lib/urls.ts';
  import { israelToday } from '$lib/dates.ts';
  import { firstName } from '$lib/names.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  type View = 'loading' | 'app' | 'error';

  interface HwItem {
    id?: number; task: string; due?: string | null; url?: string | null;
    /* Two stages, because they are different claims: the student says they
       finished it, and someone judged it. One flag cannot say "I did it and
       nobody has looked yet", which is where homework spends most of its
       life. */
    submitted: boolean; graded: boolean;
    grade?: 'ok' | 'partial' | 'redo' | null;
    [k: string]: unknown;
  }
  type LessonItem = FamilyLesson;
  interface GameItem { title: string; url?: string | null; [k: string]: unknown }
  interface StudentData {
    name: string; emoji?: string; subject?: string; level?: string; tutor?: string; tutorPhone?: string;
    nextLesson?: { date?: string; time?: string; type?: string } | null;
    /* Computed by the server (see src/lib/server/progress.ts), not a
       hand-typed integer — that one was 0 for every student, forever. */
    progress?: ProgressFacts;
    progressNote?: string; updated?: string;
    homework?: HwItem[]; lessons?: LessonItem[]; games?: GameItem[];
  }
  interface ChatMsg {
    cls: 'me' | 'bot' | 'sys'; text: string; wa?: string;
    /** The question to send again, when trying again could plausibly
     *  work. Absent on failures where retrying cannot help — a rate
     *  limit, or a session that has lapsed. */
    retry?: string;
  }

  let view = $state<View>('loading');
  const code = $derived(data.code);

  let DATA = $state<StudentData | null>(null);
  let loadError = $state('');
  /**
   * Which destination is showing. Mirrored into `?v=` so the phone's back
   * button moves between sections instead of leaving the board entirely —
   * the difference between a set of tabs and something that behaves like an
   * app. Plain history.pushState rather than goto(): switching section needs
   * no server round-trip, and re-running the load function to change a tab
   * would throw away the portal data already fetched on mount.
   */
  const NAV_ITEMS: NavItem[] = [
    { id: 'home',  label: 'בית',        icon: 'portal' },
    { id: 'hw',    label: 'שיעורי בית',  icon: 'homework' },
    { id: 'games', label: 'משחקים',      icon: 'games' },
    { id: 'ask',   label: 'שאלה',        icon: 'message' },
  ];
  const VIEW_IDS = NAV_ITEMS.map(i => i.id);

  let activeView = $state('home');
  /** Hides the nav while the question composer has focus, so the keyboard
   *  and the bar do not stack on a phone. */
  let composing = $state(false);

  function readViewFromUrl(): string {
    if (typeof location === 'undefined') return 'home';
    const v = new URLSearchParams(location.search).get('v');
    return v && VIEW_IDS.includes(v) ? v : 'home';
  }

  function selectView(id: string, push = true): void {
    activeView = id;
    if (!push || typeof window === 'undefined') return;
    // `?s=` must survive: the server load redirects to the canonical URL
    // when the student code is missing, which would bounce every switch.
    const url = new URL(location.href);
    url.searchParams.set('v', id);
    history.pushState({ v: id }, '', url);
  }

  let chat = $state<ChatMsg[]>([]);
  let question = $state('');
  let sending = $state(false);
  let chatEl: HTMLDivElement | undefined = $state();

  function fmtDate(s?: string | null): string {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? s : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function waLink(text: string): string {
    const phone = DATA?.tutorPhone || TUTOR_PHONE;
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  onMount(() => {
    activeView = readViewFromUrl();
    const onPop = () => { activeView = readViewFromUrl(); };
    addEventListener('popstate', onPop);
    load();
    return () => removeEventListener('popstate', onPop);
  });

  async function load() {
    view = 'loading';
    loadError = '';
    try {
      const r = await fetch(`/api/portal/${encodeURIComponent(code)}`, { cache: 'no-store' });
      /* The server load already proved this session may open this student,
         so a 401 here means the session lapsed between the page render and
         this fetch. Send them to the door rather than inventing a gate. */
      if (r.status === 401) {
        location.href = '/portal';
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as StudentData;
      DATA = d;
      document.title = `הדף של ${d.name} — מאה בקליק`;
      view = 'app';
    } catch {
      loadError = 'לא הצלחתי לטעון את הדף.';
      view = 'error';
    }
  }

  /* What the figure counts, said in words. Skills when the plan has
     anything assessed — that is the only thing here measuring
     understanding — and otherwise homework handed in, which is effort and
     is labelled as effort rather than dressed up as progress. */
  const progressTitle = $derived(
    DATA?.progress?.kind === 'skills' ? 'ההתקדמות שלי' : 'שיעורי הבית שלי',
  );
  const progressLabel = $derived(
    DATA?.progress?.kind === 'skills' ? 'יכולות' : 'הוגשו',
  );
  const progressWords = $derived.by(() => {
    const p = DATA?.progress;
    if (!p || p.kind === 'none' || !p.total) return 'עוד אין מה למדוד — זה יתחיל אחרי השיעור הראשון.';
    return p.kind === 'skills'
      ? `${p.done} מתוך ${p.total} יכולות בתכנית כבר בוצעו`
      : `${p.done} מתוך ${p.total} שיעורי בית הוגשו`;
  });

  /** Still open means not handed in. A graded task is finished either way. */
  const hwOpen = $derived((DATA?.homework ?? []).filter(h => !h.submitted && !h.graded).length);
  const today = israelToday();


  function hwStatus(h: HwItem): { cls: string; label: string } {
    /* Three states, not two, and the middle one is the point: a child who
       did the work gets to see that it counted before anyone has marked it.
       Status is never colour alone — every one of these carries its own
       words. */
    if (h.graded) return { cls: `graded ${h.grade ?? ''}`, label: h.grade ? GRADE_LABEL[h.grade] : 'נבדק' };
    if (h.submitted) return { cls: 'submitted', label: 'הוגש — ממתין לבדיקה' };
    if (h.due && h.due < today) return { cls: 'late', label: 'באיחור' };
    return { cls: 'open', label: 'פתוח' };
  }

  /** The child saying they finished it. Never a grade — that is the tutor's. */
  let hwBusy = $state<number | null>(null);
  let hwError = $state('');

  async function toggleSubmitted(h: HwItem) {
    if (h.id == null || h.graded || hwBusy !== null) return;   // graded work is settled
    hwBusy = h.id;
    hwError = '';
    try {
      const r = await fetch(`/api/portal/${encodeURIComponent(code)}/homework`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: h.id, submitted: !h.submitted }),
      });
      if (!r.ok) throw new Error(String(r.status));

      /* Apply what the SERVER says, not what we asked for — saving is never
         optimistic here. Patching the rows in place rather than calling
         load(), which flips the whole board back to its spinner and would
         make a tick feel like a page reload. */
      const { homework, progress } = await r.json() as {
        homework: { id: number; submitted: boolean; graded: boolean }[];
        progress: StudentData['progress'];
      };
      const byId = new Map(homework.map(x => [x.id, x]));
      if (DATA?.homework) {
        DATA.homework = DATA.homework.map(item =>
          item.id != null && byId.has(item.id) ? { ...item, ...byId.get(item.id)! } : item);
      }
      /* And the figure derived from it, or the page would show two numbers
         about the same child that disagree. */
      if (DATA) DATA.progress = progress;
    } catch {
      hwError = 'לא הצלחנו לשמור. נסו שוב.';
    } finally {
      hwBusy = null;
    }
  }

  /** Named chatHistory, not history: a local `history` shadows
   *  window.history, which silently broke the back-button wiring below —
   *  `typeof history === 'undefined'` was testing an array that always
   *  exists, so the guard never guarded anything. */
  const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  /** What /api/ask reads of the conversation — MAX_HISTORY_TURNS there, and
   *  a test holds the two equal. Beyond it the assistant has forgotten the
   *  start of the chat, and the child is told so once (forgetNoted), rather
   *  than finding out when a follow-up makes no sense. */
  const REMEMBERED_TURNS = 6;
  let forgetNoted = false;

  function bubble(cls: ChatMsg['cls'], text: string, wa?: string, retry?: string) {
    // appendMessage returns the LIST'S element, not the literal — `chat` is
    // $state, so mutating the literal would change the value without
    // re-rendering. See src/lib/chat-log.js.
    const msg = appendMessage(chat, { cls, text, wa, retry } as ChatMsg);
    tick().then(() => { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; });
    return msg;
  }

  /**
   * Leaves the portal and clears the family session.
   *
   * The session cookie lasts six months, and this board is opened on a
   * phone or a shared family laptop from a link in WhatsApp — so without
   * this the only way out was clearing browser cookies. The parent portal
   * has had this since it was built; the student board never did.
   *
   * Navigates with location.href rather than goto() so the whole document
   * reloads: nothing about the previous student may survive in memory on a
   * device the next person picks up.
   */
  async function signOut() {
    await fetch('/api/family', { method: 'DELETE' }).catch(() => {});
    location.href = '/';
  }

  /**
   * What to tell a child when the answer does not come.
   *
   * Every failure used to collapse into one sentence and a WhatsApp link.
   * They are not the same event and they do not have the same remedy: too
   * many questions in a row is a wait, an unconfigured engine is the
   * tutor's problem and not theirs, and a dropped connection is worth
   * simply trying again. A child told "I could not answer" for all three
   * learns that the box is unreliable, which is the one reading we can
   * definitely avoid.
   *
   * `retry` decides whether trying the same question again could plausibly
   * work. Offering retry on a 429 would invite them to make it worse.
   */
  function failureFor(status: number | null): { text: string; retry: boolean } {
    if (status === 429) {
      return { text: 'שאלתם הרבה שאלות ברצף 🙂 אפשר להמשיך עוד כמה דקות — או לשאול את המורה עכשיו:', retry: false };
    }
    if (status === 401 || status === 404) {
      return { text: 'נראה שהחיבור לדף פג. רעננו את העמוד ונסו שוב, או פנו למורה:', retry: false };
    }
    if (status === 503 || status === 502) {
      return { text: 'העוזר לא זמין כרגע — זו תקלה אצלנו, לא אצלכם. המורה יכולה לעזור עכשיו:', retry: true };
    }
    if (status === null) {
      // fetch itself rejected: no network, or the request was cut off.
      return { text: 'אין חיבור לרשת כרגע 📡 בדקו את החיבור ונסו שוב:', retry: true };
    }
    return { text: 'לא הצלחתי לענות כרגע 😕 אפשר לשלוח את השאלה ישירות למורה:', retry: true };
  }

  async function ask(text?: string) {
    /* The guard the disabled button does not provide. `disabled` stops the
       BUTTON, and Enter does not go through the button — so retyping while
       a request was in flight fired a second one. Measured in a browser:
       two concurrent /api/ask calls and three user bubbles for two
       questions. */
    if (sending) return;

    const q = (text ?? question).trim();
    if (!q || !DATA || !code) return;

    bubble('me', q);
    question = '';
    sending = true;
    const thinking = bubble('bot', '⋯');

    let status: number | null = null;
    try {
      const r = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No pin: /api/ask authorizes from the family session now.
        body: JSON.stringify({ slug: code, question: q, history: chatHistory.slice(-REMEMBERED_TURNS) }),
      });
      status = r.status;
      const j = await r.json();
      if (!r.ok || !j.answer) throw new Error(j.error || 'no answer');
      thinking.text = j.answer;
      chatHistory.push({ role: 'user', content: q }, { role: 'assistant', content: j.answer });
      if (chatHistory.length > REMEMBERED_TURNS && !forgetNoted) {
        forgetNoted = true;
        bubble('sys', 'התחלנו שיחה חדשה — אני זוכר רק את השאלות האחרונות');
      }
    } catch {
      removeMessage(chat, thinking);
      const f = failureFor(status);
      bubble('sys', f.text, waLink(`היי! יש לי שאלה על ${DATA.subject || 'החומר'}: ${q}`), f.retry ? q : undefined);
    } finally {
      sending = false;
    }
  }

  function onQKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') ask();
  }

  /** A first-day board has no lessons, no homework and no games. Saying so
   *  beats three separate "empty" messages, one of which used to be a
   *  celebration emoji aimed at a child who had just enrolled. */
  const isDayOne = $derived(!!DATA
    && !(DATA.homework ?? []).length
    && !(DATA.lessons ?? []).filter(l => !l.upcoming).length
    && !(DATA.games ?? []).length);
</script>

<svelte:head>
  <title>הדף שלי — מאה בקליק</title>
</svelte:head>

<main class="wrap">
  <!-- Outside the {#if} so the loading and error views are branded too, and
       above .hero rather than inside it: the hero fills with --accent, which
       is the mark's own ink colour. -->
  <!-- The sign-out is page chrome, not part of the board, so it is NOT
       behind `view === 'app'`. Two reasons: `view` only becomes 'app' after
       onMount, so a guarded button would be missing from the server-rendered
       page entirely; and if the board fails to load, being able to leave the
       session matters more, not less. -->
  <header class="app-bar">
    <span class="who">
      <span class="who-avatar">{DATA?.emoji || '🎓'}</span>
      <span class="who-name">{DATA ? `היי ${firstName(DATA.name)}!` : 'הדף שלי'}</span>
    </span>
    <button class="sign-out" onclick={signOut}>יציאה</button>
  </header>

  {#if view === 'app' && DATA}
    <div id="app">
      <!-- HOME. The greeting and identity moved to the app bar above, so
           this view opens on what a child came to find out: when the next
           lesson is, then how they are doing, then what happened last time.

           Day one shows the reassurance FIRST. It used to sit below three
           zeros — 0% / 0 / 0 — so a family whose child had just enrolled
           opened their board to a report card of nothing. -->
      {#if activeView === 'home'}
        <div class="next">
          {#if DATA.nextLesson?.date}
            <Icon name="calendar" /> השיעור הבא: {fmtDate(DATA.nextLesson.date)}{DATA.nextLesson.time ? ' בשעה ' + DATA.nextLesson.time : ''}{DATA.nextLesson.type ? ' · ' + DATA.nextLesson.type : ''}
          {:else}
            <Icon name="calendar" /> השיעור הבא ייקבע בקרוב
          {/if}
        </div>

        {#if isDayOne}
          <div class="dayone">
            <div class="dayone-icon"><Icon name="day-one" size={40} /></div>
            <div class="dayone-title">הכל מוכן לשיעור הראשון</div>
            <p class="dayone-sub">
              אחרי השיעור יופיעו כאן הסיכום, המצגת ומשחקי התרגול — אפשר לחזור
              לדף הזה מתי שרוצים.
            </p>
          </div>
        {:else}
          <div class="stats">
            <div class="stat"><div class="stat-val">{hwOpen}</div><div class="stat-lbl">שיעורי בית פתוחים</div></div>
            <div class="stat"><div class="stat-val">{(DATA.lessons ?? []).filter(l => !l.upcoming).length}</div><div class="stat-lbl">שיעורים</div></div>
            <!-- A count, not a bare percentage: "2 מתוך 4" can be checked
                 against the list below it; "50%" cannot be checked against
                 anything. -->
            <div class="stat">
              <div class="stat-val">{DATA.progress?.total ? `${DATA.progress.done}/${DATA.progress.total}` : '—'}</div>
              <div class="stat-lbl">{progressLabel}</div>
            </div>
          </div>

          <!-- The lesson log lost its own destination: a child does not
               browse lesson history, and the parent portal already carries
               יומן שיעורים for the one who does. Folding it in here freed the
               fourth nav slot for שאלה, which was the section being clipped
               off the screen entirely. -->
          <h2 class="view-title">שיעורים אחרונים</h2>
        {#if !(DATA.lessons ?? []).length}
          <div class="msg-empty">עוד לא היו שיעורים</div>
        {:else}
          {#each DATA.lessons ?? [] as l}
            <div class="card">
              <div class="card-title">{l.topic}</div>
              <div class="card-meta">{l.upcoming ? 'לקראת השיעור · ' : ''}{fmtDate(l.date)}</div>
              <div class="card-body">{l.summary || ''}</div>
              {#if l.slidesUrl}
                <a class="play" href={toHref(l.slidesUrl)}><Icon name="slides" size={17} /> המצגת</a>
              {/if}
            </div>
          {/each}
        {/if}
        {/if}
      {/if}

      {#if activeView === 'hw'}
        <div class="card">
          <div class="card-title"><Icon name="progress" /> {progressTitle}</div>
          {#if DATA.progress?.total}
            <div
              class="progress-outer"
              role="progressbar"
              aria-valuenow={DATA.progress.done}
              aria-valuemin="0"
              aria-valuemax={DATA.progress.total}
              aria-label={progressTitle}
            >
              <div class="progress-inner" style="width:{DATA.progress.percent}%"></div>
            </div>
            <!-- The words are the point. A bar on its own is a shape. -->
            <div class="progress-words">{progressWords}</div>
          {:else}
            <div class="card-body">{progressWords}</div>
          {/if}
          <!-- The tutor's progress note is for the parent (dashboard:
               «מוצגת להורים בלבד»), not shown to the child. -->
        </div>
        {#if !(DATA.homework ?? []).length}
          <div class="msg-empty">
            {isDayOne
              ? 'עוד אין שיעורי בית — הם יופיעו כאן אחרי השיעור הראשון.'
              : 'אין שיעורי בית פתוחים כרגע 🎉'}
          </div>
        {:else}
          {#if hwError}<div class="hw-error" role="alert">{hwError}</div>{/if}
          {#each DATA.homework ?? [] as h}
            {@const st = hwStatus(h)}
            <div class="card">
              <div class="row">
                <div style="flex:1">
                  <div class="card-title"><Icon name={homeworkState(h) === 'open' ? 'homework' : 'done'} label={HOMEWORK_STATE_LABEL[homeworkState(h)]} /> {h.task}</div>
                  <div class="card-meta">{h.due ? 'להגשה עד ' + fmtDate(h.due) : ''}</div>
                  {#if h.url}
                    <!-- Only a task that really is a game gets a game link.
                         Written work carries no url, so no button. -->
                    <a class="play" href={toHref(h.url)}><Icon name="games" size={17} /> {h.submitted ? 'לשחק שוב' : 'התחילו'}</a>
                  {:else if !h.graded}
                    <!-- The child's own "I did it". Not a grade — that is the
                         tutor's, and it lands as a separate state. Reversible,
                         because a tap by accident must be undoable. -->
                    <button
                      class="hw-submit"
                      class:is-submitted={h.submitted}
                      disabled={hwBusy === h.id}
                      onclick={() => toggleSubmitted(h)}
                    >
                      <Icon name={h.submitted ? 'done' : 'check'} size={17} />
                      {hwBusy === h.id ? 'שומר…' : h.submitted ? 'ביטול הגשה' : 'סיימתי'}
                    </button>
                  {/if}
                </div>
                <span class="badge {st.cls}">{st.label}</span>
              </div>
            </div>
          {/each}
        {/if}
      {/if}

      {#if activeView === 'games'}
        {#if !(DATA.games ?? []).length}
          <div class="msg-empty">אין משחקים עדיין</div>
        {:else}
          {#each DATA.games ?? [] as g}
            <div class="card">
              <div class="card-title"><Icon name="games" /> {g.title}</div>
              {#if g.url}
                <a class="play" href={toHref(g.url)}>שחקו עכשיו ←</a>
              {/if}
            </div>
          {/each}
        {/if}
      {/if}

      {#if activeView === 'ask'}
        <div class="hint">שאלו כל שאלה על החומר — אני אנסה לעזור.<br>אם עדיין לא ברור, אפשר לשלוח את השאלה ישירות למורה בוואטסאפ 👇</div>
        <div id="chat" bind:this={chatEl}>
          {#each chat as m}
            <!-- MathText lays out formulas and leaves prose alone. It
                 renders text nodes only — there is no {@html} behind it —
                 so an answer is no more able to inject markup than it was
                 when this was a bare {m.text}. -->
            <div class="msg {m.cls}"><MathText text={m.text} /></div>
            {#if m.retry}
              <!-- Offered only where trying again could work, and before
                   the WhatsApp link: the cheaper remedy goes first. -->
              <button class="retry" disabled={sending} onclick={() => ask(m.retry)}>
                ↻ לנסות שוב
              </button>
            {/if}
            {#if m.wa}
              <a class="wa" target="_blank" rel="noopener" href={m.wa}><Icon name="message" size={17} /> שליחה למורה בוואטסאפ</a>
            {/if}
          {/each}
        </div>
        <div class="ask-row">
          <input
            placeholder="מה לא הבנתם?"
            autocomplete="off"
            bind:value={question}
            onkeydown={onQKeydown}
            onfocus={() => (composing = true)}
            onblur={() => (composing = false)}
          />
          <!-- () => ask(), not `ask`: the handler is called with the
               MouseEvent, which would arrive as the question text now that
               ask() takes one. svelte-check caught it. -->
          <button class="btn" disabled={sending} onclick={() => ask()}>שליחה</button>
        </div>
        <a class="wa" target="_blank" rel="noopener" href={waLink('היי! יש לי שאלה על החומר:')}><Icon name="message" size={17} /> עדיין לא ברור — שאלו את המורה</a>
      {/if}

      <!-- Only for a parent viewing their child's board. A child's own
           session has no parent view to return to. -->
      {#if data.canSeeParentView}
        <div class="board-links">
          <a class="backlink" href="/app/parent?s={encodeURIComponent(code)}">→ חזרה ללוח ההורה</a>
          <a class="backlink" href="/booking"><Icon name="booking" size={17} /> הזמנת שיעור נוסף</a>
        </div>
      {/if}


      <div class="foot">{DATA.updated ? `עודכן לאחרונה: ${fmtDate(DATA.updated)}` : ''}</div>
    </div>
  {:else if view === 'error'}
    <div class="msg-empty">
      {loadError}<br />
      <button class="retry" onclick={load}>נסו שוב</button>
    </div>
  {:else}
    <div class="msg-empty">טוען…</div>
  {/if}
</main>

<!-- Outside <main>, and outside the `view === 'app'` guard: the bar is the
     app's chrome, so it is there while the board is loading and while it is
     failing. A nav that appears only on success is one a child cannot use to
     leave a broken screen. -->
<BottomNav items={NAV_ITEMS} active={activeView} onselect={selectView} hidden={composing} />

<style>
  /* The child's own submission control. Deliberately quieter than the game
     button: pressing it is a claim, not an activity. */
  .hw-submit {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 8px; padding: 8px 14px; min-height: 44px;
    border: 1.5px solid var(--border-strong); border-radius: var(--r-sm);
    background: var(--bg-surface); color: var(--text-primary);
    font-family: inherit; font-size: 0.9rem; cursor: pointer;
  }
  .hw-submit:hover:not(:disabled) { border-color: var(--brand-ink, currentColor); }
  .hw-submit:disabled { opacity: .6; cursor: default; }
  .hw-submit.is-submitted { background: var(--bg-subtle, transparent); }
  .hw-error {
    margin-bottom: 10px; padding: 8px 12px;
    border-inline-start: 3px solid var(--coral, currentColor);
    font-size: 0.9rem;
  }

  /* Bottom padding clears the fixed nav (56px bar + whatever the device
     reserves for its home indicator) so the last card is never trapped
     underneath it. */
  .wrap {
    max-width: 820px; margin: 0 auto;
    padding: 1rem;
    padding-bottom: calc(56px + env(safe-area-inset-bottom) + 1.5rem);
  }
  /* Three columns rather than an absolutely-positioned button: the brand
     stays exactly centred whatever the label's width, and the button can
     never sit on top of the logo on a narrow phone — which is the device
     this board is opened on most. The empty first column is what balances
     the third. */
  /* An app bar rather than a centred logo: on a screen a child reaches from
     a WhatsApp link, who they are signed in as matters more than the mark,
     and the greeting no longer has to repeat one line below. */
  .app-bar {
    display: flex; align-items: center; justify-content: space-between; gap: .75rem;
    min-block-size: 44px;
    padding-bottom: 0.9rem;
  }
  .who { display: flex; align-items: center; gap: .55rem; min-width: 0; }
  .who-avatar {
    inline-size: 34px; block-size: 34px; border-radius: 50%;
    background: var(--accent-dim); display: flex; align-items: center;
    justify-content: center; font-size: 1.05rem; flex: none;
  }
  .who-name {
    font-weight: 800; font-size: 1rem; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .sign-out {
    grid-column: 3; justify-self: end;
    font-family: inherit; font-size: 0.82rem; font-weight: 700;
    color: var(--text-muted); background: none; border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 6px 16px; cursor: pointer;
    /* 44px, because this page is used on a phone more than anything else. */
    min-height: 44px;
    transition: color 0.2s, border-color 0.2s;
  }
  .sign-out:hover { color: var(--accent); border-color: var(--accent-soft); }
  .sign-out:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* ── Header ─────────────────────────────── */
  /* The next lesson is what a child opens this board to find out, so it
     leads the home view and carries the accent on its own. */
  .next {
    display: flex; align-items: center; gap: .5rem;
    background: var(--accent); color: #fff;
    border-radius: 16px; padding: 1rem 1.1rem;
    font-size: .96rem; font-weight: 700; line-height: 1.5;
    margin-bottom: 1rem;
  }

  /* ── Stats ──────────────────────────────── */
  .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: .6rem; margin-bottom: 1rem; }
  .stat { background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px; padding: .8rem .5rem; text-align: center; }
  .stat-val { font-size: 1.5rem; font-weight: 900; color: var(--accent); line-height: 1.1; }
  .stat-lbl { font-size: .75rem; color: var(--text-muted); margin-top: 2px; }

  /* ── Tabs ───────────────────────────────── */
  .view-title { font-size: 1rem; font-weight: 800; margin: 1.25rem 0 .6rem; color: var(--text-primary); }


  /* ── Cards ──────────────────────────────── */
  .card { background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 16px; padding: 1rem 1.1rem; margin-bottom: .7rem; }
  .card-title { font-weight: 800; font-size: 1rem; margin-bottom: .2rem; }
  .card-meta { font-size: .8rem; color: var(--text-muted); }
  .card-body { font-size: .92rem; color: var(--text-muted); line-height: 1.6; margin-top: .45rem; }
  .row { display: flex; align-items: flex-start; gap: .7rem; }
  .badge { font-size: .72rem; font-weight: 800; border-radius: 999px; padding: 3px 11px; white-space: nowrap; flex-shrink: 0; }
  .badge.done { background: var(--accent3-dim); color: var(--accent3-strong); }
  .badge.open { background: var(--accent2-dim); color: var(--accent2-strong); }
  .badge.late { background: #FEF2F2; color: #DC2626; }
  .play {
    display: inline-flex; align-items: center; gap: 5px; margin-top: .6rem; background: var(--accent2); color: #1E293B;
    text-decoration: none; border-radius: 999px; padding: .5rem 1.1rem; min-height: 40px; font-weight: 800; font-size: .85rem;
  }
  .play:hover { opacity: .9; }
  .progress-words { font-size: .9rem; color: var(--text-secondary, inherit); margin-bottom: .2rem; }
  .progress-outer { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; margin: .6rem 0 .3rem; }
  .progress-inner { height: 100%; border-radius: 5px; background: linear-gradient(90deg, var(--accent), var(--accent3)); transition: width .6s ease; }

  /* ── Ask panel ──────────────────────────── */
  #chat { max-height: 420px; overflow-y: auto; margin-bottom: .7rem; }
  .msg { border-radius: 14px; padding: .75rem 1rem; margin-bottom: .55rem; font-size: .94rem; line-height: 1.65; white-space: pre-wrap; }
  .msg.me { background: var(--accent); color: #fff; margin-right: 2.2rem; }
  .msg.bot { background: var(--bg-card); border: 1.5px solid var(--border); margin-left: 2.2rem; }
  .msg.sys { background: var(--accent2-dim); border: 1.5px solid var(--accent2-strong); color: var(--text-primary); font-size: .88rem; }
  /* Same size and shape as the WhatsApp link it sits beside, so the two
     remedies read as a pair rather than one being an afterthought. */
  .retry {
    display: inline-flex; align-items: center; gap: 6px;
    min-height: 44px; padding: .5rem .9rem; margin-top: .4rem;
    font-family: inherit; font-size: .9rem; font-weight: 700;
    color: var(--accent); background: var(--bg-card);
    border: 1px solid var(--border); border-radius: 12px; cursor: pointer;
  }
  .retry:disabled { opacity: .55; cursor: default; }

  .ask-row { display: flex; gap: .5rem; }
  input {
    /* min-width: 0 is load-bearing, not tidying. A flex item defaults to
       min-width: auto, so this input refused to shrink below its content
       width; the send button beside it sets flex-shrink: 0, so the row
       stayed wider than the screen and the BUTTON was pushed off the edge.
       Measured at 320px: 11px of it outside the viewport, and the page
       scrolled sideways. Worst exactly when it matters — the keyboard is
       open and the child is reaching for send. */
    flex: 1; min-width: 0;
    font-family: inherit; font-size: 1rem; padding: .75rem .9rem; min-height: 48px;
    border: 2px solid var(--border); border-radius: 14px; background: var(--bg-card); color: var(--text-primary);
  }
  input:focus { outline: none; border-color: var(--accent); }
  .btn {
    background: var(--accent2); color: #1E293B; font-family: inherit; font-weight: 800; font-size: 1rem;
    border: none; border-radius: 14px; padding: .75rem 1.3rem; min-height: 48px; cursor: pointer; flex-shrink: 0;
  }
  .btn:disabled { opacity: .55; cursor: default; }
  .wa {
    display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: .8rem;
    background: #25D366; color: #fff; text-decoration: none; border-radius: 14px; padding: .8rem; min-height: 48px; font-weight: 800;
  }
  .hint { text-align: center; color: var(--text-muted); font-size: .84rem; margin: .5rem 0 .8rem; line-height: 1.6; }
  .msg-empty { text-align: center; color: var(--text-muted); padding: 2rem 1rem; font-size: .92rem; }
  .foot { text-align: center; color: var(--text-muted); font-size: .78rem; margin-top: 1.4rem; }

  .retry {
    margin-top: 12px; background: var(--accent); color: #fff; border: 0;
    padding: 11px 30px; min-height: 44px; border-radius: 999px;
    font-family: inherit; font-weight: 800; font-size: 1rem; cursor: pointer;
  }

  /* ── Day one ────────────────────────────── */
  .dayone {
    background: var(--bg-surface); border: 1.5px solid var(--accent);
    border-radius: 18px; padding: 1.1rem 1.2rem; margin-bottom: 1rem;
    text-align: center;
  }
  .dayone-icon { font-size: 1.9rem; }
  .dayone-title { font-weight: 800; font-size: 1.02rem; margin-top: .3rem; }
  .dayone-sub { font-size: .89rem; color: var(--text-muted-strong); line-height: 1.65; margin-top: .3rem; }

  .board-links {
    display: flex; flex-wrap: wrap; gap: 0 1.4rem;
    justify-content: center; align-items: center;
  }
  .backlink {
    /* 44px, like every other control a child taps. These were 36 and 37px
       — small enough to miss on a phone, and they are the two links that
       lead OUT of a dead end (back to the parent board, or booking another
       lesson), so missing them is the worst moment to be fumbling. */
    display: inline-flex; align-items: center; min-height: 44px;
    margin-top: 1rem; font-size: .85rem;
    font-weight: 700; color: var(--accent); text-decoration: none;
    padding: .5rem .2rem;
  }
</style>

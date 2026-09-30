<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { PLANS, planFor, formatPrice, RECOMMENDED_BADGE, type Plan } from '$lib/plans.ts';
  import { SUBJECT } from '$lib/subjects.ts';
  import { lockScroll } from '$lib/scroll-lock.ts';
  import { initMarketing, track, attribution } from '$lib/marketing.ts';
  import { HEARD_FROM_OPTIONS } from '$lib/marketing-labels.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import { contactTutor } from '$lib/tutors.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  onMount(() => {
    initMarketing(new URL(location.href));
  });

  // "איך שמעתם עלינו?" — the marketing funnel's optional self-report
  // question (docs/superpowers/specs/2026-09-24-marketing-funnel-design.md).
  // The <option value="..."> below (in the pane-2 markup) are rendered from
  // HEARD_FROM_OPTIONS ($lib/marketing-labels.ts) — the same list
  // src/routes/api/book/+server.ts's HEARD_FROM_VALUES and the /app/marketing
  // report both read, so an answer outside that list is impossible to
  // produce from this select and a label can never drift out of sync with
  // what the server accepts or the report displays.

  type Slot = { start: string; end: string; dateLabel: string; timeLabel: string };
  type DayGroup = { label: string; slots: Slot[] };

  type Handoff = { link: string; code: string; studentName: string; isNewFamily: boolean };

  // Shown to parents in local form; the tel: link uses the international one
  // (TUTOR_PHONE, from $lib/contact.ts — see that file's doc comment).
  const TUTOR_PHONE_DISPLAY = '054-696-9891';

  let step = $state<'duration' | 'slots' | 'success'>('duration');
  let selectedPlan = $state<Plan | null>(null);
  let selectedSlot = $state<Slot | null>(null);

  /* 'unconfirmed' is a degraded read, not an error: the times shown came
     from a calendar we could only partly read (or could not read at all),
     so they are offered WITH a warning rather than withheld. A family that
     cannot book is a lost family; a family booked into an hour the tutor is
     already teaching is a worse outcome than either. */
  let slotState = $state<'loading' | 'empty' | 'slots' | 'unconfirmed' | 'error'>('loading');
  let dayGroups = $state<DayGroup[]>([]);
  /* Step 2 used to render every slot for the next seven days at once —
     around 140 bare time chips over three phone screens, with no way to
     narrow them. One day is visible at a time now; the rest are one tap
     away. */
  let openDay = $state(0);

  function selectPlan(plan: Plan) {
    selectedPlan = plan;
    step = 'slots';
    track('booking_started');
    loadSlots();
  }

  function goBack() {
    step = 'duration';
  }

  // ── Load slots from the server ──────────────────────────────────────────
  async function loadSlots() {
    slotState = 'loading';
    openDay = 0;

    try {
      const res = await fetch(`/api/availability?duration=${selectedPlan!.minutes}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      /* The endpoint tells us how much of the calendar it actually read.
         `calendarConnected` means iCal is the configured source — it has
         never meant every feed answered, which is what calendarFailures is
         for. Ignoring both is how a partial read used to render as a clean
         one. */
      const degraded = data.calendarConnected === false || (data.calendarFailures ?? 0) > 0;
      renderOrEmpty(data.slots || [], degraded);
    } catch {
      /* There used to be a client-side generateLocalSlots() here: a weekly
         availability table hardcoded in this file, down to a blocked-dates
         list of 2026 holidays that had already passed. It meant a server
         failure showed the family invented times they could book — a
         schedule that looks fine over a failure that is not. Saying we
         cannot check right now is the honest answer, and the WhatsApp
         escape below turns it into a booking anyway. */
      /* Not "no free times": we could not ask. Saying the week is full
         when the request failed turned families away (pre-launch review,
         2026-09-28). */
      slotState = 'error';
    }
  }

  function renderOrEmpty(slots: Slot[], degraded = false) {
    if (!slots.length) { slotState = 'empty'; return; }
    renderSlots(slots);
    slotState = degraded ? 'unconfirmed' : 'slots';
  }

  function renderSlots(slots: Slot[]) {
    const groups: Record<string, Slot[]> = {};
    const order: string[] = [];
    for (const s of slots) {
      if (!groups[s.dateLabel]) { groups[s.dateLabel] = []; order.push(s.dateLabel); }
      groups[s.dateLabel].push(s);
    }
    dayGroups = order.map((label) => ({ label, slots: groups[label] }));
  }

  /** "יום שני, 8 ספטמבר" → "שני 8.9" for the day chips, which have to fit
   *  several across a 390px screen without wrapping. */
  function shortDay(label: string): string {
    const m = label.match(/^יום\s+(\S+),\s*(\d+)/);
    return m ? `${m[1]} ${m[2]}` : label;
  }

  // ── The details sheet ────────────────────────────────────────────────────
  let sheetOpen = $state(false);

  /* The step indicator reads `step` and the sheet directly instead of
     tracking its own "which dot is active" number. The old `activeDot`
     advanced to 3 the moment the sheet opened, so the indicator claimed
     step 3 while step 2 was still rendered underneath it — the code said as
     much in a comment rather than fixing it. Declared here, after
     `sheetOpen`, because a $derived reads its dependencies eagerly. */
  let activeStep = $derived(step === 'duration' ? 1 : sheetOpen || step === 'success' ? 3 : 2);
  let pane = $state<1 | 2>(1);
  let sheetEl = $state<HTMLDivElement | null>(null);
  let firstFieldEl = $state<HTMLInputElement | null>(null);
  /** Restored on close so keyboard and screen-reader users land back on the
   *  slot they opened rather than at the top of the document. */
  let openerEl: HTMLElement | null = null;

  function openSheet(slot: Slot, event: MouseEvent) {
    selectedSlot = slot;
    openerEl = event.currentTarget as HTMLElement;
    pane = 1;
    errors = {};

    /* A known family's contact details come from their account. They stay
       editable — an address or a number can change — but they are not
       re-asked on every booking. */
    if (data.known) {
      if (!email) email = data.email ?? '';
      if (!phone) phone = data.phone ?? '';
      // One child means there is nothing to choose between.
      if (data.students.length === 1 && !chosen) pickStudent(data.students[0].code);
    }

    sheetOpen = true;
  }

  function closeSheet() {
    sheetOpen = false;
    openerEl?.focus();
    openerEl = null;
  }

  /* The sheet used to be a card inside a 90vh scroller with no dialog
     semantics at all: no role, no focus trap, no Escape, and the page still
     scrolling behind it. Every one of those is handled here rather than
     left to the browser, because a <dialog> element cannot be styled into
     the full-screen sheet this needs below 600px without the same amount of
     code. */
  $effect(() => {
    if (!sheetOpen) return;

    const unlock = lockScroll();

    // Focus lands on the first field, not the sheet, so a parent can start
    // typing immediately. Deferred one frame so the element exists.
    const raf = requestAnimationFrame(() => firstFieldEl?.focus());

    return () => {
      unlock();
      cancelAnimationFrame(raf);
    };
  });

  function focusables(): HTMLElement[] {
    if (!sheetEl) return [];
    return Array.from(sheetEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
  }

  function onSheetKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;

    // Without this, Tab walks out of the sheet and into the ~140 slot
    // buttons still rendered behind it.
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey && (active === first || !sheetEl?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ── The form ─────────────────────────────────────────────────────────────
  let isSelf = $state<boolean | null>(null);
  let name = $state('');

  /* ── The returning family ───────────────────────────────────────────────
     The session already names this family's children and carries their
     contact details, so a second booking should not re-ask for any of it.
     `chosen` is the student whose card was tapped; null means either a
     first-time visitor or a known family adding someone new, and both get
     the full blank form. */
  let chosen = $state<string | null>(null);
  let editingDetails = $state(false);
  let editingContact = $state(false);

  const knownFamily = $derived(data.known && data.students.length > 0);

  function pickStudent(code: string) {
    const kid = data.students.find(s => s.code === code);
    if (!kid) return;
    chosen = code;
    editingDetails = false;
    // Carry what the child actually learns rather than making a parent
    // re-choose it from a dropdown they already answered once.
    name = kid.name;
    level = kid.level;
    isSelf = data.isSelf;
    errors = {};
  }

  function pickSomeoneElse() {
    chosen = 'other';
    editingDetails = true;
    name = '';
    level = '';
    isSelf = null;
    errors = {};
  }
  /* Every lesson is maths: not asked, always sent (Todoist 6hfrX4XvwJRjccRq). */
  const subject = SUBJECT;
  let request = $state('');
  let level = $state('');
  let phone = $state('');
  let email = $state('');
  /** "איך שמעתם עלינו?" — optional, never validated as required (see
   *  validatePane1/validatePane2 below), and never sent at all when blank
   *  (submitBooking). '' is "not answered", the same convention every
   *  other optional field on this page uses. */
  let heardFrom = $state('');
  let submitting = $state(false);
  let submitError = $state('');
  /** A failed save (not a validation message): offer the WhatsApp we name. */
  let submitFailed = $state(false);
  /** Booked while the calendar could not be checked, or not written to it:
   *  a request the tutor confirms, not a confirmed lesson. */
  let bookedUnconfirmed = $state(false);

  type FieldName = 'isSelf' | 'name' | 'level' | 'email' | 'phone';
  let errors = $state<Partial<Record<FieldName, string>>>({});

  const learnerLabel = $derived(isSelf ? 'השם שלך' : 'שם התלמיד/ה');

  /* Validation is inline and announced, never an alert(). Five native
     alerts used to fire here; each one stole focus, blocked the page, and
     lost the parent's scroll position on a phone. */
  function validatePane1(): boolean {
    const next: Partial<Record<FieldName, string>> = {};

    /* A known family who has not picked yet gets one message about the one
       decision in front of them, rather than four field errors for fields
       the picker has not shown. */
    if (knownFamily && !editingDetails && !chosen) {
      errors = { ...errors, isSelf: 'בחרו מי לומד' };
      return false;
    }

    if (isSelf === null) next.isSelf = 'בחרו מי לומד';
    if (!name.trim()) next.name = isSelf ? 'צריך את השם שלך' : 'צריך את שם התלמיד/ה';
    if (!level) next.level = 'בחרו כיתה או רמה';
    errors = { ...errors, ...next, ...clearedOf(['isSelf', 'name', 'level'], next) };
    return !Object.keys(next).length;
  }

  function validatePane2(): boolean {
    const next: Partial<Record<FieldName, string>> = {};
    const e = email.trim();
    // Deliberately permissive. The address only has to be plausible here —
    // whether it is real is settled by whether the link arrives, and a
    // strict pattern rejects valid addresses far more often than it catches
    // typos.
    if (!e) next.email = 'צריך מייל — לשם נשלח הקישור לדף האישי';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) next.email = 'הכתובת לא נראית תקינה';

    const p = phone.replace(/[\s-]/g, '');
    if (!p) next.phone = 'צריך מספר טלפון';
    else if (!/^0\d{8,9}$/.test(p)) next.phone = 'מספר טלפון ישראלי, למשל 0541234567';

    errors = { ...errors, ...next, ...clearedOf(['email', 'phone'], next) };
    return !Object.keys(next).length;
  }

  /** Fields in `scope` that passed this time get their old message removed,
   *  so a corrected field stops showing an error the moment it is right. */
  function clearedOf(scope: FieldName[], next: Partial<Record<FieldName, string>>) {
    const cleared: Partial<Record<FieldName, string>> = {};
    for (const f of scope) if (!next[f]) cleared[f] = undefined;
    return cleared;
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      sheetEl?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  }

  function onPrimary() {
    if (pane === 1) {
      if (!validatePane1()) { focusFirstError(); return; }
      pane = 2;
      requestAnimationFrame(() => {
        sheetEl?.querySelector<HTMLElement>('#inp-email')?.focus();
      });
      return;
    }
    if (!validatePane2()) { focusFirstError(); return; }
    submitBooking();
  }

  // ── Success ──────────────────────────────────────────────────────────────
  let successRows = $state<{ icon: string; label: string; value: string }[]>([]);
  let handoff = $state<Handoff | null>(null);
  let emailSent = $state(false);
  /* An existing family: the link went to the email on file and is never
     shown here — see /api/book's mayHandOver. */
  let linkEmailed = $state(false);
  let copied = $state(false);
  // Set when the server could not enrol the family (see /api/book's
  // `pending` field) — the calendar/email may still have gone out, but
  // nothing was actually recorded for them, so the screen below must say
  // "received", never "booked", and there is no portal to hand over.
  let pending = $state(false);
  /* The email belongs to a family we know, and this device is not signed in
     as them: nothing is booked until the address on file confirms it
     (/api/book's holdForConfirmation). */
  let awaiting = $state(false);

  function showSuccess(portal: Handoff | null, familyEmailed: boolean, isPending: boolean, emailedLink = false) {
    const dateLabel = selectedSlot?.dateLabel ?? '';
    const timeLabel = selectedSlot?.timeLabel ?? '';
    const plan = selectedPlan!;

    sheetOpen = false;
    openerEl = null;
    step = 'success';
    pending = isPending;
    // No portal to hand over when the enrolment itself failed — the server
    // already sends portal: null in that case, but never trust a truthful
    // screen to an upstream field alone.
    handoff = isPending ? null : portal;
    emailSent = familyEmailed;
    linkEmailed = !isPending && !portal && emailedLink;

    successRows = [
      ['📅', 'מועד', `${dateLabel} · ${timeLabel}`],
      ['⏱️', 'שיעור', `${plan.name} · ${plan.minutes} דקות`],
      ['💳', 'מחיר', formatPrice(plan.shekels)],
      ['👤', isSelf ? 'שם' : 'תלמיד/ה', name.trim()],
      ['📖', 'מקצוע', subject],
      ['🎓', 'כיתה / רמה', level],
      ['❓', 'מה נלמד', request.trim() || 'ייקבע יחד בשיעור'],
      ['✉️', 'המייל שלכם', email.trim()],
      // Labelled "your phone" so it is not confused with the tutor's number below.
      ['📱', 'הטלפון שלכם', phone.trim()],
    ].map(([icon, label, value]) => ({ icon, label, value }));
  }

  async function copyLink() {
    if (!handoff) return;
    try {
      await navigator.clipboard.writeText(handoff.link);
      copied = true;
      setTimeout(() => { copied = false; }, 2400);
    } catch {
      /* Clipboard access is denied in some in-app browsers. The link is
         rendered in full below the buttons for exactly this case, so
         there is nothing to recover from — say nothing and let them
         select it. */
    }
  }

  const shareHref = $derived(handoff
    ? `https://wa.me/?text=${encodeURIComponent(`הדף האישי במאה בקליק:\n${handoff.link}`)}`
    : '');

  // ── Submit ───────────────────────────────────────────────────────────────
  async function submitBooking() {
    submitting = true;
    submitError = '';
    submitFailed = false;
    track('booking_submitted');

    try {
      const attrib = attribution();
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          subject: SUBJECT,
          request: request.trim(),
          level,
          phone: phone.trim(),
          email: email.trim(),
          isSelf: !!isSelf,
          start: selectedSlot!.start,
          end: selectedSlot!.end,
          durationMin: selectedPlan!.minutes,
          ...(attrib ? { attribution: attrib } : {}),
          ...(heardFrom ? { heardFrom } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 400 && data.error) {
        submitError = data.error;
        submitting = false;
        return;
      }
      if (res.status === 409) {
        submitError = data.error || 'השעה הזו כבר נתפסה. בחרו מועד אחר.';
        submitting = false;
        // The list behind the sheet is stale now: refresh it for the next pick.
        loadSlots();
        return;
      }

      /* Either path is a real booking — the tutor is notified either way.
         The difference is only whether it also landed in the calendar
         automatically, which is her problem to resolve, not something to
         show the parent. */
      if (data.awaitingConfirmation) {
        awaiting = true;
        showSuccess(null, false, false);
        return;
      }
      if (data.ok || data.fallback) {
        bookedUnconfirmed = slotState === 'unconfirmed' || !!data.fallback;
        showSuccess(data.portal ?? null, !!data.familyEmailed, !!data.pending, !!data.linkEmailed);
      } else {
        throw new Error(data.error || 'שגיאה לא ידועה');
      }
    } catch {
      /* Never the raw exception. A parent used to be shown
         `alert('שגיאה בשמירת ההזמנה: Unexpected token < in JSON at position 0')`. */
      submitError = 'לא הצלחנו לשמור את ההזמנה. נסו שוב, או שלחו לנו הודעה בוואטסאפ.';
      submitFailed = true;
      submitting = false;
    }
  }

  const primaryLabel = $derived(
    pane === 1 ? 'המשך'
    : submitting ? '...מזמין'
    : `אישור הזמנה · ${formatPrice(selectedPlan?.shekels ?? 0)}`
  );
</script>

<svelte:head>
  <title>הזמנת שיעור — מאה בקליק</title>
</svelte:head>

<header>
  <a class="brand" href="/">
    <BrandMark height={30} href={null} label={null} />
    <span>מאה בקליק</span>
  </a>
  <a class="back" href="/">→ חזרה לאתר</a>
</header>

<main>
  <h1>🗓️ הזמנת שיעור</h1>

  <!-- Steps indicator -->
  <div class="steps-bar">
    <div class="step-dot" class:active={activeStep === 1} class:done={activeStep > 1}>
      <div class="dot">1</div>
      <span>סוג שיעור</span>
    </div>
    <div class="step-line"></div>
    <div class="step-dot" class:active={activeStep === 2} class:done={activeStep > 2}>
      <div class="dot">2</div>
      <span>בחירת זמן</span>
    </div>
    <div class="step-line"></div>
    <div class="step-dot" class:active={activeStep === 3} class:done={step === 'success'}>
      <div class="dot">3</div>
      <span>פרטים</span>
    </div>
  </div>

  <!-- ── STEP 1: Plan ─────────────────────────────────────── -->
  {#if step === 'duration'}
    <div id="step-duration">
      <p class="subtitle">איזה שיעור מתאים לכם?</p>
      <div class="duration-grid">
        {#each PLANS as plan (plan.minutes)}
          <button class="dur-card" class:recommended={plan.recommended} onclick={() => selectPlan(plan)}>
            {#if plan.recommended}<span class="dur-badge">{RECOMMENDED_BADGE}</span>{/if}
            <div class="dur-icon">{plan.icon}</div>
            <div class="dur-name">{plan.name}</div>
            <div class="dur-price">{formatPrice(plan.shekels)}</div>
            <div class="dur-time">{plan.minutes} דקות</div>
            <div class="dur-desc">{plan.description}</div>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- ── STEP 2: Slot picker ─────────────────────────────── -->
{#snippet slotPicker()}
        <div class="day-tabs" role="tablist" aria-label="ימים פנויים">
          {#each dayGroups as group, i (group.label)}
            <button
              role="tab"
              class="day-tab"
              class:active={openDay === i}
              aria-selected={openDay === i}
              onclick={() => (openDay = i)}
            >{shortDay(group.label)}</button>
          {/each}
        </div>

        {#if dayGroups[openDay]}
          <div class="day-panel" role="tabpanel">
            <div class="day-label">{dayGroups[openDay].label}</div>
            <div class="slots-row">
              {#each dayGroups[openDay].slots as slot (slot.start)}
                <button class="slot" onclick={(e) => openSheet(slot, e)}>{slot.timeLabel}</button>
              {/each}
            </div>
          </div>
        {/if}
{/snippet}

  {#if step === 'slots'}
    <div id="step-slots">
      <button class="back-btn" onclick={goBack}>החלף סוג שיעור →</button>
      <div class="selected-plan-badge">
        ⏱️ {selectedPlan?.name} · {selectedPlan?.minutes} דקות · {formatPrice(selectedPlan?.shekels ?? 0)}
      </div>

      {#if slotState === 'loading'}
        <div class="state-block" aria-live="polite">
          <div class="spinner"></div>
          <p>בודק זמינות...</p>
        </div>
      {:else if slotState === 'unconfirmed'}
        <!-- A degraded calendar read. The times are real slots from the
             teaching window, but some (or all) of the tutor's calendar
             could not be read this minute, so they are not confirmed free.
             Said plainly, above the slots, because a parent who books a
             taken hour finds out when the lesson does not happen. Status is
             carried by the words and the ⚠ glyph, never by colour alone. -->
        <div class="unconfirmed-note" role="status" aria-live="polite">
          <strong>⚠ לא הצלחנו לבדוק את היומן כרגע.</strong>
          <p>
            השעות למטה פנויות לפי הזמנות באתר, אבל ייתכן שחלקן כבר תפוסות.
            אפשר לבחור שעה ונחזור אליכם לאישור — או לתאם ישירות בוואטסאפ.
          </p>
          <a
            class="wa-link"
            href="https://wa.me/{TUTOR_PHONE}?text=היי%2C%20אני%20מעוניין%2Fת%20לתאם%20שיעור"
            target="_blank" rel="noopener"
            onclick={() => track('cta_click', { target: 'whatsapp' })}>תיאום בוואטסאפ ←</a>
        </div>
        {@render slotPicker()}
      {:else if slotState === 'error'}
        <div class="state-block" role="status">
          <p>לא הצלחנו לטעון את השעות כרגע.<br />אפשר לנסות שוב, או לתאם בוואטסאפ.</p>
          <button class="btn-retry" onclick={loadSlots}>נסו שוב</button>
          <a class="wa-link" href="https://wa.me/{TUTOR_PHONE}?text={encodeURIComponent('היי, אני רוצה לתאם שיעור')}" target="_blank" rel="noopener">פתיחת וואטסאפ ←</a>
        </div>
      {:else if slotState === 'empty'}
        <div class="state-block">
          <p>אין שעות פנויות בשבוע הקרוב.<br />פנו אלינו בוואטסאפ לתיאום.</p>
          <a
            class="wa-link"
            href="https://wa.me/{TUTOR_PHONE}?text=היי%2C%20אני%20מעוניין%2Fת%20בשיעור%20אבל%20לא%20מצאתי%20זמן%20מתאים"
            target="_blank" rel="noopener"
            onclick={() => track('cta_click', { target: 'whatsapp' })}>פתיחת וואטסאפ ←</a>
        </div>
      {:else}
        {@render slotPicker()}
      {/if}
    </div>
  {/if}

  <!-- ── STEP 3: Success + handoff ──────────────────────── -->
  {#if step === 'success'}
    <div id="step-success">
      {#if awaiting}
        <div class="success-icon">📧</div>
        <h2>כמעט סיימנו: אשרו במייל</h2>
        <p class="success-pending-note">
          הכתובת <span dir="ltr">{email.trim()}</span> כבר מוכרת לנו, אז שלחנו אליה מייל עם כפתור אישור.
          השיעור יירשם אחרי האישור (תוך יממה), ועד אז השעה שמורה לכם.
        </p>
      {:else if pending}
        <div class="success-icon">📝</div>
        <h2>הבקשה נקלטה</h2>
        <p class="success-pending-note">
          לא הצלחנו להשלים את הרישום אוטומטית — נאשר את המועד ונשלח את הדף האישי.
        </p>
      {:else}
        <div class="success-icon">✅</div>
        <h2>{bookedUnconfirmed ? 'הבקשה התקבלה!' : 'השיעור נקבע!'}</h2>
        {#if bookedUnconfirmed}
          <p class="success-pending-note">לא הצלחנו לבדוק את היומן ברגע ההזמנה, אז נאשר את המועד ונעדכן אתכם.</p>
        {/if}
      {/if}

      {#if handoff && !pending}
        <!-- The whole point of the rebuild: the confirmation IS the door.
             The family used to leave this screen with nothing, while their
             link went only to the tutor's inbox. -->
        <div class="handoff">
          <div class="handoff-title">
            {handoff.isNewFamily ? 'הדף האישי של' : 'הדף האישי של'}
            <strong>{handoff.studentName}</strong>
          </div>
          <p class="handoff-sub">
            כאן יופיעו סיכומי השיעורים, שיעורי הבית והמצגות.
          </p>

          <!-- data-sveltekit-reload: /enter is a server endpoint, not a page;
               the client router tried it first and logged a "Not found". -->
          <a class="handoff-primary" href={handoff.link} data-sveltekit-reload><Icon name="portal" size={17} /> פתיחת הדף האישי</a>

          <div class="handoff-actions">
            <button class="handoff-secondary" onclick={copyLink}>
              {copied ? '✓ הקישור הועתק' : '🔗 העתקת הקישור'}
            </button>
            <a class="handoff-secondary" href={shareHref} target="_blank" rel="noopener">
              💬 שליחה לוואטסאפ
            </a>
          </div>

          <div class="handoff-link" dir="ltr">{handoff.link}</div>

          <p class="handoff-note">
            {#if emailSent}
              שלחנו את הקישור גם למייל <span dir="ltr">{email.trim()}</span>.
            {:else}
              שמרו את הקישור — אפשר תמיד לבקש חדש מדף הכניסה.
            {/if}
          </p>
        </div>
      {/if}

      {#if linkEmailed}
        <div class="handoff">
          <div class="handoff-title">כבר יש לכם דף אישי אצלנו</div>
          <p class="handoff-sub">
            שלחנו אליו קישור למייל שאיתו נרשמתם. לא הגיע?
            <a href="/portal" data-sveltekit-reload>אפשר לבקש קישור חדש</a>.
          </p>
        </div>
      {/if}

      <div class="success-detail">
        <div class="bk-summary">
          {#each successRows as row (row.label)}
            <div class="bk-row">
              <span class="bk-label">{row.icon} {row.label}</span>
              <span class="bk-value">{row.value}</span>
            </div>
          {/each}
        </div>
        <div class="bk-next">
          <strong>מה הלאה?</strong>
          <ul>
            {#if awaiting}<li>לאשר את השיעור מהמייל</li>{:else if bookedUnconfirmed}<li>ניצור קשר לאישור המועד</li>{:else}<li>תזכורת תישלח אליכם במייל לפני השיעור</li>{/if}
            <li>מומלץ להכין מראש את החומר או השאלות שלא הובנו</li>
          </ul>
        </div>
        <div class="bk-contact">
          <div class="bk-contact-title">יש שאלות?</div>
          <a class="bk-contact-phone" href="tel:+{TUTOR_PHONE}">📞 {TUTOR_PHONE_DISPLAY}</a>
          <div class="bk-contact-note">{contactTutor().name} · אפשר להתקשר או לשלוח הודעה</div>
        </div>
        <button class="bk-print" onclick={() => window.print()}>🖨️ הדפסה / שמירה כ-PDF</button>
      </div>

      <a class="home-btn" href="/">חזרה לאתר</a>
    </div>
  {/if}
</main>

<!-- ── The details sheet ───────────────────────────────────── -->
{#if sheetOpen}
  <div
    class="sheet-overlay"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}
  >
    <div
      class="sheet"
      bind:this={sheetEl}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      onkeydown={onSheetKeydown}
      tabindex="-1"
    >
      <div class="sheet-head">
        <div>
          <h2 id="sheet-title">{pane === 1 ? '✍️ פרטי השיעור' : '✉️ איך נשאר בקשר'}</h2>
          <div class="sheet-when">
            {selectedSlot?.dateLabel} · {selectedSlot?.timeLabel} · {selectedPlan?.name}
          </div>
        </div>
        <button class="sheet-close" onclick={closeSheet} aria-label="סגירה"><Icon name="close" size={16} /></button>
      </div>

      <div class="sheet-body">
        {#if pane === 1}
          {#if knownFamily && !editingDetails}
            <fieldset class="who">
              <legend>מי לומד?</legend>
              <!-- The session already names this family's children, so a
                   returning parent picks one instead of re-typing a name, a
                   subject and a level they have already given us. -->
              <div class="pick-grid">
                {#each data.students as kid (kid.code)}
                  <button
                    type="button" class="pick-card" class:active={chosen === kid.code}
                    aria-pressed={chosen === kid.code}
                    onclick={() => pickStudent(kid.code)}
                  >
                    <span class="pick-emoji">{kid.emoji}</span>
                    <span class="pick-name">{kid.name}</span>
                    {#if kid.subject || kid.level}
                      <span class="pick-meta">{[kid.subject, kid.level].filter(Boolean).join(' · ')}</span>
                    {/if}
                  </button>
                {/each}
                <button type="button" class="pick-card pick-other" onclick={pickSomeoneElse}>
                  <span class="pick-emoji">➕</span>
                  <span class="pick-name">מישהו אחר</span>
                  <span class="pick-meta">ילד/ה נוסף/ת או שיעור חד-פעמי</span>
                </button>
              </div>
              {#if errors.isSelf}<p class="field-error">{errors.isSelf}</p>{/if}
            </fieldset>

            {#if chosen && chosen !== 'other'}
              <div class="picked-recap">
                <span>{[subject, level].filter(Boolean).join(' · ')}</span>
                <button type="button" class="linkish" onclick={() => (editingDetails = true)}>שינוי פרטים</button>
              </div>

              <label for="inp-request">יש משהו שחשוב שנתמקד בו בשיעור? <span class="optional">(לא חובה)</span></label>
              <textarea
                id="inp-request" bind:value={request} maxlength="500"
                placeholder="נושא למבחן, תרגיל שנתקעתם בו או בקשה להמשך"
              ></textarea>
            {/if}
          {:else}
          <fieldset class="who">
            <legend>מי לומד?</legend>
            <!-- Replaces "כבר הזמנתם שיעור בעבר?" defaulting to "לא", which
                 quietly created a second student record for every returning
                 family. Nothing is preselected here: the answer changes the
                 account shape, so it is asked, not assumed. -->
            <div class="who-cards">
              <button
                type="button" class="who-card" class:active={isSelf === false}
                aria-pressed={isSelf === false}
                onclick={() => { isSelf = false; errors = { ...errors, isSelf: undefined }; }}
              >
                <span class="who-emoji">🎒</span>
                <span class="who-label">הילד/ה שלי</span>
              </button>
              <button
                type="button" class="who-card" class:active={isSelf === true}
                aria-pressed={isSelf === true}
                onclick={() => { isSelf = true; errors = { ...errors, isSelf: undefined }; }}
              >
                <span class="who-emoji">🙋</span>
                <span class="who-label">אני</span>
              </button>
            </div>
            {#if errors.isSelf}<p class="field-error">{errors.isSelf}</p>{/if}
          </fieldset>

          <label for="inp-name">{learnerLabel}</label>
          <input
            id="inp-name" type="text" placeholder="ישראל ישראלי"
            bind:value={name} bind:this={firstFieldEl}
            aria-invalid={!!errors.name} aria-describedby={errors.name ? 'err-name' : undefined}
          />
          {#if errors.name}<p class="field-error" id="err-name">{errors.name}</p>{/if}

          <p class="fixed-subject">📐 שיעור פרטי במתמטיקה</p>

          <label for="inp-level">כיתה / רמה</label>
          <select
            id="inp-level" bind:value={level}
            aria-invalid={!!errors.level} aria-describedby={errors.level ? 'err-level' : undefined}
          >
            <option value="">בחרו רמה...</option>
            <option>כיתה א–ב</option>
            <option>כיתה ג–ד</option>
            <option>כיתה ה–ו</option>
            <option>כיתה ז</option>
            <option>כיתה ח</option>
            <option>כיתה ט</option>
            <option>כיתה י</option>
            <option>כיתה יא</option>
            <option>כיתה יב</option>
            <option>אחר</option>
          </select>
          {#if errors.level}<p class="field-error" id="err-level">{errors.level}</p>{/if}

          <label for="inp-request">יש משהו שחשוב שנתמקד בו בשיעור? <span class="optional">(לא חובה)</span></label>
          <textarea
            id="inp-request" bind:value={request} maxlength="500"
            placeholder="נושא למבחן, תרגיל שנתקעתם בו או בקשה להמשך"
          ></textarea>
          {/if}
        {:else}
          {#if data.known && !editingContact && email && phone}
            <!-- A returning family's details come from their account. Shown
                 rather than hidden, because a booking confirmation going to
                 a stale address is worth catching here — but not re-typed. -->
            <div class="known-contact">
              <div class="known-lines">
                <div><span aria-hidden="true">✉️</span> <span dir="ltr">{email}</span></div>
                <div><span aria-hidden="true">📱</span> <span dir="ltr">{phone}</span></div>
              </div>
              <button type="button" class="linkish" onclick={() => (editingContact = true)}>עדכון פרטים</button>
            </div>
          {:else}
          <p class="pane-intro">
            למייל נשלח הקישור לדף האישי — שם תראו את סיכומי השיעורים ושיעורי הבית.
            הטלפון הוא הדרך שבה נאשר איתכם את המועד.
          </p>

          <label for="inp-email">מייל</label>
          <input
            id="inp-email" type="email" inputmode="email" autocomplete="email"
            dir="ltr" placeholder="name@example.com" bind:value={email}
            aria-invalid={!!errors.email} aria-describedby={errors.email ? 'err-email' : 'hint-email'}
          />
          {#if errors.email}
            <p class="field-error" id="err-email">{errors.email}</p>
          {:else}
            <p class="field-hint" id="hint-email">לשם נשלח הקישור לדף האישי.</p>
          {/if}

          <label for="inp-phone">טלפון</label>
          <input
            id="inp-phone" type="tel" inputmode="tel" autocomplete="tel"
            dir="ltr" placeholder="0541234567" bind:value={phone}
            aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'err-phone' : 'hint-phone'}
          />
          {#if errors.phone}
            <p class="field-error" id="err-phone">{errors.phone}</p>
          {:else}
            <p class="field-hint" id="hint-phone">רק לתיאום השיעור. לא נשלח פרסומות ולא נעביר לאף אחד.</p>
          {/if}

          {/if}

          {#if !data.known}
          <!-- The tutor already knows how she reached a returning family —
               this question exists to find out for a first booking. -->
          <label for="inp-heard-from">איך שמעתם עלינו? <span class="optional">(לא חובה)</span></label>
          <select id="inp-heard-from" bind:value={heardFrom}>
            <option value="">בחרו...</option>
            {#each HEARD_FROM_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
          {/if}

          <div class="recap">
            <div class="recap-row"><span>{selectedPlan?.name} · {selectedPlan?.minutes} דקות</span><b>{formatPrice(selectedPlan?.shekels ?? 0)}</b></div>
            <div class="recap-row"><span>{selectedSlot?.dateLabel}</span><b>{selectedSlot?.timeLabel}</b></div>
          </div>
        {/if}

        <!-- Announced rather than merely shown: a submit failure that only
             changes pixels is invisible to a screen reader. -->
        <div class="live" role="alert" aria-live="assertive">
          {#if submitError}<p class="submit-error">{submitError}</p>{/if}
          {#if submitFailed}<a class="wa-link" href="https://wa.me/{TUTOR_PHONE}?text={encodeURIComponent('היי, ניסיתי להזמין שיעור באתר ולא הצלחתי')}" target="_blank" rel="noopener">שליחת הודעה בוואטסאפ ←</a>{/if}
        </div>
      </div>

      <!-- Fixed, always visible. The confirm button used to sit inside the
           scrolling panel and below the fold: measured at y=813 against an
           844px viewport, so the sheet opened with no visible way to
           submit. -->
      <div class="sheet-foot">
        {#if pane === 2}
          <button class="btn-back" onclick={() => { pane = 1; submitError = ''; }} disabled={submitting}>→ חזרה</button>
        {/if}
        <button class="btn-primary" onclick={onPrimary} disabled={submitting}>{primaryLabel}</button>
      </div>
      <p class="sheet-note">השיעור יתואם ביומן, ונחזור אליכם לאישור סופי.</p>
      <!-- Notice at the moment of contracting, which is the one place it
           legally matters. A line rather than a checkbox on purpose: a
           required tick is friction on the only conversion step the funnel
           has, and acceptance by action is documented just as well here.
           target="_blank" so opening the terms never discards the sheet's
           half-filled form state. -->
      <p class="sheet-legal">
        בהזמנת שיעור את/ה מאשר/ת את
        <a href="/terms" target="_blank" rel="noopener">התקנון</a>
        ו<a href="/privacy" target="_blank" rel="noopener">מדיניות הפרטיות</a>.
      </p>
    </div>
  </div>
{/if}

<style>
  /* ── header ─────────────────────────────────── */
  header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 0.9rem 1.5rem;
    display: flex;
    align-items: center;
    /* Was `justify-content: normal`, which bunched both children at the
       inline start and left 1230px of empty header at desktop width. */
    justify-content: space-between;
    gap: 1rem;
  }
  header .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--text-primary);
    text-decoration: none;
  }
  header a.back {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
    padding: 0.5rem 0.2rem;
  }
  header a.back:hover { text-decoration: underline; }

  /* ── main ────────────────────────────────────── */
  main {
    max-width: 700px;
    margin: 0 auto;
    padding: 2rem 1.2rem 5rem;
  }

  h1 { font-size: 1.7rem; color: var(--text-primary); margin-bottom: 0.4rem; }
  .subtitle { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.6rem; }

  /* ── step indicator ──────────────────────────── */
  .steps-bar { display: flex; align-items: center; margin-bottom: 2rem; }
  .step-dot {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.8rem; color: var(--text-muted); font-weight: 600;
  }
  .step-dot .dot {
    width: 24px; height: 24px;
    border-radius: 50%;
    background: var(--border);
    color: var(--text-muted);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.75rem; font-weight: 700;
    transition: background 0.2s, color 0.2s;
  }
  .step-dot.active .dot { background: var(--accent); color: #fff; }
  .step-dot.active { color: var(--accent); }
  .step-dot.done .dot { background: var(--accent3-strong); color: #fff; }
  .step-line { flex: 1; height: 2px; background: var(--border); margin: 0 0.6rem; }

  /* ── STEP 1: Plan cards ──────────────────────── */
  .duration-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
  .dur-card {
    background: var(--bg-card);
    border: 2px solid var(--border);
    border-radius: var(--r-md);
    padding: 1.4rem 1rem;
    cursor: pointer;
    text-align: center;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    font-family: inherit;
    color: var(--text-primary);
  }
  .dur-card:hover {
    border-color: var(--accent);
    /* Was rgba(46,123,116,…) — a teal left over from a palette this
       project no longer uses, sitting against the blue accent token. */
    box-shadow: 0 4px 16px var(--shadow-accent);
    transform: translateY(-2px);
  }
  .dur-card:active { transform: translateY(0); }
  /* Same treatment as the landing page's featured pricing card, so the
     parent sees the same plan singled out on both pages. */
  .dur-card.recommended {
    position: relative;
    background: var(--pricing-featured-bg);
    border-color: var(--pricing-featured-border);
    box-shadow: 0 4px 24px var(--accent2-glow);
  }
  .dur-badge {
    position: absolute;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent2);
    color: var(--btn-text);
    font-size: 0.72rem;
    font-weight: 800;
    padding: 0.2rem 0.85rem;
    border-radius: 20px;
    white-space: nowrap;
    box-shadow: 0 3px 10px var(--accent2-glow);
  }
  .dur-icon { font-size: 1.7rem; }
  .dur-name { font-size: 1.1rem; font-weight: 800; color: var(--text-primary); }
  .dur-price { font-size: 1.45rem; font-weight: 900; color: var(--accent); line-height: 1.1; }
  .dur-time { font-size: 0.85rem; color: var(--text-muted); font-weight: 600; }
  .dur-desc { font-size: 0.82rem; color: var(--text-muted); line-height: 1.45; margin-top: 0.2rem; }

  /* ── STEP 2: Slots ───────────────────────────── */
  .back-btn {
    background: transparent;
    border: 1.5px solid var(--border);
    border-radius: var(--r-sm);
    padding: 0.55rem 1rem;
    min-height: 44px;
    font-size: 0.9rem;
    color: var(--text-primary);
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    margin-bottom: 1.2rem;
  }
  .back-btn:hover { border-color: var(--accent); color: var(--accent); }

  .selected-plan-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: var(--accent-dim);
    border: 1.5px solid var(--accent);
    color: var(--accent);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    font-size: 0.88rem;
    font-weight: 700;
    margin-bottom: 1.4rem;
  }

  .state-block { text-align: center; padding: 3rem 1rem; color: var(--text-muted); }
  .state-block .spinner {
    width: 36px; height: 36px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .wa-link {
    display: inline-block; margin-top: 1rem;
    color: var(--whatsapp-strong); font-weight: 700; min-height: 44px; padding: 0.7rem;
  }

  /* A degraded calendar read, stated above the slots it qualifies.
     Deliberately not a colour swap: the ⚠ glyph and the words carry the
     status, so it survives a colour-blind reader and a greyscale screen. */
  .btn-retry { font: inherit; font-weight: 700; min-height: 44px; padding: 0 18px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-primary); cursor: pointer; margin: 0.4rem 0; }
  .unconfirmed-note {
    border: 1px solid var(--border);
    border-inline-start: 4px solid var(--accent);
    border-radius: 8px;
    padding: 0.9rem 1rem;
    margin-bottom: 1rem;
    text-align: start;
  }
  .unconfirmed-note strong { display: block; margin-bottom: 0.35rem; }
  .unconfirmed-note p { margin: 0; color: var(--text-muted); line-height: 1.5; }
  .unconfirmed-note .wa-link { margin-top: 0.5rem; padding-inline: 0; }

  /* day tabs */
  .day-tabs {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
    padding-bottom: 0.6rem;
    margin-bottom: 1rem;
    scrollbar-width: thin;
  }
  .day-tab {
    flex: 0 0 auto;
    border: 1.5px solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    border-radius: 999px;
    padding: 0.55rem 1rem;
    min-height: 44px;
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .day-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  .day-label {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-primary);
    /* `text-transform: uppercase` and letter-spacing were doing nothing to
       Hebrew but announcing an LTR template. */
    margin-bottom: 0.7rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
  }
  .slots-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    /* Was `direction: ltr`, which reversed the reading order of the chips
       inside a right-to-left page. */
  }
  .slot {
    flex: 0 0 auto;
    padding: 0.7rem 1.2rem;
    min-height: 44px;
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    border: 2px solid var(--accent);
    background: var(--bg-card);
    color: var(--accent);
    transition: background 0.15s, color 0.15s, transform 0.1s;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .slot:hover { background: var(--accent); color: #fff; transform: translateY(-1px); }
  .slot:active { transform: translateY(0); }

  /* ── The sheet ───────────────────────────────── */
  .sheet-overlay {
    position: fixed; inset: 0;
    background: rgba(15, 23, 42, 0.5);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .sheet {
    background: var(--bg-card);
    border-radius: var(--r-lg);
    width: 100%;
    max-width: 460px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    direction: rtl;
    text-align: right;
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
  }
  .sheet:focus { outline: none; }

  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1.3rem 1.4rem 0.9rem;
    border-bottom: 1px solid var(--border);
  }
  .sheet-head h2 { font-size: 1.2rem; color: var(--text-primary); }
  .sheet-when { font-size: 0.85rem; color: var(--accent); font-weight: 700; margin-top: 0.25rem; }
  .sheet-close {
    flex: 0 0 auto;
    width: 44px; height: 44px;
    border: none; background: transparent;
    font-size: 1.2rem; color: var(--text-muted);
    cursor: pointer; border-radius: 50%;
  }
  .sheet-close:hover { background: var(--bg-base); color: var(--text-primary); }

  .sheet-body { padding: 1.1rem 1.4rem 1.4rem; overflow-y: auto; flex: 1; }

  .pane-intro {
    font-size: 0.9rem; color: var(--text-muted);
    line-height: 1.6; margin-bottom: 1rem;
  }

  .who { border: none; margin-bottom: 0.4rem; }
  .who legend {
    font-size: 0.9rem; font-weight: 700;
    color: var(--text-primary); margin-bottom: 0.55rem; padding: 0;
  }
  .who-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .who-card {
    display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
    border: 2px solid var(--border);
    background: var(--bg-card);
    border-radius: 14px;
    padding: 0.85rem 0.5rem;
    min-height: 76px;
    font-family: inherit;
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--text-primary);
    cursor: pointer;
  }
  .who-card.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
  .who-emoji { font-size: 1.35rem; }

  .sheet-body label {
    display: block;
    font-size: 0.88rem;
    color: var(--text-primary);
    font-weight: 600;
    margin-bottom: 0.3rem;
    margin-top: 1rem;
  }
  .optional { color: var(--text-muted); font-weight: 400; }
  .fixed-subject {
    margin: 1rem 0 0; padding: 0.6rem 0.8rem; border-radius: 10px;
    background: var(--accent-dim); color: var(--accent); font-size: 0.9rem; font-weight: 700;
  }

  .sheet-body input,
  .sheet-body select,
  .sheet-body textarea {
    width: 100%;
    padding: 0.7rem 0.9rem;
    min-height: 48px;
    border: 1.5px solid var(--border-strong);
    border-radius: var(--r-sm);
    /* 1rem, not 0.95rem. Below 16px, iOS Safari zooms the whole viewport on
       focus — six fields meant six zooms and six manual pinch-outs. */
    font-size: 1rem;
    font-family: inherit;
    color: var(--text-primary);
    background: var(--bg-card);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .sheet-body textarea { resize: vertical; min-height: 80px; }
  .sheet-body input:focus,
  .sheet-body select:focus,
  .sheet-body textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-dim);
  }
  .sheet-body input[aria-invalid='true'] { border-color: var(--danger); }

  .field-hint { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.35rem; line-height: 1.5; }
  .field-error {
    font-size: 0.85rem; color: var(--danger);
    margin-top: 0.35rem; font-weight: 600;
  }
  .live:empty { display: none; }
  .submit-error {
    margin-top: 1rem;
    background: #fef2f2;
    border: 1.5px solid var(--danger);
    color: var(--danger);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.9rem;
    font-size: 0.88rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .recap {
    margin-top: 1.3rem;
    background: var(--bg-surface);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.9rem;
    font-size: 0.9rem;
  }
  .recap-row {
    display: flex; justify-content: space-between; gap: 1rem;
    padding: 0.25rem 0; color: var(--text-muted);
  }
  .recap-row b { color: var(--text-primary); }

  .sheet-foot {
    display: flex;
    gap: 0.6rem;
    padding: 0.9rem 1.4rem 0.4rem;
    border-top: 1px solid var(--border);
    background: var(--bg-card);
    border-radius: 0 0 var(--r-lg) var(--r-lg);
  }
  .btn-primary {
    flex: 1;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 12px;
    padding: 0.9rem;
    min-height: 52px;
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
    font-family: inherit;
  }
  .btn-primary:hover { background: var(--accent-soft); }
  .btn-primary:disabled { opacity: 0.55; cursor: default; }
  .btn-back {
    flex: 0 0 auto;
    background: transparent;
    color: var(--text-muted);
    border: 1.5px solid var(--border-strong);
    border-radius: 12px;
    padding: 0.9rem 1.1rem;
    min-height: 52px;
    font-size: 0.95rem;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .sheet-note {
    font-size: 0.76rem;
    color: var(--text-muted);
    /* Bottom padding moved to .sheet-legal below, which now closes the sheet. */
    padding: 0 1.4rem 0.4rem;
    line-height: 1.5;
    text-align: center;
  }
  .sheet-legal {
    font-size: 0.72rem;
    color: var(--text-faint);
    padding: 0 1.4rem 1rem;
    line-height: 1.5;
    text-align: center;
  }
  .sheet-legal a { color: var(--text-muted); text-decoration: underline; }

  /* ── Success ─────────────────────────────────── */
  #step-success { text-align: center; padding: 2rem 0 1rem; }
  .success-icon { font-size: 3.2rem; margin-bottom: 0.6rem; }
  #step-success h2 { font-size: 1.6rem; margin-bottom: 1.2rem; }
  .success-pending-note {
    max-width: 440px;
    margin: -0.6rem auto 1.4rem;
    padding: 0 0.5rem;
    color: var(--text-muted-strong);
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .handoff {
    background: var(--bg-surface);
    border: 1.5px solid var(--accent);
    border-radius: var(--r-lg);
    padding: 1.4rem 1.3rem;
    margin: 0 auto 1.4rem;
    max-width: 440px;
    text-align: right;
  }
  .handoff-title { font-size: 1.05rem; color: var(--text-primary); }
  .handoff-title strong { color: var(--accent); }
  .handoff-sub {
    font-size: 0.88rem; color: var(--text-muted-strong);
    margin-top: 0.3rem; line-height: 1.6;
  }
  .handoff-primary {
    display: block;
    margin-top: 1.1rem;
    background: var(--accent);
    color: #fff;
    border-radius: 12px;
    padding: 0.9rem;
    min-height: 52px;
    font-weight: 800;
    font-size: 1rem;
    text-align: center;
    text-decoration: none;
  }
  .handoff-primary:hover { background: var(--accent-soft); }
  .handoff-actions { display: flex; gap: 0.55rem; margin-top: 0.6rem; }
  .handoff-secondary {
    flex: 1;
    background: var(--bg-card);
    border: 1.5px solid var(--border-strong);
    border-radius: 12px;
    padding: 0.7rem 0.5rem;
    min-height: 46px;
    font-family: inherit;
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--text-primary);
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .handoff-secondary:hover { border-color: var(--accent); color: var(--accent); }
  .handoff-link {
    margin-top: 0.8rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    word-break: break-all;
    background: var(--bg-card);
    border-radius: 8px;
    padding: 0.5rem 0.6rem;
    /* Selectable by hand: some in-app browsers deny the clipboard API. */
    user-select: all;
  }
  .handoff-note { font-size: 0.83rem; color: var(--text-muted-strong); margin-top: 0.7rem; line-height: 1.6; }

  .success-detail {
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: 14px;
    padding: 1rem 1.4rem;
    margin: 0 auto 1.4rem;
    max-width: 440px;
    text-align: right;
    font-size: 0.9rem;
    color: var(--text-primary);
    line-height: 1.8;
  }
  .bk-summary { display: flex; flex-direction: column; }
  .bk-row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
    padding: 0.5rem 0; border-bottom: 1px solid var(--border);
  }
  .bk-row:last-child { border-bottom: none; }
  .bk-label { color: var(--text-muted); font-size: 0.85rem; white-space: nowrap; }
  .bk-value { font-weight: 700; text-align: left; }
  .bk-next {
    margin-top: 1.1rem; padding-top: 0.9rem; border-top: 2px solid var(--border);
    font-size: 0.86rem; line-height: 1.7;
  }
  .bk-next ul { margin: 0.4rem 0 0; padding-inline-start: 1.1rem; color: var(--text-muted); }
  .bk-next li { margin-bottom: 0.25rem; }
  .bk-contact {
    margin-top: 1rem; padding: 0.9rem 1rem;
    background: var(--accent2-dim);
    border: 1.5px solid var(--accent2-strong);
    border-radius: 14px; text-align: center;
  }
  .bk-contact-title { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem; }
  .bk-contact-phone {
    display: inline-block; font-size: 1.25rem; font-weight: 900;
    /* Not --accent2: #fa8231 on this ground measures 2.5:1. */
    color: var(--btn-text); text-decoration: none; direction: ltr;
  }
  .bk-contact-phone:hover { text-decoration: underline; }
  .bk-contact-note { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem; }

  .bk-print {
    display: block; margin: 1rem auto 0; background: none;
    border: 1.5px solid var(--border-strong); border-radius: 999px;
    padding: 0.6rem 1.2rem; min-height: 44px;
    font-family: inherit; font-size: 0.85rem; font-weight: 700;
    color: var(--text-muted); cursor: pointer;
  }
  .bk-print:hover { border-color: var(--accent); color: var(--accent); }

  .home-btn {
    display: inline-block;
    background: transparent;
    border: 1.5px solid var(--border-strong);
    color: var(--text-primary);
    border-radius: 12px;
    padding: 0.75rem 2rem;
    min-height: 48px;
    font-weight: 700;
    text-decoration: none;
    font-size: 0.95rem;
  }
  .home-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Printing should yield the summary alone — no nav, no buttons, no chrome. */
  @media print {
    :global(body) * { visibility: hidden; }
    #step-success, #step-success * { visibility: visible; }
    #step-success { position: absolute; inset: 0 auto auto 0; width: 100%; }
    .bk-print, .home-btn, .handoff-actions, .handoff-primary { display: none; }
    .success-detail, .handoff { border: none; max-width: 100%; }
  }

  @media (max-width: 600px) {
    h1 { font-size: 1.4rem; }
    .duration-grid { grid-template-columns: 1fr; }
    .dur-card { flex-direction: row; flex-wrap: wrap; text-align: right; gap: 0.1rem 0.7rem; padding: 1rem; }
    .dur-card .dur-icon { font-size: 1.4rem; }
    .dur-card .dur-desc { flex-basis: 100%; }

    /* Full-screen, not a card inside a nested scroller. */
    .sheet-overlay { padding: 0; align-items: stretch; }
    .sheet {
      max-width: none;
      max-height: none;
      height: 100dvh;
      border-radius: 0;
    }
    .sheet-foot { border-radius: 0; padding-bottom: 0.6rem; }
  }

  /* ── Returning family: pick a child instead of retyping one ── */
  .pick-grid { display: grid; gap: 0.55rem; }
  .pick-card {
    display: grid;
    grid-template-columns: 2rem 1fr;
    grid-template-areas: 'emoji name' 'emoji meta';
    align-items: center;
    gap: 0 0.7rem;
    text-align: right;
    border: 2px solid var(--border);
    background: var(--bg-card);
    border-radius: 14px;
    padding: 0.75rem 0.9rem;
    min-height: 60px;
    font-family: inherit;
    color: var(--text-primary);
    cursor: pointer;
  }
  .pick-card.active { border-color: var(--accent); background: var(--accent-dim); }
  .pick-emoji { grid-area: emoji; font-size: 1.4rem; }
  .pick-name { grid-area: name; font-weight: 800; font-size: 0.98rem; }
  .pick-meta { grid-area: meta; font-size: 0.8rem; color: var(--text-muted-strong); }
  .pick-card.pick-other { border-style: dashed; }

  .picked-recap {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.8rem; margin-top: 0.9rem;
    background: var(--bg-surface); border-radius: var(--r-sm);
    padding: 0.6rem 0.8rem; font-size: 0.88rem; color: var(--text-muted-strong);
  }

  .known-contact {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.8rem; margin-bottom: 0.4rem;
    background: var(--bg-surface); border-radius: var(--r-sm);
    padding: 0.75rem 0.9rem;
  }
  .known-lines { font-size: 0.9rem; line-height: 1.7; }

  .linkish {
    background: none; border: none; padding: 0.4rem 0.2rem;
    min-height: 44px;
    font-family: inherit; font-size: 0.85rem; font-weight: 700;
    color: var(--accent-deep); cursor: pointer; text-decoration: underline;
    flex: 0 0 auto;
  }
</style>

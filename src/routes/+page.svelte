<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import { onMount } from 'svelte';
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import AutoCarousel from '$lib/components/AutoCarousel.svelte';
  import { PLANS, formatPrice, RECOMMENDED_BADGE } from '$lib/plans.ts';
  import { initMarketing, track } from '$lib/marketing.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import { TUTORS } from '$lib/tutors.ts';

  // Warm, low-friction opener for the WhatsApp CTAs beside both /booking
  // buttons — the same "just reach out" tone as the booking page's own
  // WhatsApp fallbacks (src/routes/booking/+page.svelte's wa-link hrefs).
  const WHATSAPP_TEXT = encodeURIComponent('היי, אשמח לשמוע על שיעורים פרטיים במתמטיקה');
  const WHATSAPP_HREF = `https://wa.me/${TUTOR_PHONE}?text=${WHATSAPP_TEXT}`;


  /* "שיעור יחיד שאורכו 45 דקות, שיעור כפול שאורכו שעה וחצי ושיעור משולש
     שאורכו שעתיים ורבע" — built from PLANS so the FAQ cannot drift from the
     cards directly above it, which is exactly what happened between this
     page and the booking flow. Hebrew joins the final item with a prefixed
     ו־, so the last element is handled separately rather than by a plain
     join(', '). */
  const DURATIONS_SENTENCE = PLANS
    .map(p => `שיעור ${p.name} שאורכו ${p.duration}`)
    .reduce((acc, part, i, all) =>
      i === 0 ? part : i === all.length - 1 ? `${acc} ו${part}` : `${acc}, ${part}`, '');

  const heroFeatures = [
    {
      kind: 'slides',
      image: '/images/slides/slide-01.svg',
      eyebrow: 'למידה אישית',
      title: 'לומדים בדיוק את מה שצריך עכשיו',
      copy: 'תוכן ברור שנבנה סביב הרמה, הקצב והמטרות של כל תלמיד.'
    },
    {
      kind: 'games',
      image: '/images/games/g-errorhunt.svg',
      eyebrow: 'תרגול שמרגיש כמו משחק',
      title: 'מתרגלים, מקבלים משוב ומתקדמים',
      copy: 'משחקים קצרים שעוזרים להפוך הבנה לתרגול אמיתי.'
    },
    {
      kind: 'progress',
      image: '/images/slides/slide-04.svg',
      eyebrow: 'תמונה ברורה להורים',
      title: 'רואים התקדמות ויודעים מה הצעד הבא',
      copy: 'כל שיעור מתחבר לתכנית הלמידה ולמטרה הבאה של התלמיד.'
    }
  ];
  /* Maths only (Todoist 6hfrX4VFc3HWGF2q): the areas within it, not other
     subjects. */
  const mathAreas = [
    { icon: '🧱', label: 'יסודות וחיזוק פערים' },
    { icon: '📝', label: 'הכנה למבחנים' },
    { icon: '🔢', label: 'אלגברה' },
    { icon: '📐', label: 'גיאומטריה' },
    { icon: '📈', label: 'פונקציות' },
    { icon: '🎲', label: 'הסתברות' },
    { icon: '🎓', label: 'הכנה לבגרות' },
  ];
  const DESCRIPTION = 'שיעורים פרטיים במתמטיקה מיסודי ועד בגרות: תכנית אישית, תרגול שמרגיש כמו משחק, ופורטל שבו ההורים רואים את ההתקדמות.';
  const testimonials = [
    { lines: ['תודה רבה על ההכוונה וההסבר המעולה.', 'הציונים שלי השתפרו מאוד בזכותך :)'], name: 'זיו כהן' },
    { lines: ['שיעור מעניין ומורה מעולה!', 'בזכותו הבנתי את כל החומר.'], name: 'מיכל ניאזוב' },
    { lines: ['השיעורים תמיד ברורים ומובנים,', 'תודה רבה!'], name: 'לימור ישראל' },
    { lines: ['ניקול מסבירה בסבלנות ובצורה מאוד ברורה.', 'ממליצה בחום לכל אחד!'], name: 'נועה לוי' },
    { lines: ['ליאור מוכשר להפליא,', 'הסביר לי בדיוק מה שהייתי צריך.'], name: 'עידו ברק' },
  ];

  let backToTopEl: HTMLButtonElement;
  let popupOverlayEl: HTMLDivElement;


  onMount(() => {
    /* ── Marketing attribution ───────────────── */
    initMarketing(new URL(location.href));
    track('landing_visit');

    /* ── Back to top ─────────────────────────── */
    const onScroll = () => {
      backToTopEl.classList.toggle('visible', window.scrollY > 320);
    };
    window.addEventListener('scroll', onScroll);

    /* ── Tutor popups (mobile) ───────────────── */
    /* .tutors-showcase carries a transform from its reveal animation, which makes it
       a stacking context — so a popup nested inside it paints *below* the overlay no
       matter how high its z-index is. Moving the popup to <body> while it is open is
       what keeps it lit instead of washed out. */
    function openPopup(popup: HTMLElement & { _home?: HTMLElement | null }) {
      popup._home = popup.parentElement;
      document.body.appendChild(popup);
      popup.classList.add('active');
      popupOverlayEl.classList.add('active');
    }

    function closeAllPopups() {
      document.querySelectorAll<HTMLElement & { _home?: HTMLElement | null }>('.tutor-info').forEach((p) => {
        p.classList.remove('active');
        if (p._home) {
          p._home.appendChild(p);
          p._home = null;
        }
      });
      popupOverlayEl.classList.remove('active');
    }

    const cardListeners: Array<() => void> = [];
    document.querySelectorAll<HTMLElement>('.tutor-card').forEach((card) => {
      const handler = () => {
        if (window.innerWidth > 992) return;
        const popup =
          card.querySelector<HTMLElement>('.tutor-info') ||
          document.querySelector<HTMLElement>('.tutor-info.active');
        if (!popup) return;
        const isOpen = popup.classList.contains('active');
        closeAllPopups();
        if (!isOpen) openPopup(popup);
      };
      card.addEventListener('click', handler);
      cardListeners.push(() => card.removeEventListener('click', handler));
    });

    const closeHandlers: Array<() => void> = [];
    document.querySelectorAll<HTMLElement>('[data-close]').forEach((btn) => {
      const handler = (e: Event) => {
        e.stopPropagation();
        closeAllPopups();
      };
      btn.addEventListener('click', handler);
      closeHandlers.push(() => btn.removeEventListener('click', handler));
    });
    popupOverlayEl.addEventListener('click', closeAllPopups);

    /* ── Scroll reveal ───────────────────────── */
    const revealObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('visible');
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll('.reveal').forEach((el) => revealObs.observe(el));

    /* Safety net: sections below the fold stay at opacity 0 until scrolled to, which
       means a full-page screenshot — or a browser that never fires the observer —
       captures a blank page. After a few seconds, show everything regardless. */
    const revealTimeout = setTimeout(() => {
      document.querySelectorAll('.reveal:not(.visible)').forEach((el) => el.classList.add('visible'));
    }, 3000);

    /* ── Dashboard animations ───────────────── */
    function countUp(el: HTMLElement, target: number, suffix: string, duration: number) {
      let start = 0;
      const step = target / (duration / 16);
      const tick = () => {
        start = Math.min(start + step, target);
        el.textContent = Math.round(start) + suffix;
        if (start < target) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    function startDashboardAnim() {
      const bar = document.getElementById('dp-bar-fill');
      const statLessons = document.getElementById('dp-stat-lessons');
      const statProgress = document.getElementById('dp-stat-progress');
      if (!bar) return;

      bar.style.width = '72%';
      if (statLessons) countUp(statLessons, 3, '', 900);
      if (statProgress) countUp(statProgress, 72, '%', 1400);
    }

    const dashObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTimeout(startDashboardAnim, 300);
            dashObs.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    const dashEl = document.querySelector('.hero-dashboard-mini');
    if (dashEl) dashObs.observe(dashEl);

    /* ── FAQ accordion ───────────────────────── */
    const faqListeners: Array<() => void> = [];
    document.querySelectorAll<HTMLElement>('.faq-question').forEach((q) => {
      const handler = () => {
        const item = q.closest('.faq-item');
        const isOpen = item?.classList.contains('open');
        document.querySelectorAll('.faq-item').forEach((i) => i.classList.remove('open'));
        if (!isOpen) item?.classList.add('open');
      };
      q.addEventListener('click', handler);
      faqListeners.push(() => q.removeEventListener('click', handler));
    });

    return () => {
      window.removeEventListener('scroll', onScroll);
      cardListeners.forEach((off) => off());
      closeHandlers.forEach((off) => off());
      faqListeners.forEach((off) => off());
      revealObs.disconnect();
      dashObs.disconnect();
      clearTimeout(revealTimeout);
    };
  });
</script>

<svelte:head>
  <title>מאה בקליק — שיעורים פרטיים במתמטיקה</title>
  <meta name="description" content={DESCRIPTION} />
  <meta property="og:title" content="מאה בקליק — שיעורים פרטיים במתמטיקה" />
  <meta property="og:description" content={DESCRIPTION} />
</svelte:head>

<button class="back-to-top" bind:this={backToTopEl} aria-label="חזרה לראש" onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>

<Header />

  <section id="hero">
    <div class="hero-badge">שיעורים פרטיים במתמטיקה · מיסודי ועד בגרות</div>

    <h1 class="hero-title">כל תלמיד יכול <span class="accent">להתקדם</span> במתמטיקה</h1>

    <div class="hero-subtitle-row">
      <span class="hero-sub-a">תכנית ברורה, תרגול מדויק וליווי אישי</span>
      <span class="hero-sub-b">רואים את ההתקדמות ויודעים מה הצעד הבא</span>
    </div>

    <!-- Tutors + surrounding feature cards -->
    <div class="tutors-showcase">

      <!-- Center: Tutor photos -->
      <div class="tutors-preview">

        {#each TUTORS as tutor (tutor.id)}
          <div class="tutor-card tutor-{tutor.id}" id="tutor-{tutor.id}">
            <img src={tutor.photo} class="tutor-img" alt={tutor.alt} />
            <div class="tutor-name-badge">{tutor.name}</div>
            <div class="tutor-info" id="info-{tutor.id}">
              <div class="popup-close" data-close>×</div>
              <h3>{tutor.heading}</h3>
              <ul>
                {#each tutor.bio as line}
                  <li>{line}</li>
                {/each}
              </ul>
            </div>
          </div>
        {/each}

      </div>


      <!-- Hero feature carousel -->
      <div class="hero-feature-carousel">
        <div class="hero-feature-heading">
          <span>איך נראית הלמידה במאה בקליק?</span>
          <span class="hero-feature-count">3 דברים שעושים הבדל</span>
        </div>
        <AutoCarousel axis="x" speed={22} gap="16px" padding="8px 42px" label="איך נראית הלמידה במאה בקליק">
          {#each heroFeatures as feature (feature.kind)}
            <article class="hero-feature-card">
              <div class="hero-feature-art" class:progress-art={feature.kind === 'progress'}>
                <img src={feature.image} alt="" aria-hidden="true">
                {#if feature.kind === 'progress'}
                  <div class="hero-feature-progress"><span style="width: 72%"></span></div>
                {/if}
              </div>
              <div class="hero-feature-copy">
                <span class="hero-feature-eyebrow">{feature.eyebrow}</span>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
              </div>
            </article>
          {/each}
        </AutoCarousel>
      </div>

      <!-- Center: Dashboard static preview -->
        <div class="hero-dashboard-mini">
          <div class="hero-preview-title">פורטל הורים</div>
          <div class="dash-preview">
            <!-- Student header -->
            <div class="dp-header">
              <div class="dp-avatar">🎓</div>
              <div class="dp-info">
                <div class="dp-name">ישראל ישראלי</div>
                <div class="dp-meta">מתמטיקה · בינוני · מורה: ניקול</div>
              </div>
            </div>
            <!-- Stats row -->
            <div class="dp-stats">
              <div class="dp-stat">
                <div class="dp-stat-val" id="dp-stat-lessons">0</div>
                <div class="dp-stat-lbl">שיעורים</div>
              </div>
<div class="dp-stat">
                <div class="dp-stat-val" id="dp-stat-progress" style="color:#2563EB">0%</div>
                <div class="dp-stat-lbl">התקדמות</div>
              </div>
            </div>
            <!-- Progress bar -->
            <div class="dp-bar-wrap">
              <div class="dp-bar-fill" id="dp-bar-fill"></div>
            </div>
            <!-- Next lesson -->
            <div class="dp-next">📅 שיעור הבא: כ׳ ניסן, 17:00</div>
            <!-- Recent lessons -->
            <div class="dp-section-title">שיעורים אחרונים</div>
            <div class="dp-lesson-row">
              <span class="dp-lesson-dot teal dp-pulse"></span>
              <span class="dp-lesson-text">נגזרות — כלל השרשרת</span>
              <span class="dp-lesson-date">13.4</span>
            </div>
            <div class="dp-lesson-row">
              <span class="dp-lesson-dot coral"></span>
              <span class="dp-lesson-text">מבוא לאינטגרלים</span>
              <span class="dp-lesson-date">6.4</span>
            </div>
          </div>
          <!-- Scroll hint -->
          <div class="dp-scroll-hint">
            <span class="dp-scroll-arrow">↓</span>
          </div>
        </div><!-- /hero-dashboard-mini -->

    </div><!-- /tutors-showcase -->

  </section>

  <!-- ── FEATURES SHOWCASE ─────────────────────────────── -->
  <section id="features-showcase">
    <div class="container section-center">
      <div class="section-label">מה תקבלו</div>
      <h2 class="section-title">הלמידה שלנו נראית כך 👇</h2>

      <div class="showcase-grid">

        <!-- Slides -->
        <div class="showcase-card reveal reveal-delay-1">
          <div class="showcase-icon-wrap teal">📊</div>
          <h3>מצגות חכמות</h3>
          <p>חומר לימוד מותאם אישית — מצגות ברורות שנבנות בדיוק לפי הנושאים שהתלמיד צריך.</p>
          <div class="mini-slides">
            <div class="mini-slide"></div>
            <div class="mini-slide"></div>
            <div class="mini-slide"></div>
          </div>
        </div>

        <!-- Dashboard -->
        <div class="showcase-card reveal reveal-delay-2">
          <div class="showcase-icon-wrap coral">📈</div>
          <h3>לוח התקדמות</h3>
          <p>כל שיעור מתועד. הורים רואים בדיוק מה נלמד, מה השתפר, ומה הצעד הבא.</p>
          <div class="mini-dashboard">
            <div class="dash-bar-row">
              <span>אלגברה</span>
              <div class="dash-bar"><div class="dash-fill" style="width:82%"></div></div>
            </div>
            <div class="dash-bar-row">
              <span>גיאומטריה</span>
              <div class="dash-bar"><div class="dash-fill" style="width:65%"></div></div>
            </div>
            <div class="dash-bar-row">
              <span>הסתברות</span>
              <div class="dash-bar"><div class="dash-fill" style="width:90%"></div></div>
            </div>
          </div>
        </div>

        <!-- Games -->
        <div class="showcase-card reveal reveal-delay-3">
          <div class="showcase-icon-wrap green">🎮</div>
          <h3>משחקי לימוד</h3>
          <p>פלאשקארדים, קווינים ומשחקי ידע — כי תלמיד שנהנה לומד פי כמה יותר טוב.</p>
          <div class="mini-game-grid">
            <div class="mini-game-card">🃏 פלאשקארדים</div>
            <div class="mini-game-card">🎯 קוויז</div>
            <div class="mini-game-card">🏆 Kahoot</div>
            <div class="mini-game-card">🧩 Quizlet</div>
          </div>
        </div>

        <!-- Examples -->
        <div class="showcase-card reveal reveal-delay-1">
          <div class="showcase-icon-wrap purple">💡</div>
          <h3>דוגמאות ותרגילים</h3>
          <p>AI מזהה איפה התלמיד נתקע ומייצר תרגילים ממוקדים — בדיוק ברמה הנכונה.</p>
          <div class="mini-game-grid">
            <div class="mini-game-card">📝 דוגמה פתורה</div>
            <div class="mini-game-card">✏️ תרגיל מודרג</div>
            <div class="mini-game-card">🔁 חזרה חכמה</div>
            <div class="mini-game-card">🎓 מבחן ניסיון</div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- ── MATHS AREAS ───────────────────────────────────────── -->
  <section id="subjects">
    <div class="container section-center">
      <div class="section-label">תחומים</div>
      <h2 class="section-title">באילו תחומים במתמטיקה אנחנו עוזרים?</h2>
      <div class="subjects-carousel-outer">
        <AutoCarousel axis="x" speed={50} gap="1.4rem" padding="1rem 0" label="תחומים במתמטיקה">
          {#each mathAreas as sub (sub.label)}
            <div class="subj-card"><span class="subj-icon">{sub.icon}</span><span class="subj-label">{sub.label}</span></div>
          {/each}
        </AutoCarousel>
      </div>
    </div>
  </section>


  <!-- ── PRICING ────────────────────────────────────────── -->
  <section id="pricing">
    <div class="container section-center">
      <div class="section-label">תעריף</div>
      <h2 class="section-title">מחירים לשיעור</h2>
      <p class="section-sub">תשלום בסוף כל שיעור — ב-PayBox, בביט או במזומן</p>
      <div class="pricing-grid">

        {#each PLANS as plan, i (plan.minutes)}
          <div class="pricing-card reveal reveal-delay-{i + 1}" class:featured={plan.recommended}>
            {#if plan.recommended}<span class="pricing-badge">{RECOMMENDED_BADGE}</span>{/if}
            <div class="pricing-card-name">{plan.name}</div>
            <div class="pricing-card-price">{formatPrice(plan.shekels)}</div>
            <div class="pricing-card-duration">{plan.duration}</div>
          </div>
        {/each}

      </div>
      <div class="pricing-cta-row">
        <a
          href="/booking"
          class="book-cta pricing-cta"
          onclick={() => track('cta_click', { target: 'booking' })}
        ><Icon name="booking" size={17} /> בדקו מועד לשיעור</a>
        <a
          href={WHATSAPP_HREF}
          target="_blank"
          rel="noopener"
          class="whatsapp-cta"
          onclick={() => track('cta_click', { target: 'whatsapp' })}
        ><Icon name="message" size={17} /> וואטסאפ</a>
      </div>
    </div>
  </section>

  <!-- ── TESTIMONIALS ───────────────────────────────────── -->
  <section id="testimonials">
    <div class="container section-center">
      <div class="section-label">המלצות</div>
      <h2 class="section-title">מה הלקוחות אומרים עלינו 💬</h2>
      <div class="testimonials-carousel-outer">
        <AutoCarousel axis="x" speed={50} reverse gap="1.4rem" padding="1rem 0" label="המלצות">
          {#each testimonials as t (t.name)}
            <div class="testimonial-card">
              <div class="testimonial-quote">"</div>
              <p>{t.lines[0]}<br />{t.lines[1]}</p>
              <div class="testimonial-name">— {t.name}</div>
            </div>
          {/each}
        </AutoCarousel>
      </div>
    </div>
  </section>


  <!-- ── STICKY BOOKING BUTTON ───────────────────────────── -->
  <section id="signup-button">
    <div class="sticky-cta-row">
      <a
        href="/booking"
        class="book-cta"
        onclick={() => track('cta_click', { target: 'booking' })}
      ><Icon name="booking" size={17} /> בדקו מועד לשיעור</a>
      <a
        href={WHATSAPP_HREF}
        target="_blank"
        rel="noopener"
        class="whatsapp-cta-icon"
        aria-label="וואטסאפ"
        onclick={() => track('cta_click', { target: 'whatsapp' })}
      ><Icon name="message" size={20} /></a>
    </div>
  </section>

  <!-- ── FAQs ───────────────────────────────────────────── -->
  <section id="faqs">
    <div class="container section-center">
      <div class="section-label">שאלות</div>
      <h2 class="section-title">שאלות נפוצות</h2>

      <div class="faq-list reveal">

        <div class="faq-item open">
          <div class="faq-question">
            <span>איך מתבצע תהליך ההרשמה לשיעור?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              ניתן להירשם בקלות דרך כפתור "בדקו מועד לשיעור" באתר, או ליצור קשר ישירות דרך הוואטסאפ. נחזור אליכם בהקדם לתיאום השיעור הראשון.
            </div>
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>האם השיעורים מתקיימים פנים מול פנים או אונליין?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              אנחנו מציעים גם שיעורים פרונטליים וגם שיעורים אונליין, בהתאם להעדפת התלמיד/ה. שני הפורמטים יעילים ומותאמים לצרכים השונים.
            </div>
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>מה משך השיעור?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              קיימת אפשרות להזמין שלושה סוגים של שיעורים: {DURATIONS_SENTENCE}.
            </div>
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>איך מתבצע התשלום?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              התשלום מתבצע בסוף כל שיעור, ב-PayBox (בקישור שנשלח אליכם), בביט או במזומן.
            </div>
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>לאיזה גילאים השיעורים מתאימים?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              השיעורים מתאימים לתלמידי בית ספר יסודי, חטיבת ביניים ותיכון.
            </div>
          </div>
        </div>

        <div class="faq-item">
          <div class="faq-question">
            <span>באילו נושאים במתמטיקה אתם עוזרים?</span>
            <span class="faq-icon">+</span>
          </div>
          <div class="faq-answer">
            <div class="faq-answer-inner">
              אנחנו מלמדים מתמטיקה בלבד, מיסודי ועד בגרות: חיזוק יסודות ופערים, אלגברה, גיאומטריה, פונקציות, הסתברות, והכנה למבחנים ולבגרות.
            </div>
          </div>
        </div>


      </div>
    </div>
  </section>

<Footer />

<div id="popup-overlay" bind:this={popupOverlayEl}></div>

<style>
/* ── Typography ────────────────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: 'Heebo', sans-serif;
  font-weight: 800;
  line-height: 1.2;
  color: var(--text-primary);
}

.section-label {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent2-strong);
  background: var(--accent2-dim);
  border: 1.5px solid rgba(250, 130, 49, 0.35);
  padding: 0.28rem 0.9rem;
  border-radius: 20px;
  margin-bottom: 0.8rem;
}

.section-title {
  font-size: clamp(1.6rem, 3.5vw, 2.4rem);
  margin-bottom: 0.5rem;
  letter-spacing: -0.01em;
}

.section-sub {
  color: var(--text-muted);
  font-size: 1rem;
  margin-bottom: 2.5rem;
  max-width: 520px;
  margin-left: auto;
  margin-right: auto;
}

/* ── Layout ────────────────────────────────────────────────── */
.container { max-width: 1080px; margin: 0 auto; padding: 0 1.5rem; }
.section-center { text-align: center; }

/* ── HERO ──────────────────────────────────────────────────── */
#hero {
  padding: 4.5rem 1.5rem 5.5rem;
  text-align: center;
  position: relative;
  overflow: hidden;
}

#hero::before {
  content: '';
  position: absolute;
  top: -10%;
  left: 50%;
  transform: translateX(-50%);
  width: 80vw;
  max-width: 700px;
  height: 500px;
  background: radial-gradient(ellipse at center,
    rgba(37, 99, 235, 0.12) 0%,
    rgba(59, 130, 246, 0.06) 45%,
    transparent 70%);
  pointer-events: none;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--accent-dim);
  border: 1.5px solid var(--border-strong);
  color: var(--accent);
  font-size: 0.84rem;
  font-weight: 700;
  padding: 0.32rem 1rem;
  border-radius: 24px;
  margin-bottom: 1.5rem;
  animation: fade-up 0.6s ease both;
}

.hero-title {
  font-size: clamp(2.8rem, 6.5vw, 5.2rem);
  font-weight: 900;
  line-height: 1.08;
  margin-bottom: 0.55rem;
  letter-spacing: -0.02em;
  animation: fade-up 0.65s ease 0.1s both;
}
.hero-title .accent { color: var(--accent2-strong); }

.hero-subtitle-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  margin-bottom: 2.6rem;
  animation: fade-up 0.65s ease 0.2s both;
}
.hero-sub-a {
  font-size: clamp(1.1rem, 2.5vw, 1.7rem);
  color: var(--text-muted);
  font-weight: 400;
}
.hero-sub-b {
  font-size: clamp(1.35rem, 3vw, 2.2rem);
  font-weight: 800;
  color: var(--text-primary);
}

/* ── TUTORS SHOWCASE LAYOUT ──────────────────────────────── */
.tutors-showcase {
  display: grid;
  grid-template-columns: 160px 1fr 160px;
  grid-template-rows: auto auto;
  align-items: start;
  column-gap: 1.5rem;
  row-gap: 1rem;
  max-width: 700px;
  margin: 0 auto;
  direction: ltr;
  animation: fade-up 0.65s ease 0.4s both;
}

/* Hero Feature Card — illustration style */
.hfc {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: 0 4px 20px var(--shadow);
  direction: rtl;
  text-align: right;
  transition: transform 0.28s ease, box-shadow 0.28s ease;
}
.hfc:hover {
  transform: translateY(-5px);
  box-shadow: 0 16px 40px var(--shadow-md);
}

/* ── TUTORS ──────────────────────────────────────────────── */
.tutors-preview {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 2rem;
  grid-column: 2;
  grid-row: 1;
  position: relative;
  width: 100%;
}

.hero-mini-carousel { grid-column: 1; grid-row: 1; }
.hero-games-mini    { grid-column: 3; grid-row: 1; }

/* Row 2, spanning all three columns. This placement is NOT optional: row 1 is
   fully claimed by the three rules above plus .tutors-preview, so without it
   the dashboard auto-flows into the next free cell — row 2, column 1 — and
   renders 160px wide at the bottom LEFT (left, not right, because
   .tutors-showcase sets `direction: ltr` inside an otherwise RTL page).
   The equivalent rule existed only inside the max-width: 680px block, so the
   layout was correct on mobile and broken at every desktop width. */
.hero-dashboard-mini { grid-column: 1 / 4; grid-row: 2; }

/* Desktop size for games carousel (matches slides carousel) */
.games-carousel-outer { width: 160px; }

.tutor-card {
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  padding-bottom: 28px;
}

.tutor-card::before { display: none; }

/* Glow behind image */
.tutor-card::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -58%);
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
  pointer-events: none;
}

.tutor-img {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  object-fit: cover;
  border: 3px solid var(--bg-base);
  box-shadow: 0 4px 18px var(--shadow-md), 0 0 0 4px var(--accent-dim);
  position: relative;
  z-index: 1;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.tutor-card:hover .tutor-img {
  transform: translateY(-4px);
  box-shadow: 0 12px 30px var(--shadow-md), 0 0 0 4px var(--accent-glow);
}

.tutor-name-badge {
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: white;
  font-size: 0.7rem;
  font-weight: 800;
  padding: 0.14rem 0.65rem;
  border-radius: 12px;
  white-space: nowrap;
  z-index: 3;
  letter-spacing: 0.02em;
  box-shadow: 0 3px 10px var(--shadow-accent);
}

/* Tutor info popup */
.tutor-info {
  background: var(--bg-card)
              linear-gradient(158deg, rgba(59, 130, 246, 0.10), rgba(255, 255, 255, 0) 58%);
  border: 2px solid rgba(59, 130, 246, 0.35);
  border-radius: var(--r-lg);
  padding: 1.3rem 1.5rem;
  /* A lit card: a tight brand halo plus a soft drop, instead of a flat grey shadow */
  box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.07),
              0 18px 50px rgba(37, 99, 235, 0.22);
  z-index: 9999;
  min-width: 260px;
}
.tutor-info h3 {
  font-size: 1.05rem;
  color: var(--accent);
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}
.tutor-info ul { display: flex; flex-direction: column; gap: 0.45rem; }
.tutor-info ul li { font-size: 0.88rem; color: var(--text-muted); line-height: 1.45; }

@media (min-width: 993px) {
  .tutor-info {
    position: absolute;
    top: 50%;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease;
  }
  .tutor-nikol .tutor-info { left: 110%; transform: translateY(-50%) translateX(-6px); }
  .tutor-lior  .tutor-info { right: 110%; transform: translateY(-50%) translateX(6px); }
  .tutor-card:hover .tutor-info { opacity: 1; visibility: visible; transform: translateY(-50%) translateX(0); }
}

@media (max-width: 992px) {
  .tutor-info {
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(320px, 90vw);
    z-index: 10000;
  }
  .tutor-info:global(.active) {
    display: block;
    animation: popupPop 0.34s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes popupPop {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
}

@media (prefers-reduced-motion: reduce) {
  .tutor-info:global(.active), #popup-overlay:global(.active) { animation: none; }
}

.popup-close {
  position: absolute;
  top: 8px;
  left: 10px;
  width: 28px;
  height: 28px;
  background: var(--accent);
  color: white;
  border-radius: 50%;
  font-size: 1.15rem;
  font-weight: 700;
  line-height: 28px;
  text-align: center;
  cursor: pointer;
  display: none;
}
@media (max-width: 992px) { .popup-close { display: block; } }

#popup-overlay {
  display: none;
  position: fixed;
  inset: 0;
  /* Light slate wash — dimming to black made the whole screen look switched off */
  background: rgba(248, 250, 252, 0.62);
  z-index: 9998;
}
#popup-overlay:global(.active) { display: block; animation: popupFade 0.25s ease; }
@keyframes popupFade { from { opacity: 0; } to { opacity: 1; } }

/* ── FEATURES SHOWCASE ────────────────────────────────────── */
#features-showcase {
  padding: 5rem 1.5rem;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
}

.showcase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 1.4rem;
  margin-top: 2.5rem;
}

.showcase-card {
  background: var(--bg-base);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 1.8rem 1.6rem;
  text-align: center;
  box-shadow: 0 2px 10px var(--shadow);
  transition: all 0.28s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.8rem;
}
.showcase-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-5px);
  box-shadow: 0 12px 32px var(--shadow-md);
  background: var(--bg-card);
}

.showcase-icon-wrap {
  width: 62px;
  height: 62px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.9rem;
  margin-bottom: 0.3rem;
}
.showcase-icon-wrap.teal   { background: var(--accent-dim);  border: 1.5px solid var(--border-strong); }
.showcase-icon-wrap.coral  { background: var(--accent2-dim); border: 1.5px solid rgba(250,130,49,0.3); }
.showcase-icon-wrap.green  { background: rgba(34,197,94,0.08); border: 1.5px solid rgba(34,197,94,0.3); }
.showcase-icon-wrap.purple { background: rgba(139,92,246,0.08); border: 1.5px solid rgba(139,92,246,0.3); }

.showcase-card h3 {
  font-size: 1rem;
  font-weight: 800;
  color: var(--text-primary);
}
.showcase-card p {
  font-size: 0.88rem;
  color: var(--text-muted);
  line-height: 1.7;
}

/* Slideshow strip inside card */
.mini-slides {
  display: flex;
  gap: 5px;
  justify-content: center;
  margin-top: 0.5rem;
}
.mini-slide {
  width: 28px;
  height: 20px;
  border-radius: 5px;
  border: 1.5px solid var(--border);
}
.mini-slide:nth-child(1) { background: var(--accent-dim); }
.mini-slide:nth-child(2) { background: var(--accent2-dim); border-color: rgba(250,130,49,0.3); }
.mini-slide:nth-child(3) { background: rgba(139,92,246,0.08); border-color: rgba(139,92,246,0.25); }

/* Mini dashboard bars */
.mini-dashboard {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  margin-top: 0.4rem;
}
.dash-bar-row { display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: var(--text-muted); }
.dash-bar { height: 7px; border-radius: 4px; background: var(--accent-dim); flex: 1; overflow: hidden; }
.dash-fill { height: 100%; border-radius: 4px; background: var(--accent); }

/* Mini game cards */
.mini-game-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin-top: 0.4rem;
}
.mini-game-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 0.35rem;
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 600;
  text-align: center;
  line-height: 1.4;
}

/* ── SUBJECTS ──────────────────────────────────────────────── */
#subjects {
  padding: 2.5rem 1.5rem;
  border-top: 1px solid var(--border);
}

/* ── Subjects Horizontal Carousel ──────────────────────── */
.subjects-carousel-outer {
  width: 100%;
  max-width: 100%;
  margin-top: 1.2rem;
}

.subj-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.8rem;
  width: 160px;
  height: 160px;
  background: var(--bg-card);
  border: 2px solid var(--accent);
  border-radius: 20px;
  box-shadow: 0 4px 16px var(--shadow);
  flex-shrink: 0;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: default;
}

.subj-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 10px 28px var(--shadow-md);
}

.subj-icon { font-size: 3.2rem; line-height: 1; }

.subj-label {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  direction: rtl;
}

/* ── TESTIMONIALS ──────────────────────────────────────────── */
#testimonials {
  padding: 5rem 1.5rem;
  border-top: 1px solid var(--border);
}

.testimonials-carousel-outer {
  width: 100%;
  max-width: 100%;
  margin-top: 2rem;
}

.testimonial-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-lg);
  padding: 1.8rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  box-shadow: 0 2px 10px var(--shadow);
  transition: all 0.25s ease;
  width: 280px;
  flex-shrink: 0;
}
.testimonial-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-4px);
  box-shadow: 0 10px 28px var(--shadow-md);
}

.testimonial-quote {
  font-size: 2.5rem;
  line-height: 1;
  color: var(--accent2);
  opacity: 0.5;
}
.testimonial-card p {
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1.75;
  flex: 1;
}
.testimonial-card .testimonial-name {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--accent);
}

/* ── PRICING ───────────────────────────────────────────────── */
#pricing {
  padding: 1.5rem 1.5rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

.pricing-grid {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 1.25rem;
  max-width: 780px;
  margin: 2rem auto 0;
}

.pricing-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-xl);
  padding: 1.2rem 1.6rem;
  text-align: center;
  box-shadow: 0 2px 12px var(--shadow);
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.pricing-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 14px 36px var(--shadow-md);
}

.pricing-card.featured {
  background: var(--pricing-featured-bg);
  border: 2px solid var(--pricing-featured-border);
  box-shadow: 0 4px 24px var(--accent2-glow), 0 2px 12px var(--shadow);
  position: relative;
}
.pricing-card.featured:hover {
  transform: translateY(-6px);
  box-shadow: 0 16px 44px var(--accent2-glow), 0 8px 24px var(--shadow);
}
.pricing-badge {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent2);
  color: var(--btn-text);
  font-size: 0.72rem;
  font-weight: 800;
  padding: 0.22rem 0.9rem;
  border-radius: 20px;
  white-space: nowrap;
  letter-spacing: 0.02em;
  box-shadow: 0 3px 10px var(--accent2-glow);
}

.pricing-card-name {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.5rem;
}
.pricing-card-price {
  font-size: 3.2rem;
  font-weight: 900;
  color: var(--text-primary);
  line-height: 1;
  margin-bottom: 0.3rem;
  letter-spacing: -0.03em;
}
.pricing-card-duration {
  font-size: 0.83rem;
  color: var(--text-muted);
  margin-bottom: 0;
}

/* ── FAQ ───────────────────────────────────────────────────── */
#faqs {
  padding: 5rem 1.5rem 3rem;
  border-top: 1px solid var(--border);
  background: var(--bg-surface);
}

.faq-list {
  max-width: 720px;
  margin: 2rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.faq-item {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  box-shadow: 0 2px 8px var(--shadow);
  transition: border-color 0.2s;
}
.faq-item:global(.open) { border-color: var(--border-strong); }

.faq-question {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 1.4rem;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
  color: var(--text-primary);
  user-select: none;
  gap: 1rem;
  text-align: right;
}

.faq-icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-dim);
  border: 1.5px solid var(--border-strong);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  transition: transform 0.3s, background 0.2s;
}
.faq-item:global(.open) .faq-icon {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  transform: rotate(45deg);
}

.faq-answer {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.35s ease;
}
.faq-item:global(.open) .faq-answer { max-height: 300px; }

.faq-answer-inner {
  padding: 0 1.4rem 1.2rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.85;
  text-align: right;
}

/* ── PRICING CTA ───────────────────────────────────────────── */
.pricing-cta-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.9rem;
  margin-top: 1.8rem;
}

.pricing-cta {
  width: auto !important;
  padding: 0.85rem 2.4rem !important;
}

/* ── STICKY BOOKING BUTTON ─────────────────────────────────── */
#signup-button {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 999;
  display: flex;
  justify-content: center;
  padding: 0.75rem 1rem;
  background: linear-gradient(0deg, var(--bg-base) 65%, transparent 100%);
}

/* Two buttons where the sticky bar used to hold one. This bar is
   position:fixed and must stay ONE line at every width — a labelled
   second button here (like .whatsapp-cta in the pricing section) wrapped
   onto its own line on phones and made the fixed bar ~120px tall,
   permanently covering content. So only the primary label lives here;
   the WhatsApp action is the icon-only .whatsapp-cta-icon below, sized to
   never need to wrap (flex-wrap: nowrap, not wrap — verified in the
   browser check at 320/375/390/430/1280 that the row's own height stays
   under one line and nothing scrolls horizontally). .book-cta's own
   width:100%/max-width:380px (below) is what let it fill and centre
   itself as the sole child; inside this row it is sized to its content
   instead, same as the pricing-row's .pricing-cta variant. */
.sticky-cta-row {
  display: flex;
  flex-wrap: nowrap;
  justify-content: center;
  align-items: center;
  gap: 0.6rem;
  max-width: 100%;
}
.sticky-cta-row .book-cta {
  width: auto;
  max-width: none;
  flex: 0 1 auto;
  min-width: 0;
}

.book-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--accent2);
  color: var(--btn-text);
  font-family: 'Heebo', sans-serif;
  font-size: 1.05rem;
  font-weight: 800;
  padding: 0.82rem 2.5rem;
  border-radius: 40px;
  text-decoration: none;
  box-shadow: 0 4px 20px var(--accent2-glow), 0 2px 8px var(--shadow);
  transition: transform 0.22s ease, box-shadow 0.22s ease, opacity 0.22s ease;
  max-width: 380px;
  width: 100%;
  justify-content: center;
  letter-spacing: 0.02em;
}
.book-cta:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 28px var(--accent2-glow), 0 4px 12px var(--shadow);
  opacity: 0.92;
  color: white;
}

/* ── WHATSAPP CTA (secondary) ─────────────────────────────────
   Same shape and rhythm as .book-cta — same radius, padding, weight —
   but an outline in the peach family instead of a fill, so it reads as
   the secondary action beside the primary booking CTA without adding a
   colour outside tokens.css. --accent2-strong is the token tokens.css
   itself names for peach AS TEXT/BORDER (--accent2 alone is fills-only,
   see its comment there). */
.whatsapp-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  background: var(--bg-card);
  color: var(--accent2-strong);
  font-family: 'Heebo', sans-serif;
  font-size: 1.05rem;
  font-weight: 800;
  padding: 0.82rem 2.2rem;
  border-radius: 40px;
  border: 1.5px solid var(--accent2-strong);
  text-decoration: none;
  transition: transform 0.22s ease, background 0.22s ease, opacity 0.22s ease;
  letter-spacing: 0.02em;
}
.whatsapp-cta:hover {
  transform: translateY(-3px);
  background: var(--accent2-dim);
  opacity: 0.92;
}

/* ── WHATSAPP CTA, icon-only (sticky bar) ───────────────────────
   Same secondary styling as .whatsapp-cta (peach outline, --accent2-strong
   — see that rule's comment), but round and label-free so the fixed
   bottom bar it lives in never grows past one line. 46px with a 44px
   floor keeps it at least the standard minimum touch target. The label
   moves to aria-label since there is no visible text beside the icon. */
.whatsapp-cta-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  min-width: 44px;
  min-height: 44px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-card);
  color: var(--accent2-strong);
  border: 1.5px solid var(--accent2-strong);
  text-decoration: none;
  transition: transform 0.22s ease, background 0.22s ease, opacity 0.22s ease;
}
.whatsapp-cta-icon:hover {
  transform: translateY(-3px);
  background: var(--accent2-dim);
  opacity: 0.92;
}


/* ── BACK TO TOP ───────────────────────────────────────────── */
.back-to-top {
  position: fixed;
  bottom: 80px;
  left: 20px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  color: var(--accent);
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: all 0.3s ease;
  z-index: 998;
  box-shadow: 0 3px 12px var(--shadow-md);
}
.back-to-top:global(.visible) { opacity: 1; pointer-events: all; }
.back-to-top:hover {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
  transform: translateY(-2px);
}

/* ── SCROLL REVEAL ─────────────────────────────────────────── */
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.65s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.65s cubic-bezier(0.22, 1, 0.36, 1);
}
.reveal:global(.visible) { opacity: 1; transform: translateY(0); }
.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.22s; }
.reveal-delay-3 { transition-delay: 0.34s; }

/* ── ANIMATIONS ────────────────────────────────────────────── */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes spin-slow {
  from { transform: translate(-50%, -58%) rotate(0deg); }
  to   { transform: translate(-50%, -58%) rotate(360deg); }
}

@keyframes float-bob {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-5px); }
}
@keyframes float-bob-middle {
  0%, 100% { transform: translateY(-50%); }
  50%       { transform: translateY(calc(-50% - 5px)); }
}

/* ── Dashboard Static Preview ───────────────────────────────── */
.dash-preview {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px var(--shadow);
  display: block;
  background: #fff;
  direction: rtl;
}
.dash-preview::-webkit-scrollbar { display: none; }

/* Scroll hint overlay */
.dp-scroll-hint {
  display: none;
}

.dp-scroll-arrow {
  font-size: 0.75rem;
  color: var(--accent);
  font-weight: 700;
  animation: bounce-down 1.4s ease-in-out infinite;
}

@keyframes bounce-down {
  0%, 100% { transform: translateY(0);   opacity: 1; }
  50%       { transform: translateY(4px); opacity: 0.5; }
}

.dp-header {
  background: var(--accent);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
}

.dp-avatar {
  font-size: 1.4rem;
  background: rgba(255,255,255,0.2);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dp-name {
  font-size: 0.82rem;
  font-weight: 800;
  color: #fff;
  line-height: 1.2;
}

.dp-meta {
  font-size: 0.62rem;
  color: rgba(255,255,255,0.82);
}

.dp-stats {
  display: flex;
  padding: 6px 10px;
  gap: 6px;
  border-bottom: 1px solid var(--faint, #E2E8F0);
}

.dp-stat {
  flex: 1;
  text-align: center;
}

.dp-stat-val {
  font-size: 0.85rem;
  font-weight: 800;
  color: var(--accent);
  line-height: 1;
}

.dp-stat-lbl {
  font-size: 0.52rem;
  color: var(--text-muted, #64748B);
  margin-top: 2px;
}

.dp-bar-wrap {
  height: 5px;
  background: #E2E8F0;
  margin: 6px 10px 0;
  border-radius: 10px;
  overflow: hidden;
}

.dp-bar-fill {
  height: 100%;
  background: linear-gradient(to left, var(--accent2), var(--accent));
  border-radius: 10px;
  width: 0%;
  transition: width 1.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.dp-pulse {
  position: relative;
}
.dp-pulse::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  animation: dp-ripple 2s ease-out infinite;
}
@keyframes dp-ripple {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.8); opacity: 0; }
}

.dp-next {
  font-size: 0.58rem;
  color: var(--text-muted, #64748B);
  padding: 4px 10px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-section-title {
  font-size: 0.56rem;
  font-weight: 800;
  color: var(--accent);
  padding: 4px 10px 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dp-lesson-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px;
}

.dp-lesson-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dp-lesson-dot.teal  { background: var(--accent); }
.dp-lesson-dot.coral { background: #FA8231; }

.dp-lesson-text {
  font-size: 0.58rem;
  color: var(--text-primary, #1E293B);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dp-lesson-date {
  font-size: 0.52rem;
  color: var(--text-muted, #64748B);
  flex-shrink: 0;
}

.dp-hw-badge {
  font-size: 0.48rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 6px;
  flex-shrink: 0;
}
.dp-hw-badge.open { background: rgba(250,130,49,0.12); color: var(--accent2-strong); }
.dp-hw-badge.done { background: rgba(16,185,129,0.14); color: #047857; }

/* ── Dashboard Mini Mockup ────────────────────────────────── */
.dashboard-mockup-mini {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.15);
  border: 1px solid var(--border);
}

.mockup-chrome {
  background: #EFF6FF;
  border-bottom: 1px solid var(--border);
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mockup-url {
  flex: 1;
  text-align: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: 'Heebo', sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard-mockup-mini {
  width: 330px;
}

/* ── Side panels (carousel left, games right) ─────────────── */
/* Both panels are 160px wide (grid column) × 210px tall — identical size */
.hero-mini-carousel,
.hero-games-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* ── Games Carousel ──────────────────────────────────────── */
.games-carousel-outer {
  width: 160px;
  height: 210px;
  overflow: hidden;
  border-radius: 12px;
  position: relative;
  box-shadow: 0 8px 30px rgba(30, 41, 59, 0.15);
  border: 1px solid var(--border);
}

/* ── Slides Carousel ──────────────────────────────────────── */
/* Same dimensions as games collage: 160×210px */
.slides-carousel-outer {
  width: 160px;
  height: 210px;
  overflow: hidden;
  border-radius: 12px;
  position: relative;
}

/* ── Slide Cards ──────────────────────────────────────────── */
.sp-card {
  flex-shrink: 0;
  width: 100%;
  height: 90px;
  border-radius: 8px;
  border: 2px solid var(--border);
  box-shadow: 0 4px 18px var(--shadow-md);
  position: relative;
  overflow: hidden;
}

/* Card backgrounds */
.sp-light      { background: #FFFFFF; }
.sp-dark-photo { background: #0E1628; }
.sp-navy       { background: #1E293B; }
.sp-teal-slide { background: #2563EB; }
.sp-warm       { background: #FFF7ED; }

/* Image fills the card */
.sp-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* SVG fills the card */
.sp-svg,
.sp-svg-full {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Grid lines layer (integrals card) */
.sp-grid-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.35;
}

/* ── Text Overlay ─────────────────────────────────────────── */
.sp-text-overlay {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-text-top-right {
  top: 8px;
  right: 8px;
  align-items: flex-end;
  text-align: right;
}

/* Titles */
.sp-title-dark  { font-size: 0.62rem; font-weight: 700; color: #1E293B; line-height: 1.2; font-family: 'Heebo', sans-serif; }
.sp-title-light { font-size: 0.62rem; font-weight: 700; color: #FFFFFF; line-height: 1.2; font-family: 'Heebo', sans-serif; }
.sp-title-xl    { font-size: 0.65rem; font-weight: 800; color: #FFFFFF; line-height: 1.2; font-family: 'Heebo', sans-serif; }

/* Subtitles — hidden in mini carousel */
.sp-sub-dark,
.sp-sub-light { display: none; }

/* Badges — hidden in mini carousel */
.sp-badge,
.sp-badge-teal,
.sp-badge-bottom { display: none; }


@media (max-width: 768px) {
  .hero-title   { font-size: 2.4rem; }
  .hero-sub-b   { font-size: 1.35rem; }
  .tutors-preview { gap: 1.5rem; }
  .pricing-grid { flex-direction: column; align-items: center; max-width: 320px; margin-left: auto; margin-right: auto; }
  .pricing-card { width: 100%; }

  .showcase-grid { grid-template-columns: 1fr 1fr; }
  .container { padding: 0 1rem; }
}

@media (max-width: 480px) {
  #hero { padding: 3rem 0.5rem 4.5rem; }
  .showcase-grid { grid-template-columns: 1fr; }
  .hfc { min-width: 160px; }
}

/* ── RESPONSIVE 680px — must stay at end to override base styles ── */
@media (max-width: 680px) {
  /* Grid: slides|photos|games in row 1, dashboard centered in row 2 */
  .tutors-showcase {
    display: grid;
    grid-template-columns: 28% 1fr 28%;
    grid-template-rows: auto auto;
    column-gap: 2px;
    row-gap: 0.8rem;
    padding: 0 4px;
    box-sizing: border-box;
    direction: ltr;
    max-width: 100%;
    width: 100%;
  }

  /* Photos — center column, row 1 */
  .tutors-preview {
    grid-column: 2;
    grid-row: 1;
    justify-content: center;
    align-items: flex-end;
    gap: 1.2rem;
    min-width: 0;
  }

  /* Slides — left column, row 1 */
  .hero-mini-carousel {
    grid-column: 1;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  /* Dashboard — spans all columns, row 2, centered */
  .hero-dashboard-mini {
    grid-column: 1 / 4;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  /* Games — right column, row 1 */
  .hero-games-mini {
    grid-column: 3;
    grid-row: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    min-width: 0;
  }

  /* Slides & games carousels fill their column */
  .slides-carousel-outer,
  .games-carousel-outer {
    width: 100%;
    height: 105px;
  }

  /* Dashboard static preview */
  .dash-preview {
    width: 100%;
  }

  /* Labels below each panel */
  .hero-preview-title {
    display: block !important;
    font-size: 0.55rem;
    font-weight: 700;
    text-align: center;
    color: var(--text-muted);
    background: none !important;
    border: none !important;
    padding: 3px 2px 0;
    margin: 0;
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
    backdrop-filter: none;
  }

  .showcase-side {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
  .hfc { flex: 1; min-width: 200px; max-width: 280px; }
}

/* ── Very small phones (≤ 390px) ───────────────────────────── */
@media (max-width: 390px) {
  #hero { padding: 2rem 0.5rem 3.5rem; }
  .hero-title { font-size: 2rem; }
  .hero-sub-a { font-size: 0.95rem; }
  .hero-sub-b { font-size: 1.1rem; }
  .hero-badge { font-size: 0.75rem; padding: 0.25rem 0.7rem; }

  .tutors-showcase {
    grid-template-columns: 26% 1fr 26%;
    column-gap: 1px;
    padding: 0 2px;
  }

  .tutor-img { width: 44px; height: 44px; }
  .tutors-preview { gap: 0.8rem; }

  .slides-carousel-outer,
  .games-carousel-outer { height: 90px; }


  .pricing-grid { flex-direction: column; align-items: center; }
  .pricing-card { width: 100%; max-width: 280px; }

  .book-cta { font-size: 0.95rem; padding: 0.7rem 1.5rem; }
  .whatsapp-cta { font-size: 0.95rem; padding: 0.7rem 1.3rem; }
}

/* ── Redesigned hero feature carousel ─────────────────────── */
.hero-feature-carousel {
  grid-column: 1 / 4;
  grid-row: 3;
  width: min(100%, 680px);
  margin: 0 auto;
  direction: rtl;
  text-align: right;
}
.hero-feature-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.4rem 0 0.25rem;
  padding: 0 0.35rem;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 800;
}
.hero-feature-count {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 600;
}
.hero-feature-carousel :global(.ac) {
  height: 224px;
  direction: ltr;
}
.hero-feature-carousel :global(.ac-viewport) {
  border: 1px solid rgba(37, 99, 235, 0.16);
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(219, 234, 254, 0.46), rgba(255,255,255,0.88));
  box-shadow: 0 18px 44px rgba(30, 58, 138, 0.12);
}
.hero-feature-carousel :global(.ac-track) { align-items: stretch; }
.hero-feature-card {
  flex: 0 0 min(88%, 560px);
  min-width: 0;
  display: grid;
  grid-template-columns: 42% 1fr;
  direction: rtl;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 7px 24px rgba(15, 23, 42, 0.08);
}
.hero-feature-art {
  position: relative;
  min-height: 206px;
  overflow: hidden;
  background: #DBEAFE;
}
.hero-feature-art::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgba(30, 58, 138, 0.08), transparent 60%);
  pointer-events: none;
}
.hero-feature-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-feature-art.progress-art { background: #CCFBF1; }
.hero-feature-progress {
  position: absolute;
  right: 14%;
  left: 14%;
  bottom: 18%;
  height: 9px;
  overflow: hidden;
  border-radius: 99px;
  background: rgba(255,255,255,0.72);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
}
.hero-feature-progress span { display: block; height: 100%; border-radius: inherit; background: #0F766E; }
.hero-feature-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 1.3rem 1.45rem;
  text-align: right;
}
.hero-feature-eyebrow { color: #2563EB; font-size: 0.75rem; font-weight: 800; }
.hero-feature-copy h3 { margin: 0.5rem 0 0.35rem; color: #0F172A; font-size: clamp(1.15rem, 2.2vw, 1.55rem); line-height: 1.25; }
.hero-feature-copy p { margin: 0; color: #475569; font-size: 0.94rem; line-height: 1.65; }

@media (max-width: 680px) {
  .hero-feature-carousel { grid-column: 1 / 4; grid-row: 3; width: 100%; }
  .hero-feature-heading { margin-top: 1rem; font-size: 0.9rem; }
  .hero-feature-count { font-size: 0.68rem; }
  .hero-feature-carousel :global(.ac) { height: 194px; }
  .hero-feature-card { flex-basis: 88%; grid-template-columns: 38% 1fr; }
  .hero-feature-art { min-height: 176px; }
  .hero-feature-copy { padding: 1rem; }
  .hero-feature-copy h3 { font-size: 1.05rem; }
  .hero-feature-copy p { font-size: 0.82rem; line-height: 1.5; }
}

@media (prefers-reduced-motion: reduce) {
  .hero-feature-carousel :global(.ac-track) { scroll-behavior: auto; }
}
</style>

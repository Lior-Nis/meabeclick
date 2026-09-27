<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { TUTOR_PHONE, TUTOR_PHONE_DISPLAY } from '$lib/contact.ts';
  import { contactTutor } from '$lib/tutors.ts';
  import { track } from '$lib/marketing.ts';
  let sidebarOpen = $state(false);
  let myPageHref = $state<string | null>(null);

  function openSidebar() {
    sidebarOpen = true;
  }
  function closeSidebar() {
    sidebarOpen = false;
  }

  function scrollToSection(id: string) {
    closeSidebar();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Only a student who has already opened their personal link has a slug
  // saved. For everyone else the entry stays hidden — it would only lead
  // to "קישור לא תקין".
  $effect(() => {
    const savedSlug = localStorage.getItem('student_slug');
    if (savedSlug) myPageHref = '/portal?s=' + encodeURIComponent(savedSlug);
  });

  $effect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
  });
</script>

<div class="sidebar-overlay" class:open={sidebarOpen} onclick={closeSidebar} role="presentation"></div>

<aside class="sidebar" class:open={sidebarOpen}>
  <div class="sidebar-header">
    <span class="sidebar-title">תפריט</span>
    <button class="sidebar-close" aria-label="סגירה" onclick={closeSidebar}>×</button>
  </div>
  <nav class="sidebar-nav">
    {#if myPageHref}
      <a href={myPageHref} class="sidebar-btn" style="text-decoration:none;display:block;text-align:right;"><Icon name="my-page" size={18} /> הדף שלי</a>
    {/if}
    <button class="sidebar-btn" onclick={() => scrollToSection('subjects')}><Icon name="subjects" size={18} /> מקצועות</button>
    <button class="sidebar-btn" onclick={() => scrollToSection('features-showcase')}><Icon name="games" size={18} /> מה תקבלו</button>
    <button class="sidebar-btn" onclick={() => scrollToSection('testimonials')}><Icon name="message" size={18} /> המלצות</button>
    <button class="sidebar-btn" onclick={() => scrollToSection('pricing')}><Icon name="payments" size={18} /> תעריף</button>
    <button class="sidebar-btn" onclick={() => scrollToSection('faqs')}><Icon name="faq" size={18} /> שאלות</button>
    <!-- The two dashboards sit together at the end, below the page sections. -->
    <a href="/portal" class="sidebar-btn" style="text-decoration:none;display:block;text-align:right;"><Icon name="portal" size={18} /> פורטל הורה ותלמיד/ה</a>
    <a href="/app/dashboard" class="sidebar-btn" style="text-decoration:none;display:block;text-align:right;"><Icon name="dashboard" size={18} /> לוח בקרה מורה</a>
  </nav>
  <div class="sidebar-contact">
    <div class="sidebar-contact-title">לפרטים נוספים - {contactTutor().name}</div>
    <a
      class="sidebar-contact-phone"
      href="tel:+{TUTOR_PHONE}"
      onclick={() => track('cta_click', { target: 'phone' })}
    >{TUTOR_PHONE_DISPLAY}</a>
  </div>
</aside>

<section id="header">
  <div class="nav-inner">
    <button class="hamburger" aria-label="פתיחת תפריט" onclick={openSidebar}>
      <span></span>
      <span></span>
      <span></span>
    </button>

    <a href="#hero" class="nav-logo">
      <BrandMark height={36} href={null} label={null} />
      <span class="nav-brand">מאה בקליק</span>
    </a>

    <div class="nav-right">
      <a class="nav-cta" href="/booking"><Icon name="booking" size={18} /> הזמנת שיעור</a>
    </div>
  </div>
</section>

<style>
  /* ── NAV ───────────────────────────────────────────────────── */
  #header {
    position: sticky;
    top: 0;
    z-index: 1000;
    background: var(--nav-bg);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    border-bottom: 1px solid var(--border);
  }

  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 90px;
    padding: 0 1.5rem;
    max-width: 1080px;
    margin: 0 auto;
    position: relative;
  }

  /* Logo — absolutely centered */
  .nav-logo {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    white-space: nowrap;
  }
  .nav-logo span { color: var(--accent); }
  .nav-brand { font-size: 1.05rem; font-weight: 600; letter-spacing: 0.01em; color: var(--text-primary); }

  /* Hamburger button — right side (RTL start) */
  .hamburger {
    background: none;
    border: 1.5px solid var(--border);
    border-radius: var(--r-sm);
    width: 40px;
    height: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    cursor: pointer;
    transition: all 0.2s ease;
    flex-shrink: 0;
    z-index: 1;
  }
  .hamburger:hover {
    background: var(--accent-dim);
    border-color: var(--border-strong);
  }
  .hamburger span {
    display: block;
    width: 20px;
    height: 2px;
    background: var(--text-primary);
    border-radius: 2px;
    transition: all 0.3s ease;
  }

  /* Nav right — WhatsApp CTA */
  .nav-right {
    display: flex;
    align-items: center;
    z-index: 1;
  }

  .nav-cta {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--accent2);
    color: var(--btn-text);
    font-family: 'Heebo', sans-serif;
    font-size: 0.85rem;
    font-weight: 700;
    padding: 0.38rem 1rem;
    border-radius: 20px;
    text-decoration: none;
    box-shadow: 0 2px 10px var(--accent2-glow);
    transition: all 0.22s ease;
  }
  .nav-cta:hover {
    opacity: 0.88;
    transform: translateY(-1px);
    color: var(--btn-text);
  }

  /* ── SIDEBAR ──────────────────────────────────────────────── */
  .sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    z-index: 1500;
  }
  .sidebar-overlay.open { display: block; }

  .sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 280px;
    height: 100%;
    background: var(--bg-card);
    border-left: 1px solid var(--border);
    z-index: 1600;
    transform: translateX(100%);
    transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
    display: flex;
    flex-direction: column;
    box-shadow: -8px 0 32px var(--shadow-md);
  }
  .sidebar.open { transform: translateX(0); }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.2rem 1.4rem;
    border-bottom: 1px solid var(--border);
  }
  .sidebar-title {
    font-weight: 800;
    font-size: 1rem;
    color: var(--text-primary);
  }
  .sidebar-close {
    background: var(--accent-dim);
    border: 1.5px solid var(--border-strong);
    color: var(--accent);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    font-size: 1.1rem;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .sidebar-close:hover { background: var(--accent); color: white; }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    padding: 1.5rem 1.2rem;
    gap: 0.5rem;
    flex: 1;
  }

  .sidebar-btn {
    display: block;
    background: transparent;
    border: none;
    font-family: 'Heebo', sans-serif;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
    text-align: right;
    padding: 0.75rem 1rem;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }
  .sidebar-btn:hover {
    background: var(--accent-dim);
    color: var(--accent);
  }

  /* Replaced the WhatsApp booking button — the menu now points at the phone. */
  .sidebar-contact {
    margin: 0 1.2rem 2rem;
    padding: 0.9rem 1rem;
    text-align: center;
    background: var(--accent2-dim);
    border: 1.5px solid var(--accent2-strong);
    border-radius: 18px;
  }
  .sidebar-contact-title {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 0.25rem;
  }
  .sidebar-contact-phone {
    display: inline-block;
    font-family: 'Heebo', sans-serif;
    font-size: 1.15rem;
    font-weight: 900;
    color: var(--accent2-strong);
    text-decoration: none;
    direction: ltr;
  }
  .sidebar-contact-phone:hover { text-decoration: underline; }

  @media (max-width: 768px) {
    #header { position: sticky; }
  }

  @media (max-width: 480px) {
    .nav-cta { display: none; }
  }

  @media (max-width: 390px) {
    .nav-inner { padding: 0 0.75rem; }
  }
</style>

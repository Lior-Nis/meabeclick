import { writeFileSync } from 'node:fs';
import { C, SHELL, CTA, note, doodle, art, D, pill, badge, step } from './style2.mjs';

/* ── 5 · Personalised material ─────────────────────────────────── */
writeFileSync('v2_05_personal.html', SHELL(`
  ${D(`top:-80px;left:-70px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`top:150px;left:60px;transform:rotate(-12deg)`, doodle.star(C.peach, 1.1))}
  ${D(`top:420px;left:-20px;transform:rotate(7deg)`, doodle.scribble(C.blueSoft, .95))}
  ${D(`bottom:290px;left:60px;`, art.bulb(1.25))}
  ${D(`bottom:170px;right:50px;transform:rotate(-6deg)`, doodle.spiral(C.mint, 1))}
  ${D(`top:60px;right:40px;`, doodle.burst(C.peach, .85))}
  <div class="wrap">
    ${badge('✨ חומר מותאם אישית', C.sun, -2)}
    <h1 style="margin-top:24px;font-size:86px">אין אצלנו<br>"השיעור על<br><span class="hl">שברים</span>."</h1>
    ${note(`<div style="font-size:32px;line-height:1.6;font-weight:700">
        בהרשמה שואלים שאלה אחת:<br>
        <span style="font-family:'Secular One';font-size:40px;color:${C.blue}">מה בדיוק לא מובן?</span></div>
      <div style="font-size:28px;line-height:1.6;color:${C.muted};margin-top:14px">
        "לא מבינה איך למצוא מכנה משותף" זו נקודת פתיחה<br>
        אחרת לגמרי מ"לא מבין שברים".</div>`,
      { rot: -1.4, w: 'fit-content', pad: '32px 40px' })}
    <div style="font-family:'Secular One';font-size:34px;margin-top:28px;color:${C.blue};padding-right:6px">
      המצגת, הדוגמאות והמשחקים נבנים סביב הנקודה הזו ↩</div>
    <div class="grow"></div>${CTA(`✍️ ספרו לנו מה בדיוק לא מובן<br>ונבנה את השיעור סביב זה`)}
  </div>`));

/* ── 6 · The cost of waiting ───────────────────────────────────── */
writeFileSync('v2_06_waiting.html', SHELL(`
  ${D(`top:-90px;right:-60px;`, `<svg viewBox="0 0 420 300" style="width:420px;height:300px">
      <path d="M20,150 C0,50 140,-10 250,25 C360,60 420,25 420,25 L420,-70 L0,-70 Z" fill="${C.sun}" opacity=".9"/></svg>`)}
  ${D(`top:250px;left:40px;transform:rotate(-10deg)`, doodle.arc(C.blue, 1))}
  ${D(`bottom:330px;left:-25px;`, doodle.burst(C.peach, .95))}
  ${D(`bottom:170px;left:60px;transform:rotate(8deg)`, art.pencil(1))}
  ${D(`bottom:260px;right:40px;transform:rotate(-6deg)`, doodle.zig(C.mint, .9))}
  <div class="wrap">
    ${badge('⏳ למה דווקא עכשיו', C.coral, 1.5)}
    <h1 style="margin-top:24px;font-size:80px">"נחכה ונראה<br>איך זה הולך."</h1>
    <div style="font-size:32px;color:${C.muted};margin-top:12px;font-weight:700">
      המשפט שעולה הכי ביוקר בשנת הלימודים.</div>
    ${note(`<div style="font-size:32px;line-height:1.7;font-weight:700">
        מה שקורה כשמחכים:<br>
        📚 החומר נערם &nbsp; 📉 הפער גדל<br>
        💭 והילד מספר לעצמו שהוא "פשוט לא טוב במתמטיקה"</div>
      <div style="font-size:29px;line-height:1.55;margin-top:16px;color:${C.blue};font-weight:800">
        את הסיפור הזה הכי קשה לתקן — הרבה יותר מהחומר.</div>`,
      { rot: 1.3, w: 'fit-content', pad: '30px 38px', tapeRot: 6 })}
    <div style="font-family:'Secular One';font-size:36px;margin-top:26px;padding-right:6px">
      שבועיים עכשיו = חודשיים בהמשך.</div>
    <div class="grow"></div>${CTA(`📅 בדקו אילו שעות פנויות<br>בספטמבר`)}
  </div>`, C.paper));

/* ── 7 · What a lesson looks like ──────────────────────────────── */
writeFileSync('v2_07_howitworks.html', SHELL(`
  ${D(`bottom:-110px;left:-90px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.mintSoft}" opacity=".9"/></svg>`)}
  ${D(`top:50px;left:50px;transform:rotate(-14deg)`, doodle.zig(C.peach, .9))}
  ${D(`top:300px;left:-30px;`, doodle.spiral(C.blueSoft, 1))}
  ${D(`bottom:170px;right:-20px;transform:rotate(8deg)`, doodle.scribble(C.mint, .9))}
  ${D(`bottom:170px;right:70px;`, art.books(1.2))}
  <div class="wrap">
    ${badge('⚙️ אוטומטי, אחרי כל שיעור', C.sky, -1.5)}
    <h1 style="margin-top:16px;font-size:66px">מה הילד מקבל<br>אחרי <span class="hl">כל שיעור</span></h1>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:20px">
      ${note(step('1', 'מצגת של החומר', 'בדיוק הנושא שנלמד — לחזור עליו מתי שרוצים', C.sun),
        { rot: -1.3, w: 'fit-content', pad: '14px 24px' })}
      ${note(step('2', 'דוגמאות פתורות', 'שלב־שלב, בשפה שהוא מבין', C.sky),
        { rot: 1.5, w: 'fit-content', pad: '14px 24px', align: 'flex-end', tapeRot: 5 })}
      ${note(step('3', 'משחק תרגול', 'במקום דף עבודה שנשאר בתיק', C.mintSoft),
        { rot: -1, w: 'fit-content', pad: '14px 24px', tapeRot: -6 })}
      ${note(step('4', 'שיעורי בית', 'ואתם רואים בפורטל מה הוגש ומה לא', C.coral),
        { rot: 1.2, w: 'fit-content', pad: '14px 24px', align: 'flex-end' })}
    </div>
    <div class="grow"></div>${CTA(`👀 דוגמה למצגת ולמשחק<br>נמצאת באתר`)}
  </div>`));

/* ── 8 · Online ────────────────────────────────────────────────── */
writeFileSync('v2_08_online.html', SHELL(`
  ${D(`top:-70px;right:-70px;`, `<svg viewBox="0 0 380 380" style="width:380px;height:380px">
      <circle cx="190" cy="190" r="190" fill="${C.sky}" opacity=".9"/></svg>`)}
  ${D(`bottom:-100px;left:-80px;`, `<svg viewBox="0 0 300 300" style="width:300px;height:300px">
      <circle cx="150" cy="150" r="150" fill="${C.sun}" opacity=".9"/></svg>`)}
  ${D(`top:330px;left:40px;transform:rotate(-9deg)`, doodle.star(C.peach, 1.1))}
  ${D(`top:560px;left:90px;transform:rotate(-6deg)`, art.books(1.2))}
  ${D(`top:760px;left:30px;transform:rotate(8deg)`, doodle.scribble(C.blueSoft, .9))}
  ${D(`bottom:330px;right:30px;`, doodle.burst(C.blue, .85))}
  ${D(`bottom:170px;right:80px;transform:rotate(9deg)`, art.rocket(1.2))}
  <div class="wrap">
    ${badge('💻 גם אונליין', C.mintSoft, -2)}
    <h1 style="margin-top:24px;font-size:84px">בלי לצאת<br>מהבית.<br><span class="hl">בלי פקקים.</span></h1>
    ${note(`<div style="font-size:31px;line-height:1.7;font-weight:700">
        🖥️ לוח שיתופי — רואים את הכתב זה של זה<br>
        📱 המשחקים והמצגת נשארים בטלפון<br>
        🗺️ מכל מקום בארץ<br>
        🤝 ואפשר גם פנים אל פנים, איך שנוח לכם</div>`,
      { rot: -1.4, w: 'fit-content', pad: '30px 38px' })}
    <div class="grow"></div>${CTA(`💻 בדקו זמינות לשיעור אונליין`)}
  </div>`, C.paper));

/* ── 9 · Bagrut ────────────────────────────────────────────────── */
writeFileSync('v2_09_bagrut.html', SHELL(`
  ${D(`top:-80px;left:-60px;`, `<svg viewBox="0 0 360 360" style="width:360px;height:360px">
      <circle cx="180" cy="180" r="180" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`top:120px;left:230px;transform:rotate(12deg)`, doodle.star(C.peach, 1))}
  ${D(`bottom:360px;left:-20px;transform:rotate(-8deg)`, doodle.scribble(C.blueSoft, .95))}
  ${D(`bottom:170px;left:50px;`, art.books(1.25))}
  ${D(`top:420px;right:-15px;`, doodle.spiral(C.mint, 1))}
  <div class="wrap">
    ${badge('🎓 בגרות במתמטיקה', C.peach, -2)}
    <h1 style="margin-top:22px;font-size:76px">3, 4 או 5<br>יחידות —<br><span class="hl">מתחילים מוקדם.</span></h1>
    ${note(`<div style="font-size:31px;line-height:1.65;font-weight:700">
        רוב התלמידים מתחילים להתכונן חודשיים לפני המועד.<br>
        <span style="color:${C.blue}">מי שמתחיל בספטמבר מגיע למועד בלי לחץ —</span><br>
        כי כל נושא נסגר בזמן שלומדים אותו בכיתה.</div>`,
      { rot: 1.3, w: 'fit-content', pad: '30px 38px', tapeRot: 6 })}
    <div style="display:flex;gap:13px;margin-top:26px;padding-right:6px">
      ${pill('אלגברה', C.sun, -1.6)}${pill('גאומטריה', C.sky, 1.6)}${pill('טריגונומטריה', C.mintSoft, -1.2)}
    </div>
    <div class="grow"></div>${CTA(`🎓 בונים יחד תוכנית לבגרות`)}
  </div>`));

/* ── 10 · First lesson ─────────────────────────────────────────── */
writeFileSync('v2_10_firstlesson.html', SHELL(`
  ${D(`top:-90px;right:-50px;`, `<svg viewBox="0 0 400 280" style="width:400px;height:280px">
      <ellipse cx="200" cy="90" rx="220" ry="160" fill="${C.mintSoft}" opacity=".9"/></svg>`)}
  ${D(`top:280px;left:35px;transform:rotate(-11deg)`, doodle.arc(C.peach, 1))}
  ${D(`bottom:330px;right:-20px;`, doodle.burst(C.blue, .85))}
  ${D(`bottom:170px;left:70px;transform:rotate(-7deg)`, art.bulb(1.2))}
  ${D(`top:170px;left:60px;transform:rotate(6deg)`, doodle.zig(C.mint, .9))}
  <div class="wrap">
    ${badge('🙂 שיעור ראשון', C.sun, 1.5)}
    <h1 style="margin-top:22px;font-size:80px">לא מתחילים<br>מ<span class="hl">"פתחו ספר".</span></h1>
    <div style="display:flex;flex-direction:column;gap:16px;margin-top:26px">
      ${note(step('1', 'מבינים איפה הפער', 'שאלות קצרות, בלי מבחן ובלי לחץ', C.sky),
        { rot: -1.3, w: 'fit-content', pad: '14px 24px' })}
      ${note(step('2', 'בונים תוכנית', 'מה סוגרים קודם, ומה יכול לחכות', C.coral),
        { rot: 1.4, w: 'fit-content', pad: '14px 24px', align: 'flex-end', tapeRot: 5 })}
      ${note(step('3', 'מתחילים ללמוד', 'ובסוף — מצגת, משחק ושיעורי בית', C.mintSoft),
        { rot: -1, w: 'fit-content', pad: '14px 24px', tapeRot: -6 })}
    </div>
    <div style="font-family:'Secular One';font-size:34px;margin-top:26px;color:${C.blue};padding-right:6px">
      אחרי שיעור אחד כבר יודעים מה התוכנית ↩</div>
    <div class="grow"></div>${CTA(`🙂 קובעים שיעור ראשון —<br>בלי התחייבות להמשך`)}
  </div>`, C.paper));

/* ── 11 · Primary school ───────────────────────────────────────── */
writeFileSync('v2_11_yesodi.html', SHELL(`
  ${D(`bottom:-120px;right:-100px;`, `<svg viewBox="0 0 380 380" style="width:380px;height:380px">
      <circle cx="190" cy="190" r="190" fill="${C.sun}" opacity=".9"/></svg>`)}
  ${D(`top:-60px;left:-60px;`, `<svg viewBox="0 0 280 280" style="width:280px;height:280px">
      <circle cx="140" cy="140" r="140" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`top:230px;left:50px;transform:rotate(-12deg)`, doodle.spiral(C.peach, 1))}
  ${D(`top:430px;left:-25px;`, doodle.star(C.blue, 1))}
  ${D(`top:600px;left:120px;transform:rotate(-7deg)`, art.books(1.15))}
  ${D(`bottom:250px;left:60px;transform:rotate(8deg)`, art.pencil(1))}
  ${D(`bottom:420px;right:-15px;transform:rotate(-7deg)`, doodle.scribble(C.mint, .9))}
  <div class="wrap">
    ${badge('🎒 כיתות א׳–ו׳', C.mintSoft, -2)}
    <h1 style="margin-top:22px;font-size:80px">בגיל הזה<br>לא סוגרים פער.<br><span class="hl">מונעים אותו.</span></h1>
    ${note(`<div style="font-size:31px;line-height:1.65;font-weight:700">
        ילד שמרגיש "אני לא טוב בחשבון" בכיתה ג׳<br>
        לוקח את המשפט הזה איתו עד התיכון.</div>
      <div style="font-size:29px;line-height:1.6;margin-top:14px;color:${C.blue};font-weight:800">
        השיעורים בגיל הזה הם בעיקר משחקים —<br>וזה בדיוק מה שעובד.</div>`,
      { rot: -1.4, w: 'fit-content', pad: '30px 38px' })}
    <div class="grow"></div>${CTA(`🎮 נסו משחק יחד עם הילד<br>עוד היום`)}
  </div>`));

console.log('wrote 7 more posts');

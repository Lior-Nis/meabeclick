import { writeFileSync } from 'node:fs';
import { C, SHELL, CTA, note, doodle, art } from './style2.mjs';

const D = (css, svg) => `<div class="deco" style="${css}">${svg}</div>`;

const pill = (t, bg, rot) => `<span style="background:${bg};font-family:'Secular One';font-size:29px;
  padding:10px 24px;border:4px solid ${C.ink};border-radius:999px;
  transform:rotate(${rot}deg);display:inline-block;box-shadow:4px 5px 0 rgba(30,41,59,.18)">${t}</span>`;

const badge = (t, bg, rot, color = '#fff') => `<div style="align-self:flex-start;background:${bg};color:${color};
  font-family:'Secular One';font-size:30px;padding:12px 30px;border:4px solid ${C.ink};border-radius:999px;
  transform:rotate(${rot}deg);box-shadow:6px 6px 0 rgba(30,41,59,.2)">${t}</div>`;

/* ── 1 · Back to school ───────────────────────────────────────── */
writeFileSync('v2_01_hero.html', SHELL(`
  ${D(`top:-70px;right:-60px;`, `<svg viewBox="0 0 420 300" style="width:420px;height:300px">
      <path d="M20,140 C0,50 130,-10 240,25 C350,60 420,25 420,25 L420,-60 L0,-60 Z" fill="${C.sky}" opacity=".5"/></svg>`)}
  ${D(`top:150px;left:36px;transform:rotate(-12deg)`, doodle.spiral(C.peach, 1.1))}
  ${D(`top:44px;left:120px;`, doodle.star(C.peach, 1.2))}
  ${D(`top:300px;left:150px;transform:rotate(-6deg)`, doodle.star(C.peach, .7))}
  ${D(`top:392px;left:-26px;transform:rotate(6deg)`, doodle.scribble(C.blueSoft, 1))}
  ${D(`bottom:170px;left:36px;`, art.books(1.35))}
  ${D(`bottom:170px;right:56px;transform:rotate(10deg)`, art.rocket(1.3))}
  ${D(`bottom:300px;right:-24px;transform:rotate(-8deg)`, doodle.zig(C.mint, .9))}
  <div class="wrap">
    ${badge('🎒 עוד רגע 1 בספטמבר', C.peach, -2, C.ink)}
    <h1 style="margin-top:26px;font-size:92px">שנה חדשה.<br><span class="hl">בלי הפתעות</span><br>בתעודה.</h1>
    ${note(`<div style="font-size:35px;line-height:1.55;font-weight:700">
        רוב ההורים מתקשרים אלינו בנובמבר —<br>אחרי הציון הראשון.<br>
        <span style="color:${C.blue}">אפשר גם להתחיל את השנה עם יתרון.</span></div>`,
      { rot: -1.5, w: 'fit-content', pad: '36px 44px' })}
    <div style="display:flex;gap:14px;margin-top:34px;padding-right:6px">
      ${pill('מתמטיקה', C.sun, -2)}${pill('פיזיקה', C.sky, 1.6)}${pill('עברית', C.mintSoft, -1.2)}
    </div>
    <div class="grow"></div>${CTA(`לוח הזמנים לספטמבר —<br>ותוכלו לתפוס שעה עכשיו`)}
  </div>`));

/* ── 2 · Games ────────────────────────────────────────────────── */
const gameCard = (icon, title, sub, bg, o) => note(
  `<div style="display:flex;gap:22px;align-items:center">
     <div style="width:86px;height:86px;flex:0 0 86px;border-radius:50%;background:${bg};
          border:4px solid ${C.ink};display:flex;align-items:center;justify-content:center;font-size:44px">${icon}</div>
     <div><div style="font-family:'Secular One';font-size:40px">${title}</div>
     <div style="font-size:27px;color:${C.muted};margin-top:2px">${sub}</div></div>
   </div>`, { pad: '22px 30px', ...o });

writeFileSync('v2_02_games.html', SHELL(`
  ${D(`top:-70px;left:-70px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.lilac}" opacity=".85"/></svg>`)}
  ${D(`top:44px;right:34px;transform:rotate(14deg)`, doodle.zig(C.blue, .9))}
  ${D(`top:400px;left:20px;transform:rotate(-9deg)`, doodle.star(C.peach, 1))}
  ${D(`top:590px;right:24px;`, doodle.burst(C.peach, .85))}
  ${D(`bottom:170px;left:34px;transform:rotate(4deg)`, doodle.spiral(C.mint, 1.1))}
  ${D(`bottom:170px;left:200px;transform:rotate(-8deg)`, art.pencil(.95))}
  <div class="wrap">
    <h1 style="font-size:84px">שיעורי בית 🎮<br>ש<span class="hl">באמת</span> עושים</h1>
    <div style="display:flex;flex-direction:column;gap:20px;margin-top:30px">
      ${gameCard('🔍', 'ציד טעויות', 'הילד מתקן את המורה — ולומד פי שניים', C.sun,
        { rot: -1.4, w: 'fit-content', align: 'flex-start' })}
      ${gameCard('⚡', 'קרב מהירות', '60 שניות. שיא אישי. ושוב, ושוב…', C.sky,
        { rot: 1.6, w: 'fit-content', align: 'flex-end', tapeRot: 5 })}
      ${gameCard('🕵️', 'שתי אמיתות ושקר', 'מגלה בדיוק איפה ההבנה נשברת', C.mintSoft,
        { rot: -1, w: 'fit-content', align: 'flex-start', tapeRot: -6 })}
    </div>
    <div style="font-family:'Secular One';font-size:34px;margin-top:30px;color:${C.blue}">
      ואנחנו רואים בדיוק על מה הם טעו ↩</div>
    <div class="grow"></div>${CTA(`🎮 נסו משחק אמיתי —<br>בלי הרשמה ובלי תשלום`)}
  </div>`, C.paper));

/* ── 3 · Parents ──────────────────────────────────────────────── */
writeFileSync('v2_03_parents.html', SHELL(`
  ${D(`top:-90px;right:-50px;`, `<svg viewBox="0 0 400 280" style="width:400px;height:280px">
      <ellipse cx="200" cy="90" rx="220" ry="160" fill="${C.sun}" opacity=".85"/></svg>`)}
  ${D(`top:250px;left:26px;transform:rotate(-10deg)`, doodle.arc(C.blue, 1))}
  ${D(`top:120px;left:150px;`, doodle.star(C.peach, .8))}
  ${D(`bottom:250px;left:120px;transform:rotate(-8deg)`, art.bulb(1.3))}
  ${D(`bottom:-90px;left:-90px;`, `<svg viewBox="0 0 320 320" style="width:320px;height:320px">
      <circle cx="160" cy="160" r="160" fill="${C.mintSoft}" opacity=".85"/></svg>`)}
  ${D(`bottom:400px;left:-30px;transform:rotate(8deg)`, doodle.burst(C.peach, .95))}
  ${D(`bottom:170px;right:60px;transform:rotate(-6deg)`, doodle.scribble(C.mint, .9))}
  <div class="wrap">
    ${badge('👀 פורטל הורים', C.blue, 1.5)}
    <h1 style="margin-top:24px;font-size:92px">"מה היה<br>בשיעור?"<br><span class="hl">"בסדר."</span> 🙄</h1>
    ${note(`<div style="font-size:33px;line-height:1.8;font-weight:700">
        ✅ מה נלמד בכל שיעור<br>
        ✅ מה ניתן בשיעורי בית — ומה הוגש<br>
        ✅ באילו נושאים הילד טועה <span style="color:${C.blue}">שוב ושוב</span><br>
        ✅ מתי השיעור הבא</div>`,
      { rot: 1.2, tapeRot: 6, w: 'fit-content', pad: '34px 42px' })}
    <div style="font-family:'Secular One';font-size:40px;margin-top:32px">
      בלי לשאול. <span class="hl">בלי לנחש.</span></div>
    <div class="grow"></div>${CTA(`👀 הצצה לפורטל ההורים<br>לפני שנרשמים`)}
  </div>`));

/* ── 4 · CTA ──────────────────────────────────────────────────── */
writeFileSync('v2_04_cta.html', SHELL(`
  ${D(`top:-60px;left:-80px;`, `<svg viewBox="0 0 360 360" style="width:360px;height:360px">
      <circle cx="180" cy="180" r="180" fill="${C.mintSoft}" opacity=".85"/></svg>`)}
  ${D(`bottom:-150px;right:-150px;`, `<svg viewBox="0 0 380 380" style="width:380px;height:380px">
      <circle cx="190" cy="190" r="190" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`top:150px;left:70px;`, doodle.star(C.peach, 1.2))}
  ${D(`top:60px;left:250px;transform:rotate(-14deg)`, doodle.zig(C.blueSoft, .85))}
  ${D(`top:470px;right:-10px;transform:rotate(9deg)`, doodle.scribble(C.peach, .9))}
  ${D(`bottom:170px;left:80px;transform:rotate(10deg)`, art.pencil(1))}
  ${D(`bottom:170px;right:70px;transform:rotate(-5deg)`, art.books(1.15))}
  <div class="wrap">
    ${badge('✏️ נשארו מקומות', C.peach, -2, C.ink)}
    <h1 style="margin-top:24px;font-size:94px">תופסים מקום<br>ל<span class="hl">ספטמבר</span></h1>
    <div style="display:flex;flex-wrap:wrap;gap:13px;margin-top:26px;max-width:88%">
      ${['מתמטיקה','פיזיקה','עברית','כיתות א׳–י״ב','אונליין או פנים אל פנים']
        .map((t,i)=>pill(t, [C.sun,C.sky,C.mintSoft,C.mint,C.lilac][i], i%2?1.6:-1.6)).join('')}
    </div>
    ${note(`<div style="font-family:'Secular One';font-size:44px">שתי דקות. וזהו.</div>
       <div style="font-size:30px;line-height:1.6;margin-top:12px;color:${C.muted}">
       בוחרים שעה שנוחה לכם, ממלאים פרטים,<br>ומקבלים אישור מיד —
       <span style="color:${C.blue};font-weight:800">בלי טלפונים חוזרים.</span></div>`,
      { rot: -1.4, w: 'fit-content', pad: '32px 40px', align: 'flex-end' })}
    <div class="grow"></div>${CTA(`⏱️ הזמנת שיעור בשתי דקות`)}
  </div>`, C.cream));

console.log('wrote 4 posts');

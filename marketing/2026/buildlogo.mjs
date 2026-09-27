import { writeFileSync } from 'node:fs';
import { C, SHELL, doodle, art, D } from './style2.mjs';

/* The mark, drawn at any size. Same geometry as images/logos/logo-slate.svg. */
const MARK = (px, ink = C.blue, cursor = C.peach, cursorEdge = C.paper) => `
<svg viewBox="6 14 80 60" style="width:${px}px;height:${px*0.75}px">
  <g fill="none" stroke="${ink}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14,30 L14,64"/><path d="M76,30 L76,64"/>
    <path d="M14,30 Q30,25 45,33"/><path d="M76,30 Q60,25 45,33"/>
    <path d="M14,64 Q30,58 45,67"/><path d="M76,64 Q60,58 45,67"/>
    <circle cx="45" cy="40" r="15"/>
  </g>
  <polygon points="44,32 44,56 50,50 54,60 60,57 56,47 64,47"
           fill="${cursor}" stroke="${cursorEdge}" stroke-width="2" stroke-linejoin="round"/>
  <g stroke="${cursor}" stroke-width="3" stroke-linecap="round">
    <line x1="64" y1="20" x2="60" y2="27"/>
    <line x1="73" y1="24" x2="66" y2="29"/>
    <line x1="77" y1="33" x2="70" y2="35"/>
  </g></svg>`;

const CENTER = `
  .stage{position:relative;height:100%;display:flex;flex-direction:column;
         align-items:center;justify-content:center;z-index:2;text-align:center}
  .word{font-family:'Secular One',sans-serif;font-size:104px;line-height:1;margin-top:26px}
  .tag{font-family:'Heebo',sans-serif;font-weight:700;font-size:34px;color:${C.muted};margin-top:20px}
  .rule{width:180px;height:6px;background:${C.peach};border-radius:999px;margin-top:28px}
`;

/* ── 1 · Feed post: mark + wordmark + what she teaches ── */
writeFileSync('logo_post.html', SHELL(`
  ${D(`top:-70px;right:-70px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`bottom:-90px;left:-80px;`, `<svg viewBox="0 0 320 320" style="width:320px;height:320px">
      <circle cx="160" cy="160" r="160" fill="${C.sun}" opacity=".9"/></svg>`)}
  ${D(`top:140px;left:90px;transform:rotate(-12deg)`, doodle.star(C.peach, 1.1))}
  ${D(`top:300px;right:70px;`, doodle.burst(C.blueSoft, .85))}
  ${D(`bottom:250px;right:110px;transform:rotate(8deg)`, doodle.spiral(C.mint, 1))}
  ${D(`bottom:180px;left:120px;transform:rotate(-6deg)`, doodle.scribble(C.peach, .9))}
  <div class="stage">
    ${MARK(360)}
    <div class="word">מאה בקליק</div>
    <div class="rule"></div>
    <div class="tag">שיעורים פרטיים · מתמטיקה · פיזיקה · עברית</div>
    <div class="tag" style="margin-top:8px;color:${C.blue}">כיתות א׳–י״ב · אונליין או פנים אל פנים</div>
  </div>`, C.cream, CENTER));

/* ── 2 · Profile picture: mark only, reads at 40px ── */
writeFileSync('logo_avatar.html', SHELL(`
  ${D(`top:-120px;right:-120px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`bottom:-130px;left:-130px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.sun}" opacity=".9"/></svg>`)}
  <div class="stage">${MARK(760)}</div>`, C.paper, CENTER));

/* ── 3 · Dark variant, for a story or a light background ── */
writeFileSync('logo_dark.html', SHELL(`
  ${D(`top:-80px;left:-60px;`, `<svg viewBox="0 0 300 300" style="width:300px;height:300px">
      <circle cx="150" cy="150" r="150" fill="${C.blue}" opacity=".38"/></svg>`)}
  ${D(`bottom:-70px;right:-70px;`, `<svg viewBox="0 0 300 300" style="width:300px;height:300px">
      <circle cx="150" cy="150" r="150" fill="${C.blueSoft}" opacity=".18"/></svg>`)}
  ${D(`top:200px;right:110px;transform:rotate(-10deg)`, doodle.star(C.peach, 1))}
  ${D(`bottom:150px;left:130px;`, doodle.spiral(C.sky, 1))}
  <div class="stage">
    ${MARK(360, C.sky, C.peach, C.ink)}
    <div class="word" style="color:${C.paper}">מאה בקליק</div>
    <div class="rule"></div>
    <div class="tag" style="color:#9FB3D1">שיעורים פרטיים · מתמטיקה · פיזיקה · עברית</div>
  </div>`, C.ink, CENTER));

console.log('wrote 3 logo files');

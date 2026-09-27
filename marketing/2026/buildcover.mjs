import { writeFileSync } from 'node:fs';
import { C, FONTS, doodle, art, D } from './style2.mjs';

const MARK = (px) => `
<svg viewBox="6 14 80 60" style="width:${px}px;height:${px*0.75}px">
  <g fill="none" stroke="${C.blue}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14,30 L14,64"/><path d="M76,30 L76,64"/>
    <path d="M14,30 Q30,25 45,33"/><path d="M76,30 Q60,25 45,33"/>
    <path d="M14,64 Q30,58 45,67"/><path d="M76,64 Q60,58 45,67"/>
    <circle cx="45" cy="40" r="15"/></g>
  <polygon points="44,32 44,56 50,50 54,60 60,57 56,47 64,47"
           fill="${C.peach}" stroke="${C.paper}" stroke-width="2" stroke-linejoin="round"/>
  <g stroke="${C.peach}" stroke-width="3" stroke-linecap="round">
    <line x1="64" y1="20" x2="60" y2="27"/><line x1="73" y1="24" x2="66" y2="29"/>
    <line x1="77" y1="33" x2="70" y2="35"/></g></svg>`;

/* 1640×624 is Facebook's cover size. Mobile crops the sides hard, so
   everything that matters lives in the middle ~1000px. */
const COVER = (w, h, body, bg = C.cream) => `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8">${FONTS}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:${w}px;height:${h}px;direction:rtl;font-family:'Heebo',sans-serif;
       background:${bg};color:${C.ink};overflow:hidden;position:relative}
  .deco{position:absolute;pointer-events:none}
  .safe{position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:center;z-index:2;text-align:center}
  .word{font-family:'Secular One',sans-serif;font-size:76px;line-height:1;margin-top:14px}
  .tag{font-weight:700;font-size:27px;color:${C.muted};margin-top:14px}
  .pills{display:flex;gap:11px;margin-top:18px}
  .pill{font-family:'Secular One',sans-serif;font-size:23px;padding:8px 20px;
        border:3px solid ${C.ink};border-radius:999px;box-shadow:3px 4px 0 rgba(30,41,59,.18)}
</style></head><body>${body}</body></html>`;

writeFileSync('cover_facebook.html', COVER(1640, 624, `
  ${D(`top:-160px;right:-120px;`, `<svg viewBox="0 0 400 400" style="width:400px;height:400px">
      <circle cx="200" cy="200" r="200" fill="${C.lilac}" opacity=".9"/></svg>`)}
  ${D(`bottom:-190px;left:-140px;`, `<svg viewBox="0 0 420 420" style="width:420px;height:420px">
      <circle cx="210" cy="210" r="210" fill="${C.sun}" opacity=".9"/></svg>`)}
  ${D(`top:70px;right:330px;transform:rotate(-12deg)`, doodle.star(C.peach, .95))}
  ${D(`bottom:60px;right:190px;`, doodle.spiral(C.mint, .85))}
  ${D(`top:90px;left:300px;transform:rotate(9deg)`, doodle.zig(C.blueSoft, .8))}
  ${D(`bottom:50px;left:230px;transform:rotate(-6deg)`, doodle.scribble(C.peach, .8))}
  ${D(`top:150px;left:90px;transform:rotate(-8deg)`, art.books(1))}
  ${D(`top:140px;right:90px;transform:rotate(8deg)`, art.pencil(.85))}
  <div class="safe">
    ${MARK(190)}
    <div class="word">מאה בקליק</div>
    <div class="tag">שיעורים פרטיים · כיתות א׳–י״ב · אונליין או פנים אל פנים</div>
    <div class="pills">
      <span class="pill" style="background:${C.sun}">מתמטיקה</span>
      <span class="pill" style="background:${C.sky}">פיזיקה</span>
      <span class="pill" style="background:${C.mintSoft}">עברית</span>
    </div>
  </div>`));

console.log('wrote cover_facebook.html');

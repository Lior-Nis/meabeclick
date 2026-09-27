/**
 * Playful post style — layered paper, doodles, bold colour blocking.
 *
 * The first set was clean and minimal, which reads as forgettable in a feed.
 * This one is built to stop a thumb: saturated background, hand-drawn marks,
 * cards tilted and taped down, display type big enough to read at a glance.
 */

/* Site palette (styles.css tokens) — blue brand, peach CTA, mint accent on slate.
   Tints exist so the doodles and fills can be playful without inventing new hues. */
export const C = {
  cream:  '#F8FAFC',   // --bg-base
  paper:  '#FFFFFF',   // --bg-card
  ink:    '#1E293B',   // --text-primary
  blue:   '#2563EB',   // --accent
  blueSoft: '#3B82F6', // --accent-soft
  sky:    '#93C5FD',   // blue tint, for fills
  lilac:  '#BFDBFE',   // lighter blue tint (was a violet — off-brand)
  peach:  '#FA8231',   // --accent2
  peachDeep: '#EA580C',// darker peach, the only orange that holds up as text
  coral:  '#FDBA74',   // peach tint, for fills
  sun:    '#FED7AA',   // highlight bars + tape
  mint:   '#10B981',   // --accent3
  mintSoft: '#A7F3D0',
  muted:  '#64748B',   // --text-muted
};

export const FONTS = `
<link href="https://fonts.googleapis.com/css2?family=Secular+One&family=Heebo:wght@400;700;800;900&display=swap" rel="stylesheet">`;

/* ── Hand-drawn marks. Deliberately irregular — perfect curves look printed. ── */
export const doodle = {
  spiral: (c, s = 1) => `<svg viewBox="0 0 100 100" style="width:${100*s}px;height:${100*s}px">
    <path d="M50,50 C50,42 58,40 62,46 C68,55 58,66 46,64 C30,61 24,44 34,30 C46,13 72,12 85,28"
      fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/></svg>`,
  star: (c, s = 1) => `<svg viewBox="0 0 60 60" style="width:${60*s}px;height:${60*s}px">
    <path d="M30,6 L36,24 L55,25 L40,36 L46,54 L30,43 L14,54 L20,36 L5,25 L24,24 Z"
      fill="none" stroke="${c}" stroke-width="4.5" stroke-linejoin="round"/></svg>`,
  zig: (c, s = 1) => `<svg viewBox="0 0 120 40" style="width:${120*s}px;height:${40*s}px">
    <path d="M6,28 L26,10 L46,30 L66,9 L86,29 L106,11" fill="none" stroke="${c}"
      stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arc: (c, s = 1) => `<svg viewBox="0 0 120 60" style="width:${120*s}px;height:${60*s}px">
    <path d="M8,50 C30,8 90,8 112,46" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/>
    <path d="M100,30 L112,46 L94,50" fill="none" stroke="${c}" stroke-width="7"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  burst: (c, s = 1) => `<svg viewBox="0 0 80 80" style="width:${80*s}px;height:${80*s}px">
    ${[0,45,90,135,180,225,270,315].map(a =>
      `<line x1="40" y1="40" x2="${40+30*Math.cos(a*Math.PI/180)}" y2="${40+30*Math.sin(a*Math.PI/180)}"
        stroke="${c}" stroke-width="6" stroke-linecap="round" opacity=".9"/>`).join('')}</svg>`,
  scribble: (c, s = 1) => `<svg viewBox="0 0 160 50" style="width:${160*s}px;height:${50*s}px">
    <path d="M8,34 C34,10 44,44 68,22 C90,2 100,42 124,24 C140,12 148,30 154,26"
      fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/></svg>`,
};

/* ── Drawn objects, so nothing depends on stock art ── */
export const art = {
  books: (s = 1) => `<svg viewBox="0 0 120 90" style="width:${120*s}px;height:${90*s}px">
    <rect x="14" y="60" width="94" height="18" rx="4" fill="${C.peach}" stroke="${C.ink}" stroke-width="4"/>
    <rect x="20" y="42" width="82" height="18" rx="4" fill="${C.sun}" stroke="${C.ink}" stroke-width="4"/>
    <rect x="26" y="24" width="70" height="18" rx="4" fill="${C.sky}" stroke="${C.ink}" stroke-width="4"/>
    <line x1="34" y1="24" x2="34" y2="42" stroke="${C.ink}" stroke-width="3"/>
    <line x1="30" y1="42" x2="30" y2="60" stroke="${C.ink}" stroke-width="3"/></svg>`,
  pencil: (s = 1) => `<svg viewBox="0 0 40 130" style="width:${40*s}px;height:${130*s}px">
    <rect x="10" y="22" width="20" height="82" fill="${C.coral}" stroke="${C.ink}" stroke-width="4"/>
    <path d="M10,22 L20,4 L30,22 Z" fill="${C.cream}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M15,12 L20,4 L25,12 Z" fill="${C.ink}"/>
    <rect x="10" y="104" width="20" height="18" rx="3" fill="${C.peach}" stroke="${C.ink}" stroke-width="4"/></svg>`,
  bulb: (s = 1) => `<svg viewBox="0 0 90 110" style="width:${90*s}px;height:${110*s}px">
    <circle cx="45" cy="42" r="30" fill="${C.sun}" stroke="${C.ink}" stroke-width="4.5"/>
    <rect x="33" y="70" width="24" height="10" rx="3" fill="${C.cream}" stroke="${C.ink}" stroke-width="4"/>
    <rect x="35" y="82" width="20" height="9" rx="3" fill="${C.cream}" stroke="${C.ink}" stroke-width="4"/>
    <path d="M38,42 L45,30 L45,48 L52,36" fill="none" stroke="${C.ink}" stroke-width="4"
      stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  rocket: (s = 1) => `<svg viewBox="0 0 80 120" style="width:${80*s}px;height:${120*s}px">
    <path d="M40,8 C58,30 62,58 58,80 L22,80 C18,58 22,30 40,8 Z" fill="${C.paper}"
      stroke="${C.ink}" stroke-width="4.5" stroke-linejoin="round"/>
    <circle cx="40" cy="44" r="11" fill="${C.sky}" stroke="${C.ink}" stroke-width="4"/>
    <path d="M22,64 L8,88 L24,80 Z" fill="${C.peach}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M58,64 L72,88 L56,80 Z" fill="${C.peach}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M32,80 C34,96 46,96 48,80 Z" fill="${C.sun}" stroke="${C.ink}" stroke-width="4" stroke-linejoin="round"/></svg>`,
};

/* Tape strip for the paper cards */
const tape = (rot) => `<div style="position:absolute;top:-16px;left:50%;transform:translateX(-50%) rotate(${rot}deg);
  width:110px;height:34px;background:rgba(250,130,49,.30);border:2px solid rgba(30,41,59,.16)"></div>`;

/** A tilted paper card with tape, the visual signature of this set. */
export const note = (inner, { rot = -1.5, pad = '42px 46px', bg = C.paper, tapeRot = -4,
                              w = '100%', align = 'flex-start' } = {}) => `
  <div style="position:relative;transform:rotate(${rot}deg);background:${bg};padding:${pad};
       width:${w};align-self:${align};
       border:5px solid ${C.ink};border-radius:10px;box-shadow:10px 12px 0 rgba(30,41,59,.16)">
    ${tape(tapeRot)}${inner}</div>`;

export const SHELL = (body, bg = C.cream, extraCss = '') => `<!DOCTYPE html>
<html lang="he" dir="rtl"><head><meta charset="UTF-8">${FONTS}
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1080px;height:1080px;direction:rtl;font-family:'Heebo',sans-serif;
       background:${bg};color:${C.ink};overflow:hidden;position:relative}
  .deco{position:absolute;pointer-events:none}
  .wrap{position:relative;height:100%;padding:56px 64px;display:flex;flex-direction:column;z-index:2}
  h1{font-family:'Secular One',sans-serif;font-size:96px;line-height:1.04;letter-spacing:-.01em}
  h1 .hl{position:relative;display:inline-block;z-index:1}
  h1 .hl::after{content:'';position:absolute;left:-6px;right:-6px;bottom:6px;height:24px;
       background:${C.coral};z-index:-1;border-radius:4px;transform:rotate(-1deg)}
  .grow{flex:1}
  .foot{display:flex;align-items:center;justify-content:space-between;z-index:3}
  .brand{display:flex;align-items:center;gap:12px;font-family:'Secular One',sans-serif;
       font-size:34px;color:${C.ink}}
  .phone{font-family:'Secular One',sans-serif;font-size:38px;color:${C.ink};direction:ltr;
       background:${C.peach};padding:10px 26px;border:4px solid ${C.ink};border-radius:999px;
       box-shadow:6px 6px 0 rgba(30,41,59,.2)}
  .tap{font-family:'Secular One',sans-serif;font-size:31px;color:${C.ink};
       background:${C.peach};padding:12px 28px;border:4px solid ${C.ink};border-radius:999px;
       box-shadow:6px 6px 0 rgba(30,41,59,.2)}
  ${extraCss}
</style></head><body>${body}</body></html>`;

export const LOGO = `<svg width="52" height="39" viewBox="6 14 80 60" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="${C.blue}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14,30 L14,64"/><path d="M76,30 L76,64"/><path d="M14,30 Q30,25 45,33"/>
    <path d="M76,30 Q60,25 45,33"/><path d="M14,64 Q30,58 45,67"/><path d="M76,64 Q60,58 45,67"/>
    <circle cx="45" cy="40" r="15"/></g>
  <polygon points="44,32 44,56 50,50 54,60 60,57 56,47 64,47" fill="${C.peach}"/></svg>`;

export const FOOT = `<div class="foot"><div class="brand">${LOGO} מאה בקליק</div>
  <div class="phone">054-696-9891</div></div>`;

/* ── Shared bits the post builders reuse ── */
export const D = (css, svg) => `<div class="deco" style="${css}">${svg}</div>`;

export const pill = (t, bg, rot = 0) => `<span style="background:${bg};font-family:'Secular One';
  font-size:29px;padding:10px 24px;border:4px solid ${C.ink};border-radius:999px;
  transform:rotate(${rot}deg);display:inline-block;box-shadow:4px 5px 0 rgba(30,41,59,.18)">${t}</span>`;

export const badge = (t, bg, rot = 0, color = C.ink) => `<div style="align-self:flex-start;
  background:${bg};color:${color};font-family:'Secular One';font-size:30px;padding:12px 30px;
  border:4px solid ${C.ink};border-radius:999px;transform:rotate(${rot}deg);
  box-shadow:6px 6px 0 rgba(30,41,59,.2)">${t}</div>`;

/** Numbered step row — used by the "how a lesson works" posts. */
export const step = (n, title, sub, bg) => `<div style="display:flex;gap:20px;align-items:center">
  <div style="width:72px;height:72px;flex:0 0 72px;border-radius:50%;background:${bg};
       border:4px solid ${C.ink};display:flex;align-items:center;justify-content:center;
       font-family:'Secular One';font-size:36px">${n}</div>
  <div><div style="font-family:'Secular One';font-size:36px">${title}</div>
  <div style="font-size:26px;color:${C.muted};margin-top:2px">${sub}</div></div></div>`;

/* ── Click driver ─────────────────────────────────────────────────
   A post can only earn a click if it names a reason and a destination.
   One bar: why to go, and where. The arrow points at the URL. */
export const SITE = 'meabeclick.com';

/** Bottom block: brand on one side, one line telling people to tap the link. */
export const CTA = () => `
  <div class="foot"><div class="brand">${LOGO} מאה בקליק</div>
    <div class="tap">לפרטים נוספים — לחצו על הקישור 👆</div></div>`;

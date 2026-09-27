import { writeFileSync } from 'node:fs';
import { C, SHELL, CTA, note, doodle, art } from './style2.mjs';

const D = (css, svg, id = '') => `<div class="deco" id="${id}" style="${css}">${svg}</div>`;

/* Shared motion CSS: everything animates by toggling .on, so the renderer can
   step frames deterministically instead of racing CSS timelines. */
const MOTION = `
  .pop{opacity:0;transform:scale(.5) rotate(-8deg);transition:all .18s cubic-bezier(.34,1.6,.64,1)}
  .pop.on{opacity:1;transform:none}
  .slide{opacity:0;transform:translateX(60px) rotate(-3deg);transition:all .2s ease-out}
  .slide.on{opacity:1;transform:none}
  .rise{opacity:0;transform:translateY(26px);transition:all .2s ease-out}
  .rise.on{opacity:1;transform:none}
  .deco{opacity:0;transform:scale(.4);transition:all .22s cubic-bezier(.34,1.7,.64,1)}
  .deco.on{opacity:1;transform:none}
  .wobble.on{animation:none}
  .card{position:relative;background:${C.paper};border:5px solid ${C.ink};border-radius:12px;
        padding:12px 22px;box-shadow:8px 9px 0 rgba(30,41,59,.16);display:flex;
        align-items:center;gap:16px;font-size:33px;font-weight:800}
  .card .n{width:48px;height:48px;flex:0 0 48px;border-radius:50%;background:${C.sky};
        border:4px solid ${C.ink};display:flex;align-items:center;justify-content:center;
        font-family:'Secular One';font-size:30px}
  .card .eq{direction:ltr;flex:1;text-align:left;font-family:'Secular One'}
  .card.bad{background:#FFF3E8;border-color:${C.peach};transform:rotate(-1.6deg) scale(1.03)}
  .card.bad .n{background:${C.peach};color:${C.ink};border-color:${C.peach}}
  .card .x{color:${C.peachDeep};font-size:46px;font-weight:900;opacity:0;transition:opacity .1s}
  .card.bad .x{opacity:1}
`;

/* ── GIF 1 · error hunt ─────────────────────────────────────────── */
writeFileSync('anim2_errorhunt.html', SHELL(`
  ${D(`top:-70px;left:-70px;`, `<svg viewBox="0 0 320 320" style="width:320px;height:320px">
      <circle cx="160" cy="160" r="160" fill="${C.lilac}" opacity=".85"/></svg>`, 'd0')}
  ${D(`top:40px;left:250px;transform:rotate(-12deg)`, doodle.star(C.peach, 1), 'd1')}
  ${D(`top:430px;left:45px;`, doodle.spiral(C.peach, .9), 'd2')}
  ${D(`bottom:250px;left:40px;transform:rotate(6deg)`, doodle.scribble(C.mint, .9), 'd3')}
  ${D(`top:210px;left:35px;transform:rotate(-14deg)`, art.pencil(.85), 'd4')}
  ${D(`top:640px;right:-20px;`, doodle.burst(C.peach, .9), 'd5')}
  <div class="wrap">
    <div class="pop" id="k" style="align-self:flex-start;background:${C.peach};font-family:'Secular One';
         font-size:29px;padding:12px 28px;border:4px solid ${C.ink};border-radius:999px;
         transform-origin:right center;box-shadow:6px 6px 0 rgba(30,41,59,.2)">🔍 ציד טעויות — משחק אמיתי מהאתר</div>
    <h1 class="rise" id="h" style="margin-top:16px;font-size:66px">מי מוצא<br><span class="hl">את הטעות?</span></h1>
    <div class="rise" id="q" style="font-size:28px;color:${C.muted};margin-top:10px">
      גזרו: f(x) = 3x⁴ · יש בדיוק שגיאה אחת</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">
      <div class="card slide" id="s0"><span class="n">1</span><span class="eq">f(x) = 3x⁴</span><span class="x">✗</span></div>
      <div class="card slide" id="s1"><span class="n">2</span><span class="eq">f'(x) = 3 · 4x³</span><span class="x">✗</span></div>
      <div class="card slide" id="s2"><span class="n">3</span><span class="eq">f'(x) = 12x³</span><span class="x">✗</span></div>
      <div class="card slide" id="s3"><span class="n">4</span><span class="eq">f'(x) = 12x⁴</span><span class="x">✗</span></div>
    </div>
    <div class="pop" id="rev" style="margin-top:14px;transform-origin:right center">
      ${note(`<div style="font-size:26px;line-height:1.4;font-weight:700">
        <b style="color:${C.peachDeep}">שורה 4:</b> אחרי גזירה החזקה יורדת ל־3 ונשארת שם.</div>`,
        { rot: -1.4, w: 'fit-content', pad: '16px 26px', tapeRot: 5 })}</div>
    <div class="grow"></div>${CTA(`🎮 עוד משחקים כאלה<br>מחכים באתר`)}
  </div>
  <script>
  const on=(id,v)=>document.getElementById(id).classList.toggle('on',v);
  window.TOTAL=34;
  window.setFrame=i=>{
    ['d0','d1','d2','d3','d4','d5'].forEach((d,k)=>on(d,i>=2+k*2));
    on('k',i>=1); on('h',i>=3); on('q',i>=6);
    for(let k=0;k<4;k++) on('s'+k, i>=9+k*3);
    const bad=document.getElementById('s3');
    bad.classList.toggle('bad', i>=24);
    on('rev', i>=28);
  };
  window.setFrame(0);
  </script>`, C.cream, MOTION));

/* ── GIF 2 · speed drill ───────────────────────────────────────── */
writeFileSync('anim2_speed.html', SHELL(`
  ${D(`top:-80px;right:-60px;`, `<svg viewBox="0 0 400 280" style="width:400px;height:280px">
      <ellipse cx="200" cy="90" rx="220" ry="160" fill="${C.sky}" opacity=".5"/></svg>`, 'd0')}
  ${D(`top:300px;left:40px;transform:rotate(-10deg)`, doodle.zig(C.peach, .95), 'd1')}
  ${D(`bottom:320px;right:20px;`, doodle.star(C.peach, 1.1), 'd2')}
  ${D(`bottom:170px;left:50px;`, art.rocket(1.2), 'd3')}
  ${D(`top:150px;left:170px;`, doodle.burst(C.peach, .8), 'd4')}
  ${D(`bottom:300px;left:-30px;transform:rotate(7deg)`, doodle.spiral(C.mint, 1), 'd5')}
  <div class="wrap">
    <div class="pop" id="k" style="align-self:flex-start;background:${C.peach};color:${C.ink};
         font-family:'Secular One';font-size:29px;padding:12px 28px;border:4px solid ${C.ink};
         border-radius:999px;transform-origin:right center;box-shadow:6px 6px 0 rgba(30,41,59,.2)">⚡ קרב מהירות</div>
    <h1 class="rise" id="h" style="margin-top:18px;font-size:72px">כמה תשובות<br>ב־<span class="hl">60 שניות?</span></h1>

    <div class="pop" id="box" style="margin-top:24px;transform-origin:center">
      <div style="position:relative;background:${C.paper};border:5px solid ${C.ink};border-radius:16px;
           padding:24px 32px;box-shadow:10px 12px 0 rgba(30,41,59,.16);transform:rotate(-1deg)">
        <div style="display:flex;align-items:baseline;justify-content:space-between">
          <div style="font-family:'Secular One';font-size:36px;color:${C.muted}">תשובות נכונות</div>
          <div id="score" style="font-family:'Secular One';font-size:78px;direction:ltr">0</div>
        </div>
        <div id="ex" style="font-family:'Secular One';font-size:54px;direction:ltr;text-align:center;margin:10px 0 16px">7 × 8 = ?</div>
        <div style="height:26px;background:#E2E8F0;border:4px solid ${C.ink};border-radius:999px;overflow:hidden">
          <div id="bar" style="height:100%;width:100%;background:${C.mint}"></div></div>
        <div id="time" style="font-family:'Secular One';font-size:32px;direction:ltr;text-align:left;margin-top:10px">60s</div>
      </div></div>

    <div class="pop" id="win" style="margin-top:18px;transform-origin:right center">
      ${note(`<div style="font-family:'Secular One';font-size:38px;color:${C.peachDeep}">🏆 שיא חדש!</div>
        <div style="font-size:27px;margin-top:4px;color:${C.muted}">והם חוזרים לשחק בלי שביקשנו</div>`,
        { rot: 1.5, w: 'fit-content', pad: '16px 28px', tapeRot: -6 })}</div>
    <div class="grow"></div>${CTA(`⚡ שחקו בעצמכם —<br>בלי הרשמה`)}
  </div>
  <script>
  const on=(id,v)=>document.getElementById(id).classList.toggle('on',v);
  const EX=['7 × 8 = ?','9 × 6 = ?','12 × 4 = ?','8 × 7 = ?','11 × 9 = ?','6 × 8 = ?','13 × 3 = ?'];
  window.TOTAL=36;
  window.setFrame=i=>{
    ['d0','d1','d2','d3','d4','d5'].forEach((d,k)=>on(d,i>=2+k*2));
    on('k',i>=1); on('h',i>=3); on('box',i>=7);
    const t=Math.max(0,Math.min(1,(i-8)/22));            // 0→1 across the drill
    document.getElementById('score').textContent = Math.round(t*23);
    document.getElementById('ex').textContent = EX[Math.floor(t*6.99)];
    document.getElementById('bar').style.width = (100-t*100)+'%';
    document.getElementById('bar').style.background = t>.75 ? '#EA580C' : t>.45 ? '#FA8231' : '#10B981';
    document.getElementById('time').textContent = Math.round(60-t*60)+'s';
    on('win', i>=31);
  };
  window.setFrame(0);
  </script>`, C.cream, MOTION));

/* ── GIF 3 · memory ─────────────────────────────────────────────── */
const PAIRS = [['שטח מלבן','a × b'],['היקף עיגול','2πr'],['שטח משולש','b·h ÷ 2'],['נפח קובייה','a³']];
const tiles = PAIRS.flatMap(([a,b],i)=>[{t:a,p:i},{t:b,p:i}])
  .map((x,idx)=>({...x,idx}));
const ORDER=[0,5,2,7,4,1,6,3];   // shuffled placement
const grid = ORDER.map((n,pos)=>{
  const x=tiles[n];
  return `<div class="tile" id="t${pos}" data-p="${x.p}">
     <div class="back"></div><div class="face">${x.t}</div></div>`;
}).join('');

writeFileSync('anim2_memory.html', SHELL(`
  ${D(`bottom:-90px;left:-80px;`, `<svg viewBox="0 0 340 340" style="width:340px;height:340px">
      <circle cx="170" cy="170" r="170" fill="${C.mintSoft}" opacity=".3"/></svg>`, 'd0')}
  ${D(`top:60px;left:60px;transform:rotate(-10deg)`, doodle.star(C.peach, 1.1), 'd1')}
  ${D(`top:200px;left:-20px;`, doodle.spiral(C.blueSoft, 1), 'd2')}
  ${D(`bottom:330px;right:-10px;transform:rotate(8deg)`, doodle.scribble(C.peach, .9), 'd3')}
  ${D(`bottom:170px;left:70px;transform:rotate(-7deg)`, art.bulb(1.1), 'd4')}
  ${D(`top:520px;left:20px;`, doodle.burst(C.blue, .8), 'd5')}
  <div class="wrap">
    <div class="pop" id="k" style="align-self:flex-start;background:${C.mint};color:${C.ink};
         font-family:'Secular One';font-size:29px;padding:12px 28px;border:4px solid ${C.ink};
         border-radius:999px;transform-origin:right center;box-shadow:6px 6px 0 rgba(30,41,59,.2)">🧠 משחק זיכרון נוסחאות</div>
    <h1 class="rise" id="h" style="margin-top:24px;font-size:82px">לא משננים.<br><span class="hl">משחקים.</span></h1>
    <div class="grid" id="grid">${grid}</div>
    <div class="pop" id="win" style="margin-top:26px;transform-origin:right center">
      ${note(`<div style="font-family:'Secular One';font-size:40px">וזהו — הן פשוט נשארות בראש ✨</div>
        <div style="font-size:29px;margin-top:6px;color:${C.muted}">
        איזו נוסחה הכי קשה לילד שלכם? כתבו לנו ונבנה משחק סביבה 🎁</div>`,
        { rot: -1.4, w: 'fit-content', pad: '22px 32px', tapeRot: 6 })}</div>
    <div class="grow"></div>${CTA(`🧠 בנו משחק על החומר<br>של הילד שלכם`)}
  </div>
  <script>
  const on=(id,v)=>document.getElementById(id).classList.toggle('on',v);
  const T=[...document.querySelectorAll('.tile')];
  // Each step reveals one matching pair, in grid-position terms.
  const MATCH=[[0,5],[2,7],[1,4],[3,6]];
  window.TOTAL=38;
  window.setFrame=i=>{
    ['d0','d1','d2','d3','d4','d5'].forEach((d,k)=>on(d,i>=2+k*2));
    on('k',i>=1); on('h',i>=3);
    T.forEach((t,k)=>t.classList.toggle('in', i>=6+k));
    T.forEach(t=>{t.classList.remove('up','done')});
    MATCH.forEach((m,k)=>{
      const s=15+k*5;
      if(i>=s+1) m.forEach(p=>T[p].classList.add('up'));
      if(i>=s+3) m.forEach(p=>T[p].classList.add('done'));
    });
    on('win', i>=35);
  };
  window.setFrame(0);
  </script>`, C.paper, MOTION + `
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:30px}
  .tile{position:relative;height:150px;opacity:0;transform:scale(.6);
        transition:opacity .18s ease,transform .18s cubic-bezier(.34,1.6,.64,1)}
  .tile.in{opacity:1;transform:none}
  .tile .back,.tile .face{position:absolute;inset:0;border:5px solid ${C.ink};border-radius:14px;
        display:flex;align-items:center;justify-content:center;text-align:center;padding:10px;
        box-shadow:6px 7px 0 rgba(30,41,59,.16);transition:opacity .12s}
  .tile .back{background:${C.blue};background-image:radial-gradient(rgba(255,255,255,.5) 3px,transparent 3px);
        background-size:22px 22px}
  .tile .face{background:${C.paper};font-family:'Secular One';font-size:30px;opacity:0}
  .tile.up .back{opacity:0}  .tile.up .face{opacity:1}
  .tile.done .face{background:${C.sun};transform:rotate(-2deg)}
  `));

console.log('wrote 3 animated posts');

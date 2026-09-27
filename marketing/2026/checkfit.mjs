import puppeteer from '../2025-v2/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
const files = readdirSync('.').filter(f => /^(v2_|anim2_).*\.html$/.test(f)).sort();
const b = await puppeteer.launch({ args:['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width:1080, height:1080 });
for (const f of files) {
  await p.goto('file://'+resolve(f), { waitUntil:'networkidle0' });
  await new Promise(r=>setTimeout(r,500));
  if (f.startsWith('anim2_')) await p.evaluate(()=>window.setFrame(window.TOTAL-1));
  const r = await p.evaluate(() => {
    const foot = document.querySelector('.foot');
    const wrap = document.querySelector('.wrap');
    return { foot: Math.round(foot.getBoundingClientRect().bottom),
             content: Math.round(wrap.scrollHeight) };
  });
  const bad = r.foot > 1080 || r.content > 1080;
  console.log((bad ? '✗ ' : '✓ ') + f.padEnd(26), 'foot-bottom', r.foot, ' content', r.content);
}
await b.close();

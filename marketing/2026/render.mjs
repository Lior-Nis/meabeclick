import puppeteer from '../2025-v2/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 2 });

for (const f of readdirSync('.').filter(n => n.endsWith('.html')).sort()) {
  await page.goto('file://' + resolve(f), { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 700));           // let the webfont settle
  const out = f.replace('.html', '.png');
  await page.screenshot({ path: out });
  console.log('  ✓', out);
}
await browser.close();

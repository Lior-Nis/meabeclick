import puppeteer from '../2025-v2/node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [file, out, sizeArg, holdArg] = process.argv.slice(2);
const SIZE = Number(sizeArg || 640);          // 1080 is huge as a GIF; 640 reads fine in a feed
const HOLD = Number(holdArg || 14);           // extra frames on the last state

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: SIZE / 1080 });
await page.goto('file://' + resolve(file), { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 800));

const total = await page.evaluate(() => window.TOTAL);
const enc = GIFEncoder();

for (let i = 0; i < total + HOLD; i++) {
  await page.evaluate(n => window.setFrame(n), Math.min(i, total - 1));
  const buf = await page.screenshot({ type: 'png' });
  // Decode via the page itself — avoids adding an image-decoding dependency.
  const rgba = await page.evaluate(async (b64, s) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, s, s);
    return Array.from(x.getImageData(0, 0, s, s).data);
  }, buf.toString('base64'), SIZE);

  const data = new Uint8ClampedArray(rgba);
  const palette = quantize(data, 128);
  const index = applyPalette(data, palette);
  enc.writeFrame(index, SIZE, SIZE, { palette, delay: i >= total - 1 ? 1400 : 130 });
  process.stdout.write('.');
}
enc.finish();
writeFileSync(out, Buffer.from(enc.bytes()));
await browser.close();
console.log('\n  ✓', out);

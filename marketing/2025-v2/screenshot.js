const puppeteer = require('puppeteer');
const path = require('path');

const posts = [
  'post_01_hero', 'post_02_advantages', 'post_03_kids', 'post_04_parents',
  'post_05_ai', 'post_06_subjects', 'post_07_pricing', 'post_08_homework',
  'post_09_testimonial', 'post_10_cta'
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

  for (const post of posts) {
    const filePath = path.resolve(__dirname, `${post}.html`);
    await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0' });
    await page.screenshot({ path: path.resolve(__dirname, `${post}.png`) });
    console.log(`Saved: ${post}.png`);
  }

  await browser.close();
})();

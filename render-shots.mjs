// Token Radar v8 — screenshot renderer.
// Renders the dashboard (built by main.ts into out/dashboard) at 1440x900
// and saves 4 JPEG screenshots into screenshots/:
//   1-board.jpg   — top of page: headline + KPI strip + formula + controls + board top
//   2-detail.jpg  — board tail + #1 Steakhouse Financial detail panel + farm plan
//   3-scatter.jpg — log-log scatter + protocol accounting + evidence tables
//   4-method.jpg  — best farm plans tail + method section + footer
// Gate rule (this is what v7 broke): each shot at most 512 KiB, long side at
// most 1440 px, short side at least 800 px. 1440x900 satisfies all three.

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/makefun/gta6-01/node_modules/playwright-core/package.json');
const { chromium } = require('playwright-core');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:8904/index.html', { waitUntil: 'load', timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('#boardBody tr').length > 100, null, { timeout: 20000 });
await page.waitForTimeout(600);

const shot = async (name, scrollY) => {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(450);
  const path = join(OUT, name);
  await page.screenshot({ path, type: 'jpeg', quality: 80 });
  console.log('saved', name);
};

// 1 — top of page.
await shot('1-board.jpg', 0);

// 2 — open the #1 row's detail panel, then frame board tail + detail.
await page.evaluate(() => {
  const row = document.querySelector('#boardBody tr');
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForTimeout(600);
const detailTop = await page.evaluate(() => document.querySelector('#detail').getBoundingClientRect().top + window.scrollY);
await shot('2-detail.jpg', Math.max(0, detailTop - 340));

// 3 — scatter section.
const scatterTop = await page.evaluate(() => document.querySelector('.scatter').getBoundingClientRect().top + window.scrollY);
await shot('3-scatter.jpg', Math.max(0, scatterTop - 8));

// 4 — method section, with the farm-plans tail above it.
const methodTop = await page.evaluate(() => document.querySelector('.method').getBoundingClientRect().top + window.scrollY);
await shot('4-method.jpg', Math.max(0, methodTop - 130));

console.log('errors:', JSON.stringify(errors));
await browser.close();
console.log('done');

// Captures each section of the running app for visual review:
//   node tests/tools/shots.mjs <outDir> [light|dark] [width]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [outDir = 'shots', theme = 'light', width = '1280'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, colorScheme: theme });
await page.addInitScript((value) => localStorage.setItem('opslab-theme', value), theme);
await page.goto(process.env.OPSLAB_URL ?? 'http://localhost:3000');
await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}' });
await page.waitForTimeout(1200);

const sections = ['.topbar', '.hero', '.stat-strip', '#pipeline', '#architecture', '#request-path', '#concepts', '#playground', '#operations', '.next-step', 'body > footer'];
for (const [index, selector] of sections.entries()) {
  const element = page.locator(selector).first();
  if (await element.count()) {
    await element.screenshot({ path: `${outDir}/${String(index).padStart(2, '0')}-${selector.replace(/[^a-z]/gi, '') || 'section'}-${theme}-${width}.png` });
  }
}
await browser.close();

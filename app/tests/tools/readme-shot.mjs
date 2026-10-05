// Regenerates the README screenshots from the running app:
//   node tests/tools/readme-shot.mjs   (expects the app on OPSLAB_URL or :3100)
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1 });
await page.addInitScript(() => localStorage.setItem('opslab-theme', 'light'));
await page.goto(process.env.OPSLAB_URL ?? 'http://localhost:3100');
await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}' });
await page.waitForTimeout(1200);
await page.screenshot({ path: '../docs/screenshot-hero.png' });

await page.locator('#rollout-strategy [data-strategy="canary"]').click();
await page.locator('#start-rollout').click();
await page.locator('#kubectl-chips button').first().click();
await page.locator('.ops-grid').scrollIntoViewIfNeeded();
await page.waitForTimeout(3600);
await page.locator('.ops-grid').screenshot({ path: '../docs/screenshot-operations.png' });
await browser.close();

// Records the README demo GIFs from the running app (default http://localhost:3100):
//   node tests/tools/record-gifs.mjs
// Needs Docker for the webm -> gif conversion (ffmpeg runs in a container).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.OPSLAB_URL ?? 'http://localhost:3100';
const docs = resolve('../docs');
const work = resolve('test-results/gifs');
const size = { width: 1100, height: 640 };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function scene(name, setup, play) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: work, size } });
  await context.addInitScript(() => localStorage.setItem('opslab-theme', 'light'));
  const page = await context.newPage();
  const opened = Date.now();
  await page.goto(url);
  await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}html{scroll-behavior:auto}.noise{display:none}' });
  await page.evaluate(() => document.fonts.ready);
  await setup(page);
  await wait(400);
  // Start the GIF once the page is in position, so it never opens on a blank or loading frame.
  const start = ((Date.now() - opened) / 1000).toFixed(2);
  await play(page);
  await context.close();
  await browser.close();

  const video = readdirSync(work).find((file) => file.endsWith('.webm'));
  renameSync(`${work}/${video}`, `${work}/${name}.webm`);
  // Two-pass palette keeps the flat colours crisp and the file small.
  execFileSync('docker', ['run', '--rm', '-v', `${work}:/in`, '-v', `${docs}:/out`, 'linuxserver/ffmpeg:7.1.1', '-y', '-ss', start, '-i', `/in/${name}.webm`,
    '-vf', 'fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', `/out/${name}.gif`], { stdio: 'inherit' });
}

const focus = (page, selector) => page.locator(selector).evaluate((element) => element.scrollIntoView({ block: 'start' }));

await scene('demo-pipeline', (page) => focus(page, '.pipeline-shell'), async (page) => {
  await page.locator('#run-pipeline').click();
  await wait(5200);
  await page.locator('#break-build').check();
  await wait(500);
  await page.locator('#run-pipeline').click();
  await wait(4800);
});

await scene('demo-rollout', async (page) => {
  await focus(page, '.ops-grid');
  await page.evaluate(() => scrollBy(0, 280));
}, async (page) => {
  await page.locator('#rollout-strategy [data-strategy="canary"]').click();
  await wait(700);
  await page.locator('#start-rollout').click();
  await wait(9500);
  await focus(page, '.kubectl-card');
  await page.locator('#kubectl-input').pressSequentially('kubectl get pods', { delay: 60 });
  await page.locator('#kubectl-input').press('Enter');
  await wait(1200);
  await page.locator('#kubectl-input').pressSequentially('kubectl scale deployment/opslab-api --replicas=4', { delay: 35 });
  await page.locator('#kubectl-input').press('Enter');
  await wait(2600);
});

await scene('demo-incident', (page) => focus(page, '.ops-grid'), async (page) => {
  await page.locator('#real-chaos').check();
  await page.locator('[data-scenario="errors"]').click();
  await page.locator('#send-burst').click();
  await wait(2500);
  const answers = await page.evaluate(() => scenarios.errors.steps.map((step) => step.choices.find((choice) => choice[1])[0]));
  for (const answer of answers) {
    await page.locator('#game-choices button', { hasText: answer }).click();
    await wait(1500);
    await page.locator('#game-choices button.right').click();
    await wait(500);
  }
  await wait(2500);
});

await scene('demo-lessons', async (page) => {
  await page.locator('[data-lesson="autoscaling"] .lesson-expand').click();
  await focus(page, '#hpa-toy');
  await page.evaluate(() => scrollBy(0, -60));
}, async (page) => {
  for (const load of [120, 200, 280, 360, 80]) {
    await page.locator('#hpa-load').fill(String(load));
    await wait(1900);
  }
  await page.locator('[data-lesson="autoscaling"] .quiz-options button', { hasText: /^3$/ }).click();
  await wait(1800);
});

rmSync(work, { recursive: true, force: true });
console.log('GIFs written to docs/');

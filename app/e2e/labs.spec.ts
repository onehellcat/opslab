import { expect, test, type Page } from '@playwright/test';

// Animations are skipped under reduced motion, which keeps these runs short and deterministic.
test.use({ reducedMotion: 'reduce' });

let pageErrors: string[];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#health-pill-text')).toHaveText('live · ready');
});

test.afterEach(async ({ request }) => {
  await request.delete('/api/chaos');
  expect(pageErrors).toEqual([]);
});

async function openLesson(page: Page, lesson: string) {
  const card = page.locator(`[data-lesson="${lesson}"]`);
  await card.locator('.lesson-expand').click();
  return card;
}

test('pipeline passes, and stops at Verify when the build is broken', async ({ page }) => {
  await page.locator('#run-pipeline').click();
  await expect(page.locator('#pipeline-result')).toContainText('All four stages passed');
  await expect(page.locator('.stage.done')).toHaveCount(4);

  await page.locator('#break-build').check();
  await page.locator('#run-pipeline').click();
  await expect(page.locator('#pipeline-result')).toContainText('Failed at Verify');
  await expect(page.locator('.stage.failed')).toHaveCount(1);
  await expect(page.locator('.stage.skipped')).toHaveCount(1);
  await expect(page.locator('#stage-detail .terminal')).toContainText('Quality gate failed');
});

test('architecture tabs switch diagrams and explain the selected component', async ({ page }) => {
  await page.locator('.tab[data-view="kubernetes"]').click();
  await page.locator('#diagram [data-node="database"]').click();
  await expect(page.locator('#concept-panel h3')).toHaveText('Stateful database');
  await expect(page.locator('#concept-panel')).toContainText('kubernetes/postgres.yaml');
});

test('request trace draws timings measured from a real request', async ({ page }) => {
  await page.locator('#run-trace').click();
  await expect(page.locator('#waterfall .wf-head')).toContainText('MEASURED · 200 OK');
  await expect(page.locator('#waterfall .wf-row')).not.toHaveCount(0);
  await expect(page.locator('#waterfall')).toContainText('Store query');
  await expect(page.locator('#response-status')).toHaveText('200 OK');
});

test('a correct lesson check marks the lesson done and survives a reload', async ({ page }) => {
  const card = await openLesson(page, 'autoscaling');
  await card.locator('.quiz-options button', { hasText: /^2$/ }).click();
  await expect(card.locator('.quiz-feedback')).toContainText('Not quite');
  await card.locator('.quiz-options button', { hasText: /^3$/ }).click();
  await expect(card).toHaveClass(/completed/);
  await expect(page.locator('#progress-label')).toHaveText('1 of 9 complete');

  await page.reload();
  await expect(page.locator('[data-lesson="autoscaling"]')).toHaveClass(/completed/);
});

test('lesson simulators react to input', async ({ page }) => {
  const container = await openLesson(page, 'container');
  await container.locator('[data-change="source"]').click();
  await expect(page.locator('#layer-result')).toContainText('2 of 6 layers rebuilt');
  await expect(container.locator('.layer-list .cached')).toHaveCount(4);

  await openLesson(page, 'iac');
  await page.locator('#plan-replicas').fill('4');
  await expect(page.locator('#plan-output')).toContainText('replicas = 2 -> 4');
  await page.locator('#plan-rename').check();
  await expect(page.locator('#plan-output')).toContainText('8 to add, 0 to change, 8 to destroy');

  await openLesson(page, 'config');
  await page.locator('#secret-input').fill('hunter2');
  await expect(page.locator('#secret-output')).toContainText('aHVudGVyMg==');
  await page.locator('#secret-decode').click();
  await expect(page.locator('#secret-output')).toContainText('hunter2');

  await openLesson(page, 'autoscaling');
  await page.locator('#hpa-load').fill('200');
  await expect(page.locator('#hpa-pods > div')).toHaveCount(7);

  await openLesson(page, 'gitops');
  await page.locator('#gitops-drift').click();
  await expect(page.locator('#gitops-status')).toHaveText('Synced');
  await expect(page.locator('#gitops-pods i')).toHaveCount(2);
  await expect(page.locator('#gitops-log')).toContainText('cluster drifted from Git');
});

test('incident lab can be played through to recovery', async ({ page }) => {
  await page.locator('[data-scenario="crashloop"]').click();
  await expect(page.locator('#scenario-state')).toHaveText('INCIDENT');

  const steps: string[] = await page.evaluate('scenarios.crashloop.steps.map((step) => step.choices.find((choice) => choice[1])[0])');
  for (const answer of steps) {
    await page.locator('#game-choices button', { hasText: answer }).click();
    await page.locator('#game-choices button.right').click();
  }

  await expect(page.locator('#scenario-state')).toHaveText('RESOLVED');
  await expect(page.locator('#game-prompt')).toContainText('with 0 wrong turns');
  await expect(page.locator('#onboarding-list input[data-onboard="incident"]')).toBeChecked();
});

test('a real fault shows up as an alert and clears when the incident is closed', async ({ page }) => {
  await page.locator('#real-chaos').check();
  await page.locator('[data-scenario="readiness"]').click();
  await expect(page.locator('#scenario-state')).toHaveText('LIVE FAULT');
  await expect(page.locator('#alert-list')).toContainText('ReadinessFailing');
  await expect(page.locator('#ops-db')).toContainText('NOT READY');
  await expect(page.locator('#event-feed')).toContainText('readiness failing');

  await page.locator('#reset-scenario').click();
  await expect(page.locator('#ops-db')).toContainText('READY ·');
  await expect(page.locator('#alert-list')).not.toContainText('ReadinessFailing');
});

test('a bad rolling release stalls safely and rolls back', async ({ page }) => {
  await page.locator('#bad-release').check();
  await page.locator('#start-rollout').click();
  await expect(page.locator('#rollout-state')).toHaveText('STALLED');
  await expect(page.locator('#pod-grid .pod.ready')).toHaveCount(2);
  await expect(page.locator('#pod-grid .pod.notready')).toHaveCount(1);

  await page.locator('#kubectl-input').fill('kubectl rollout status deployment/opslab-api');
  await page.locator('#kubectl-input').press('Enter');
  await expect(page.locator('#kubectl-screen')).toContainText('exceeded its progress deadline');

  await page.locator('#rollback').click();
  await expect(page.locator('#rollout-state')).toHaveText('ROLLED BACK');
  await expect(page.locator('#pod-grid .pod')).toHaveCount(2);
});

for (const strategy of ['rolling', 'bluegreen', 'canary']) {
  test(`${strategy} rollout replaces every pod with the new version`, async ({ page }) => {
    await page.locator(`#rollout-strategy [data-strategy="${strategy}"]`).click();
    await page.locator('#start-rollout').click();
    await expect(page.locator('#rollout-state')).toHaveText('COMPLETE');
    await expect(page.locator('#pod-grid .pod.ready')).toHaveCount(2);
    await expect(page.locator('#pod-grid .pod span')).toHaveText(['v0.2', 'v0.2']);
    await expect(page.locator('#split-old-label')).toHaveText('v0.2 · 100%');
  });
}

test('a failing canary is aborted without a rollback', async ({ page }) => {
  await page.locator('#rollout-strategy [data-strategy="canary"]').click();
  await page.locator('#bad-release').check();
  await page.locator('#start-rollout').click();
  await expect(page.locator('#rollout-state')).toHaveText('ABORTED');
  await expect(page.locator('#pod-grid .pod span')).toHaveText(['v0.1', 'v0.1']);
});

test('kubectl terminal reads and changes the deployment lab', async ({ page }) => {
  const run = async (command: string) => {
    await page.locator('#kubectl-input').fill(command);
    await page.locator('#kubectl-input').press('Enter');
  };

  await run('kubectl get pods -n opslab');
  await expect(page.locator('#kubectl-screen pre').last()).toContainText('opslab-api-1');
  await run('kubectl scale deployment/opslab-api --replicas=3');
  await expect(page.locator('#pod-grid .pod.ready')).toHaveCount(3);
  await run('kubectl get deploy');
  await expect(page.locator('#kubectl-screen pre').last()).toContainText('3/3');
  await run('kubectl delete everything');
  await expect(page.locator('#kubectl-screen pre').last()).toHaveClass(/error/);
});

test('incident board creates and resolves a real incident', async ({ page, request }) => {
  const title = `Checkout latency ${Date.now()}`;
  await page.locator('#board-title').fill(title);
  await page.locator('#board-severity').selectOption('high');
  await page.locator('#board-form button').click();

  const row = page.locator('#board-list li', { hasText: title });
  await expect(row).toContainText('open');
  await expect(page.locator('#event-feed')).toContainText(title);

  await row.getByRole('button', { name: 'Investigate' }).click();
  await page.locator('#board-list li', { hasText: title }).getByRole('button', { name: 'Resolve' }).click();
  await expect(page.locator('#board-list li', { hasText: title })).toContainText('resolved');

  const { incidents } = await (await request.get('/api/incidents')).json();
  expect(incidents.find((incident: { title: string }) => incident.title === title)).toMatchObject({ status: 'resolved', severity: 'high' });
});

test('viewer role is refused on the incident board', async ({ page }) => {
  await page.locator('#operator-role').selectOption('viewer');
  await page.locator('#board-title').fill('Should be refused');
  await page.locator('#board-form button').click();
  await expect(page.locator('#toast')).toContainText('Viewer role cannot create incidents');
});

test('theme choice persists, and the tour walks through every stop', async ({ page }) => {
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  const after = await page.locator('html').getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', after!);

  await page.locator('#start-tour').click();
  await expect(page.locator('#tour-step')).toHaveText('1 / 6');
  for (let step = 0; step < 5; step += 1) await page.locator('#tour-next').click();
  await expect(page.locator('#tour-next')).toHaveText('Finish');
  await page.locator('#tour-next').click();
  await expect(page.locator('#tour')).toBeHidden();
});

test('phone layout has working navigation and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator('#nav-toggle').click();
  await expect(page.locator('#site-nav')).toHaveClass(/open/);
  await page.locator('#site-nav a[href="#operations"]').click();
  await expect(page.locator('#site-nav')).not.toHaveClass(/open/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

'use strict';
// Operations labs, lesson simulators and page polish. Loaded after app.js and shares its helpers.

/* ---------- Toast, badges and onboarding ---------- */

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

const badges = {
  first: ['First request', 'Send a request from the API playground'],
  commander: ['Incident commander', 'Finish an incident lab'],
  captain: ['Release captain', 'Complete a rollout'],
  breaker: ['Build breaker', 'Fail the pipeline on purpose'],
  chaos: ['Chaos engineer', 'Inject a real fault'],
  scholar: ['Scholar', 'Complete all six lessons'],
};
const earnedBadges = new Set(readStore('opslab-badges', []));

function renderBadges() {
  $('#badge-list').innerHTML = Object.entries(badges)
    .map(([key, [name, how]]) => {
      const earned = earnedBadges.has(key);
      return `<li class="${earned ? 'earned' : ''}" title="${how}"><i aria-hidden="true">${earned ? '★' : '☆'}</i><b>${name}</b><small>${earned ? 'Earned' : how}</small></li>`;
    })
    .join('');
}

function earnBadge(key) {
  if (earnedBadges.has(key)) return;
  earnedBadges.add(key);
  writeStore('opslab-badges', [...earnedBadges]);
  renderBadges();
  showToast(`Badge earned: ${badges[key][0]}`);
}

const onboarding = readStore('opslab-onboarding', {});
const onboardingBadges = { api: 'first', incident: 'commander', rollout: 'captain' };

function renderOnboarding() {
  const boxes = $$('[data-onboard]');
  boxes.forEach((box) => (box.checked = Boolean(onboarding[box.dataset.onboard])));
  $('#onboarding-progress').textContent = `${boxes.filter((box) => box.checked).length} / ${boxes.length} complete`;
}

function markOnboarding(key, done = true) {
  onboarding[key] = done;
  writeStore('opslab-onboarding', onboarding);
  renderOnboarding();
  if (done && onboardingBadges[key]) earnBadge(onboardingBadges[key]);
}

$$('[data-onboard]').forEach((box) => box.addEventListener('change', () => markOnboarding(box.dataset.onboard, box.checked)));
renderOnboarding();
renderBadges();

/* ---------- Theme and navigation ---------- */

$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('opslab-theme', next);
  } catch {
    // Theme still applies for this page view.
  }
});

const siteNav = $('#site-nav');
const navToggle = $('#nav-toggle');
const navLinks = $$('a', siteNav);

function setNavOpen(open) {
  siteNav.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}

navToggle.addEventListener('click', () => setNavOpen(!siteNav.classList.contains('open')));
navLinks.forEach((link) => link.addEventListener('click', () => setNavOpen(false)));

// Highlight the nav link for whichever section crosses the middle of the viewport.
const spy = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id));
    }),
  { rootMargin: '-45% 0px -50% 0px' },
);
navLinks.forEach((link) => {
  const section = $(link.getAttribute('href'));
  if (section) spy.observe(section);
});

/* ---------- Live system signals ---------- */

const sparkCapacity = 40;
const latencySeries = [];
const rateSeries = [];
let opsVisible = false;
let pollTick = 0;

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// Counts a stat up or down to its new value instead of snapping.
function tweenNumber(element, target) {
  const from = Number(element.dataset.value ?? target);
  element.dataset.value = target;
  if (reducedMotion || from === target) {
    element.textContent = target.toLocaleString();
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const progress = Math.min((now - started) / 500, 1);
    element.textContent = Math.round(from + (target - from) * progress).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function drawSpark(svg, series) {
  const width = 120;
  const height = 34;
  const max = Math.max(...series, 1);
  const points = series.map((value, index) => {
    const x = ((sparkCapacity - series.length + index) / (sparkCapacity - 1)) * width;
    const y = height - 3 - (value / max) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (points.length < 2) {
    svg.innerHTML = '';
    return;
  }
  const firstX = points[0].split(',')[0];
  svg.innerHTML =
    `<polygon class="spark-area" points="${firstX},${height} ${points.join(' ')} ${width},${height}"/>` +
    `<polyline class="spark-line" points="${points.join(' ')}"/>`;
}

function setHealth(state, label) {
  document.documentElement.dataset.health = state;
  $('#health-pill-text').textContent = label;
}

function applySummary(summary) {
  tweenNumber($('#stat-requests'), summary.http_requests_total);
  tweenNumber($('#stat-services'), summary.services_total);
  tweenNumber($('#stat-incidents'), summary.active_incidents);
  $('#stat-uptime').textContent = formatUptime(summary.uptime_seconds);
  $('#ops-incidents').textContent = summary.active_incidents;
  $('#ops-services').textContent = summary.services_total;

  latencySeries.push(summary.recent.p95_ms);
  rateSeries.push(summary.recent.rate_per_second);
  if (latencySeries.length > sparkCapacity) latencySeries.shift();
  if (rateSeries.length > sparkCapacity) rateSeries.shift();
  $('#spark-latency-value').textContent = `${summary.recent.p95_ms} ms`;
  $('#spark-rate-value').textContent = summary.recent.rate_per_second.toFixed(1);
  drawSpark($('#spark-latency'), latencySeries);
  drawSpark($('#spark-rate'), rateSeries);
  $('.status-card').classList.toggle('fault-active', Boolean(summary.chaos.expiresAt));
}

async function refreshOperations({ full = true } = {}) {
  try {
    const summary = await (await fetch('/api/ops/summary')).json();
    applySummary(summary);
    markOnboarding('app');
    if (!full) return;

    const [live, ready] = await Promise.all([fetch('/health/live'), fetch('/health/ready')]);
    const readiness = await ready.json();
    $('#ops-api').textContent = live.ok ? 'LIVE' : 'UNAVAILABLE';
    $('#ops-db').textContent = ready.ok ? `READY · ${readiness.store || readiness.database}` : `NOT READY · ${ready.status}`;
    $('#ops-db').classList.toggle('is-error', !ready.ok);
    setHealth(ready.ok ? 'ok' : 'degraded', ready.ok ? 'live · ready' : 'live · not ready');
  } catch {
    $('#ops-api').textContent = 'OFFLINE';
    $('#ops-db').textContent = 'UNKNOWN';
    setHealth('offline', 'offline');
  }
}

// Poll quickly while the console is on screen and slowly otherwise; skip hidden tabs entirely.
async function pollLoop() {
  if (!document.hidden) {
    await refreshOperations({ full: pollTick % 5 === 0 });
    pollTick += 1;
  }
  setTimeout(pollLoop, opsVisible ? 2000 : 10000);
}

new IntersectionObserver((entries) => (opsVisible = entries[0].isIntersecting)).observe($('#operations'));
$('#refresh-ops').addEventListener('click', () => refreshOperations());
pollLoop();

$('#send-burst').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const total = 50;
  let sent = 0;
  button.disabled = true;
  const worker = async () => {
    while (sent < total) {
      sent += 1;
      button.textContent = `Sending ${sent} / ${total}`;
      await fetch('/api/services').catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  button.disabled = false;
  button.textContent = 'Send 50 requests';
  refreshOperations({ full: false });
});

/* ---------- Event stream ---------- */

const eventFeed = $('#event-feed');
const eventConnection = $('#event-connection');
const events = new EventSource('/api/events');
let feedHasEvents = false;

events.onopen = () => (eventConnection.textContent = 'LIVE');
events.onerror = () => (eventConnection.textContent = 'RECONNECTING');

['incident', 'service', 'chaos'].forEach((type) =>
  events.addEventListener(type, (event) => {
    const item = JSON.parse(event.data);
    if (!feedHasEvents) eventFeed.innerHTML = '';
    feedHasEvents = true;

    const row = document.createElement('li');
    const kind = document.createElement('b');
    const time = document.createElement('span');
    kind.textContent = item.type.toUpperCase();
    time.textContent = new Date(item.at).toLocaleTimeString();
    row.append(kind, ' ' + item.message + ' ', time);
    row.className = 'event-' + item.type;
    eventFeed.prepend(row);
    if (eventFeed.children.length > 6) eventFeed.lastElementChild.remove();
    refreshOperations();
  }),
);

/* ---------- Incident lab ---------- */

// Each choice: [label, is it the right next step, what you learn from picking it].
const scenarios = {
  database: {
    title: 'Pages are slow for everyone',
    brief: 'The pager fired: p95 latency tripled five minutes ago. Nothing was deployed today.',
    fault: { latencyMs: 800 },
    steps: [
      {
        prompt: 'Observe — what do you look at first?',
        choices: [
          ['Request rate, error rate and latency for the API', true, 'Latency is up, errors are flat and traffic is normal. Users are slowed down but requests still succeed.'],
          ['Restart every API pod', false, 'Restarting drops in-flight requests and teaches you nothing. Observe user impact before acting.'],
          ['Re-read the Dockerfile for mistakes', false, 'The image has not changed. Start from what users are experiencing right now.'],
        ],
      },
      {
        prompt: 'Inspect — which health signals do you compare?',
        choices: [
          ['/health/live and /health/ready', true, 'Both answer 200. The process is alive and the database is reachable, so this is slowness, not an outage.'],
          ['The liveness probe only', false, 'Liveness proves the process answers HTTP. It says nothing about the dependencies it needs.'],
          ['CPU usage on your laptop', false, 'That is not a signal from the service. Use the health and metrics endpoints it exposes.'],
        ],
      },
      {
        prompt: 'Localize — where is the time going?',
        choices: [
          ['Trace one request and read its timing breakdown', true, 'The handler takes about a millisecond; nearly all the time is spent waiting on the data store boundary.'],
          ['Scale the API to ten replicas', false, 'More API replicas open more connections to a database that is already slow, which makes it worse.'],
          ['Assume the network is flaky', false, 'A guess is not evidence. One trace shows exactly which hop is slow.'],
        ],
      },
      {
        prompt: 'Recover — what is the smallest safe action?',
        choices: [
          ['Reduce load on the database and fix the slow dependency', true, 'Latency returns to normal. The API was healthy throughout, so it never needed a restart.'],
          ['Restart the API pods', false, 'The API is healthy. Restarting it cannot repair PostgreSQL and briefly removes capacity.'],
          ['Delete the PostgreSQL volume', false, 'That destroys the data to cure a latency problem. Recovery should be the smallest reversible step.'],
        ],
      },
    ],
  },
  readiness: {
    title: 'The new release is stuck',
    brief: 'A rollout started ten minutes ago and has not finished. Users have not noticed anything yet.',
    fault: { failReadiness: true },
    steps: [
      {
        prompt: 'Observe — is anyone affected?',
        choices: [
          ['Check error rate and rollout status', true, 'Errors are flat. The rollout reports one new pod Running but not Ready; the old pods still serve all traffic.'],
          ['Roll back immediately', false, 'Maybe, but you do not know yet whether users are affected or why it is stuck. Look first.'],
          ['Delete the Deployment', false, 'That removes the healthy old pods too and turns a stalled rollout into an outage.'],
        ],
      },
      {
        prompt: 'Inspect — what tells you why the pod is not Ready?',
        choices: [
          ['kubectl describe pod and its probe events', true, 'Events show: Readiness probe failed, HTTP 503. Liveness is passing, so the kubelet is not restarting it.'],
          ['The restart count', false, 'It is zero. Restarts point at liveness failures or crashes; this pod is alive but unready.'],
          ['The Service YAML', false, 'The Service is doing its job by leaving the unready pod out of its endpoints.'],
        ],
      },
      {
        prompt: 'Localize — why does readiness answer 503?',
        choices: [
          ['Call /health/ready on the new pod and read the body', true, 'The body names the reason: the new version cannot reach a dependency it requires.'],
          ['Increase the probe timeout', false, 'The endpoint answers quickly with 503. Waiting longer for the same answer changes nothing.'],
          ['Remove the readiness probe', false, 'That would send user traffic to a pod that has just told you it cannot serve it.'],
        ],
      },
      {
        prompt: 'Recover — what is the smallest safe action?',
        choices: [
          ['Roll back, then fix the configuration and redeploy', true, 'The stuck pod is removed, the old version keeps serving, and the fix ships through the normal pipeline.'],
          ['Force-delete the old pods so the rollout continues', false, 'That removes the only pods able to serve traffic. Readiness was protecting you.'],
          ['Wait and hope it becomes ready', false, 'Nothing is changing, so the outcome will not change either.'],
        ],
      },
    ],
  },
};

const wrongTurnSeconds = 120;
const game = { scenario: null, step: 0, started: 0, wrong: 0, timer: null, real: false };
const scenarioState = $('#scenario-state');

const formatClock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const gameSeconds = () => (Date.now() - game.started) / 1000 + game.wrong * wrongTurnSeconds;
const labHeaders = { 'content-type': 'application/json', 'x-opslab-role': 'operator' };

function renderBestTimes() {
  const best = readStore('opslab-best', {});
  const parts = Object.keys(scenarios).filter((key) => best[key]).map((key) => `${$(`[data-scenario="${key}"]`).textContent}: ${formatClock(best[key])}`);
  $('#game-best').textContent = parts.length ? `Best recovery — ${parts.join(' · ')}` : '';
}

async function injectFault(fault) {
  try {
    const response = await fetch('/api/chaos', { method: 'POST', headers: labHeaders, body: JSON.stringify({ ...fault, durationSeconds: 60 }) });
    if (!response.ok) throw new Error((await response.json()).error);
    earnBadge('chaos');
    return true;
  } catch (error) {
    showToast(`Running as a simulation: ${error.message}`);
    return false;
  }
}

async function clearFault() {
  if (!game.real) return;
  game.real = false;
  await fetch('/api/chaos', { method: 'DELETE', headers: labHeaders }).catch(() => {});
  refreshOperations();
}

function renderGameStep() {
  const scenario = scenarios[game.scenario];
  const step = scenario.steps[game.step];
  $('#game-step').textContent = `STEP ${game.step + 1} OF ${scenario.steps.length}`;
  $('#game-prompt').textContent = step.prompt;
  $('#game-feedback').textContent = '';
  $('#game-feedback').className = 'game-feedback';

  const choices = $('#game-choices');
  choices.innerHTML = '';
  [...step.choices]
    .sort(() => Math.random() - 0.5)
    .forEach(([label, correct, lesson]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => chooseStep(button, correct, lesson));
      choices.append(button);
    });
}

function chooseStep(button, correct, lesson) {
  const feedback = $('#game-feedback');
  feedback.textContent = (correct ? '✓ ' : '✗ +2:00 — ') + lesson;
  feedback.className = 'game-feedback ' + (correct ? 'right' : 'wrong');
  button.disabled = true;

  if (!correct) {
    game.wrong += 1;
    button.classList.add('wrong');
    return;
  }

  const choices = $('#game-choices');
  const last = game.step === scenarios[game.scenario].steps.length - 1;
  choices.innerHTML = '';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'right';
  next.textContent = last ? 'Close the incident' : 'Next step →';
  next.addEventListener('click', () => {
    if (last) return finishGame();
    game.step += 1;
    renderGameStep();
  });
  choices.append(next);
  next.focus();
}

async function startGame(key) {
  await clearFault();
  clearInterval(game.timer);
  const scenario = scenarios[key];
  Object.assign(game, { scenario: key, step: 0, started: Date.now(), wrong: 0 });
  game.real = $('#real-chaos').checked && (await injectFault(scenario.fault));

  scenarioState.textContent = game.real ? 'LIVE FAULT' : 'INCIDENT';
  scenarioState.className = 'state-alert';
  $('#scenario-title').textContent = scenario.title;
  $('#scenario-copy').textContent = scenario.brief + (game.real ? ' The fault is really active in this API: watch the snapshot and charts.' : '');
  $('#scenario-picker').hidden = true;
  $('#incident-game').hidden = false;
  $('#game-clock').textContent = '00:00';
  game.timer = setInterval(() => ($('#game-clock').textContent = formatClock(gameSeconds())), 500);
  renderGameStep();
  refreshOperations();
}

async function finishGame() {
  clearInterval(game.timer);
  const seconds = Math.round(gameSeconds());
  const best = readStore('opslab-best', {});
  const isBest = !best[game.scenario] || seconds < best[game.scenario];
  if (isBest) writeStore('opslab-best', { ...best, [game.scenario]: seconds });

  await clearFault();
  scenarioState.textContent = 'RESOLVED';
  scenarioState.className = 'state-ok';
  $('#game-clock').textContent = formatClock(seconds);
  $('#game-prompt').textContent = `Recovered in ${formatClock(seconds)} with ${game.wrong} wrong turn${game.wrong === 1 ? '' : 's'}.${isBest ? ' New best time.' : ''}`;
  $('#game-choices').innerHTML = '';
  $('#game-feedback').textContent = 'Order that worked: observe impact, inspect health signals, localize the failing boundary, take the smallest safe action.';
  $('#game-feedback').className = 'game-feedback right';
  $('#scenario-picker').hidden = false;
  renderBestTimes();
  markOnboarding('incident');
}

async function resetGame() {
  clearInterval(game.timer);
  await clearFault();
  game.scenario = null;
  scenarioState.textContent = 'NORMAL';
  scenarioState.className = '';
  $('#scenario-title').textContent = 'Diagnose against the clock';
  $('#scenario-copy').textContent = 'Pick a failure, then choose each next step. A wrong turn costs two minutes. Aim for the lowest time to recovery.';
  $('#scenario-picker').hidden = false;
  $('#incident-game').hidden = true;
}

$$('[data-scenario]').forEach((button) => button.addEventListener('click', () => startGame(button.dataset.scenario)));
$('#reset-scenario').addEventListener('click', resetGame);
renderBestTimes();

/* ---------- Deployment lab ---------- */

const podGrid = $('#pod-grid');
const rolloutState = $('#rollout-state');
const rolloutNote = $('#rollout-note');
const phaseLabels = { pending: 'Pending', starting: 'Running · not ready', ready: 'Ready', notready: 'Readiness 503', terminating: 'Terminating' };
const rollout = { pods: [], version: 1, previous: 1, busy: false, stalled: false, served: 0, next: 0, sequence: 0 };

function setRolloutState(text, tone = '') {
  rolloutState.textContent = text;
  rolloutState.className = tone;
}

function setPhase(pod, phase) {
  pod.phase = phase;
  pod.element.className = `pod ${phase}`;
  $('b', pod.element).textContent = phaseLabels[phase];
}

function addPod(version, phase) {
  const element = document.createElement('div');
  element.innerHTML = `<i class="pod-pipe" aria-hidden="true"></i><span>v0.${version}</span><b></b><small>0 req</small>`;
  const pod = { version, served: 0, element, name: `opslab-api-${(rollout.sequence += 1)}` };
  setPhase(pod, phase);
  podGrid.append(element);
  rollout.pods.push(pod);
  return pod;
}

async function removePod(pod) {
  setPhase(pod, 'terminating');
  await pace(800);
  pod.element.remove();
  rollout.pods = rollout.pods.filter((other) => other !== pod);
}

// The Service only sends requests to Ready pods, one after another.
setInterval(() => {
  const ready = rollout.pods.filter((pod) => pod.phase === 'ready');
  if (!opsVisible || document.hidden || ready.length === 0) return;
  const pod = ready[(rollout.next += 1) % ready.length];
  pod.served += 1;
  rollout.served += 1;
  $('small', pod.element).textContent = `${pod.served} req`;
  $('#rollout-traffic').textContent = `${rollout.served} req`;
  if (!reducedMotion) {
    pod.element.classList.remove('hit');
    void pod.element.offsetWidth;
    pod.element.classList.add('hit');
  }
}, 280);

// Replaces pods one at a time: surge one new pod, wait for readiness, then retire one old pod.
async function rollTo(version, failing) {
  for (const old of rollout.pods.filter((pod) => pod.version !== version)) {
    const fresh = addPod(version, 'pending');
    rolloutNote.textContent = `${fresh.name} created (maxSurge 1): waiting to be scheduled.`;
    await pace(800);
    setPhase(fresh, 'starting');
    rolloutNote.textContent = `${fresh.name} is running. It receives no traffic until its readiness probe passes.`;
    await pace(1200);

    if (failing) {
      setPhase(fresh, 'notready');
      rolloutNote.textContent = `${fresh.name} answers readiness with 503, so the rollout stops here. Both old pods keep serving every request. Roll back to recover.`;
      return false;
    }

    setPhase(fresh, 'ready');
    rolloutNote.textContent = `${fresh.name} is Ready and joins the Service. Now one v0.${old.version} pod can leave.`;
    await pace(700);
    await removePod(old);
  }
  return true;
}

$('#start-rollout').addEventListener('click', async () => {
  if (rollout.busy || rollout.stalled) {
    if (rollout.stalled) rolloutNote.textContent = 'The rollout is stalled on an unready pod. Roll back before starting another.';
    return;
  }
  rollout.busy = true;
  const target = rollout.version + 1;
  setRolloutState('PROGRESSING', 'state-alert');

  if (await rollTo(target, $('#bad-release').checked)) {
    rollout.previous = rollout.version;
    rollout.version = target;
    setRolloutState('COMPLETE', 'state-ok');
    rolloutNote.textContent = `v0.${target} is fully available. Capacity never dropped below two Ready pods.`;
    markOnboarding('rollout');
  } else {
    rollout.stalled = true;
    setRolloutState('STALLED', 'state-error');
  }
  rollout.busy = false;
});

$('#rollback').addEventListener('click', async () => {
  if (rollout.busy) return;
  if (!rollout.stalled && rollout.previous === rollout.version) {
    rolloutNote.textContent = 'Nothing to roll back yet: only one version has been deployed.';
    return;
  }
  rollout.busy = true;
  setRolloutState('ROLLING BACK', 'state-alert');

  if (rollout.stalled) {
    await Promise.all(rollout.pods.filter((pod) => pod.version !== rollout.version).map(removePod));
    rollout.stalled = false;
    rolloutNote.textContent = `The unready pod is gone and v0.${rollout.version} never stopped serving. Users saw no errors.`;
  } else {
    const target = rollout.previous;
    await rollTo(target, false);
    rollout.previous = rollout.version = target;
    rolloutNote.textContent = `v0.${target} is serving again. A real rollback restores the pod template only, so check data compatibility too.`;
  }
  setRolloutState('ROLLED BACK', 'state-ok');
  rollout.busy = false;
});

addPod(1, 'ready');
addPod(1, 'ready');

/* ---------- Lesson simulators ---------- */

// [instruction, seconds to rebuild, index reused by the "what changed" buttons]
const imageLayers = [
  ['FROM node:22-alpine', 6],
  ['WORKDIR /app', 0.1],
  ['COPY package*.json ./', 0.2],
  ['RUN npm ci', 21],
  ['COPY . .', 0.4],
  ['RUN npm run build', 5],
];
const firstChangedLayer = { none: imageLayers.length, source: 4, deps: 2, base: 0 };
let layerRun = 0;

async function renderLayers(change) {
  const run = (layerRun += 1);
  const list = $('#layer-list');
  const firstChanged = firstChangedLayer[change];
  list.innerHTML = imageLayers.map(([instruction]) => `<li><code>${instruction}</code><b>…</b></li>`).join('');
  $('#layer-result').textContent = '';

  let seconds = 0;
  for (const [index, row] of $$('li', list).entries()) {
    await pace(140);
    if (run !== layerRun) return;
    const rebuilt = index >= firstChanged;
    row.className = rebuilt ? 'rebuilt' : 'cached';
    $('b', row).textContent = rebuilt ? `REBUILT · ${imageLayers[index][1]} s` : 'CACHED';
    if (rebuilt) seconds += imageLayers[index][1];
  }

  const rebuiltCount = imageLayers.length - firstChanged;
  $('#layer-result').textContent = rebuiltCount
    ? `${rebuiltCount} of ${imageLayers.length} layers rebuilt in about ${seconds.toFixed(1)} s. ${change === 'source' ? 'Copying manifests before source kept the slow npm ci layer cached.' : 'Everything after the first changed layer is invalidated, including npm ci.'}`
    : 'Nothing changed, so every layer comes from cache and the build finishes almost instantly.';
}

$$('#layer-toy [data-change]').forEach((button) =>
  button.addEventListener('click', () => {
    $$('#layer-toy [data-change]').forEach((other) => other.classList.toggle('active', other === button));
    renderLayers(button.dataset.change);
  }),
);
renderLayers('none');

const stateReplicas = 2;

function renderPlan() {
  const replicas = Number($('#plan-replicas').value);
  const rename = $('#plan-rename').checked;
  const replicasChanged = replicas !== stateReplicas;
  $('#plan-replicas-value').textContent = replicas;

  const lines = [];
  const line = (text, tone = '') => lines.push(`<span class="${tone}">${escapeHtml(text)}</span>`);
  const replicaLine = () => line(`      ~ replicas = ${stateReplicas} -> ${replicas}`, 'plan-change');

  if (rename) {
    line('  # kubernetes_namespace_v1.opslab must be replaced');
    line('-/+ resource "kubernetes_namespace_v1" "opslab" {', 'plan-replace');
    line('      ~ name = "opslab" -> "opslab-v2" # forces replacement', 'plan-replace');
    line('    }');
    ['kubernetes_config_map_v1.opslab_config', 'kubernetes_deployment_v1.opslab_api', 'kubernetes_service_v1.opslab_api'].forEach((address) => {
      const [type, name] = address.split('.');
      line(`  # ${address} must be replaced`);
      line(`-/+ resource "${type}" "${name}" {`, 'plan-replace');
      line('      ~ namespace = "opslab" -> "opslab-v2" # forces replacement', 'plan-replace');
      if (replicasChanged && name === 'opslab_api' && type.includes('deployment')) replicaLine();
      line('    }');
    });
    line('');
    line('Plan: 4 to add, 0 to change, 4 to destroy.', 'plan-summary');
    line('A namespace cannot be renamed in place, so everything inside it is destroyed and recreated.');
  } else if (replicasChanged) {
    line('  # kubernetes_deployment_v1.opslab_api will be updated in-place');
    line('  ~ resource "kubernetes_deployment_v1" "opslab_api" {', 'plan-change');
    replicaLine();
    line('    }');
    line('');
    line('Plan: 0 to add, 1 to change, 0 to destroy.', 'plan-summary');
    line(replicas === 0 ? 'Zero replicas is valid: the Deployment stays, but nothing serves traffic.' : 'Replica count can change in place; no pod template changed, so no rollout happens.');
  } else {
    line('No changes. Your infrastructure matches the configuration.', 'plan-summary');
  }
  $('#plan-output').innerHTML = lines.join('\n');
}

$('#plan-replicas').addEventListener('input', renderPlan);
$('#plan-rename').addEventListener('change', renderPlan);
renderPlan();

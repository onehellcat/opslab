'use strict';
// Operations console: live signals, incident lab, deployment lab, kubectl terminal and incident board.
// Loaded after app.js and shares its helpers. Lesson simulators and the tour live in learn.js.

/* ---------- Toast, confetti, badges and onboarding ---------- */

let toastTimer;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

// A short burst of paper squares from the middle of an element.
function celebrate(origin) {
  if (reducedMotion || !origin) return;
  const box = origin.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.style.left = box.left + box.width / 2 + 'px';
  layer.style.top = box.top + box.height / 2 + 'px';
  for (let index = 0; index < 22; index += 1) {
    const piece = document.createElement('i');
    const angle = (Math.PI * 2 * index) / 22;
    const distance = 60 + Math.random() * 90;
    piece.style.setProperty('--x', Math.cos(angle) * distance + 'px');
    piece.style.setProperty('--y', Math.sin(angle) * distance - 40 + 'px');
    piece.style.setProperty('--r', Math.random() * 540 - 270 + 'deg');
    piece.className = ['a', 'b', 'c'][index % 3];
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 1100);
}

const badges = {
  first: ['First request', 'Send a request from the API playground'],
  commander: ['Incident commander', 'Finish an incident lab'],
  captain: ['Release captain', 'Complete a rollout'],
  breaker: ['Build breaker', 'Fail the pipeline on purpose'],
  chaos: ['Chaos engineer', 'Inject a real fault'],
  operator: ['Terminal operator', 'Run five kubectl commands'],
  quiz: ['Quiz ace', 'Answer every lesson check correctly'],
  scholar: ['Scholar', 'Complete every lesson'],
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
  celebrate($('#toast'));
}

const onboarding = readStore('opslab-onboarding', {});
const onboardingBadges = { api: 'first', incident: 'commander', rollout: 'captain' };

function renderOnboarding() {
  const boxes = $$('[data-onboard]');
  boxes.forEach((box) => (box.checked = Boolean(onboarding[box.dataset.onboard])));
  $('#onboarding-progress').textContent = `${boxes.filter((box) => box.checked).length} / ${boxes.length} complete`;
}

function markOnboarding(key, done = true) {
  if (Boolean(onboarding[key]) === done) return;
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
let realFaultsAllowed = true;

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

function renderBudget(slo) {
  const left = Math.max(slo.budget_remaining, 0);
  const bar = $('#budget-bar');
  bar.style.width = left * 100 + '%';
  bar.className = left <= 0 ? 'out' : left < 0.5 ? 'warn' : '';
  $('#budget-value').textContent = slo.total === 0 ? 'no traffic yet' : left <= 0 ? 'exhausted' : `${Math.round(left * 100)}% left`;
}

function renderAlerts(alerts) {
  const firing = alerts.filter((alert) => alert.firing);
  $('#alert-list').innerHTML = firing.length
    ? firing.map((alert) => `<li class="${alert.severity}"><b>${alert.name}</b> ${escapeHtml(alert.detail)}</li>`).join('')
    : '<li class="quiet">No alerts firing</li>';
}

function applySummary(summary) {
  tweenNumber($('#stat-requests'), summary.http_requests_total);
  tweenNumber($('#stat-services'), summary.services_total);
  tweenNumber($('#stat-incidents'), summary.active_incidents);
  $('#stat-uptime').textContent = formatUptime(summary.uptime_seconds);
  $('#ops-incidents').textContent = summary.active_incidents;
  $('#ops-services').textContent = summary.services_total;
  $('#ops-instance').textContent = summary.instance;

  latencySeries.push(summary.recent.p95_ms);
  rateSeries.push(summary.recent.rate_per_second);
  if (latencySeries.length > sparkCapacity) latencySeries.shift();
  if (rateSeries.length > sparkCapacity) rateSeries.shift();
  $('#spark-latency-value').textContent = `${summary.recent.p95_ms} ms`;
  $('#spark-rate-value').textContent = summary.recent.rate_per_second.toFixed(1);
  drawSpark($('#spark-latency'), latencySeries);
  drawSpark($('#spark-rate'), rateSeries);
  $('.status-card').classList.toggle('fault-active', Boolean(summary.chaos.expiresAt));

  renderBudget(summary.slo);
  renderAlerts(summary.alerts);
  window.opslabTracing = summary.tracing;

  realFaultsAllowed = summary.chaos.enabled && !summary.chaos.tokenRequired;
  $('#real-chaos').disabled = !realFaultsAllowed;
  $('#real-chaos-label').textContent = realFaultsAllowed
    ? 'Inject it for real where possible (this API only, expires in 60 s)'
    : 'Real faults are switched off on this server, so the lab runs as a simulation';
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
    if (type === 'incident') loadBoard();
  }),
);

/* ---------- Incident lab ---------- */

// Each choice: [label, is it the right next step, what you learn from picking it].
// `fault` is what "Inject it for real" sends to /api/chaos; scenarios without one are simulation only.
const scenarios = {
  database: {
    name: 'Database latency',
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
  errors: {
    name: 'Error spike',
    title: 'Four in ten requests fail',
    brief: 'Support reports “something went wrong” pages. The HighErrorRate alert fired two minutes ago and the error budget is draining.',
    fault: { errorRate: 0.4 },
    steps: [
      {
        prompt: 'Observe — how bad is it, and for whom?',
        choices: [
          ['Error ratio by route, and the error budget', true, 'About 40% of data requests answer 500. Health endpoints are fine. The budget for the whole window is nearly gone.'],
          ['Wait for more customer reports', false, 'The alert already tells you users are affected. Waiting spends error budget for no new information.'],
          ['Look at average latency', false, 'Latency is normal: failing requests fail fast. The wrong signal can hide a serious incident.'],
        ],
      },
      {
        prompt: 'Inspect — what changed recently?',
        choices: [
          ['The deploy history and the event stream', true, 'A release went out five minutes before the alert. Changes are the most common cause of incidents.'],
          ['The Terraform state file', false, 'Infrastructure did not change. Start with what was released most recently.'],
          ['Yesterday’s traffic graph', false, 'Traffic is ordinary today. The timing points at the release, not at load.'],
        ],
      },
      {
        prompt: 'Localize — confirm the cause before acting.',
        choices: [
          ['Find a failing request in the logs by its request ID', true, 'The structured log line shows status 500 on the new version only. Pods on the old version answer 200.'],
          ['Restart the database', false, 'Nothing points at the database, and restarting it would turn 40% errors into 100%.'],
          ['Add more replicas', false, 'More copies of a broken version fail just as often.'],
        ],
      },
      {
        prompt: 'Recover — stop the bleeding.',
        choices: [
          ['Roll back the release, then debug it offline', true, 'Errors stop within a minute. Mitigate first; find the root cause once users are no longer affected.'],
          ['Debug the new version live in production', false, 'Every minute of debugging costs users errors. Restore service first.'],
          ['Silence the alert', false, 'The alert is correct. Silencing it hides the problem from the next person without fixing anything.'],
        ],
      },
    ],
  },
  readiness: {
    name: 'Failed readiness',
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
  crashloop: {
    name: 'Crash loop',
    title: 'A pod keeps restarting',
    brief: 'One of two pods shows CrashLoopBackOff with 14 restarts. Capacity is halved and the other pod is running hot.',
    steps: [
      {
        prompt: 'Observe — what is the pod actually doing?',
        choices: [
          ['kubectl get pods, and note status and restart count', true, 'CrashLoopBackOff means the container starts, exits, and Kubernetes waits longer before each retry.'],
          ['Delete the pod', false, 'The Deployment creates an identical replacement that crashes the same way. You have learned nothing.'],
          ['Increase replicas to compensate', false, 'New pods come from the same template and crash too.'],
        ],
      },
      {
        prompt: 'Inspect — where is the reason recorded?',
        choices: [
          ['kubectl logs --previous for the crashed container', true, 'The last lines before exit: “DATABASE_PASSWORD is required”. The current container has no logs yet; the previous one does.'],
          ['kubectl logs without --previous', false, 'The container has only just restarted, so its log is empty. The evidence is in the previous run.'],
          ['The node’s disk usage', false, 'Nothing suggests a node problem; one pod on the same node is healthy.'],
        ],
      },
      {
        prompt: 'Localize — why is the variable missing in this pod only?',
        choices: [
          ['Compare the pod’s env with the Secret it references', true, 'The pod template references a Secret key that was renamed. The healthy pod started before the rename.'],
          ['Blame the container image', false, 'Both pods run the same image, and one of them works.'],
          ['Raise the memory limit', false, 'The exit reason is a missing variable, not an out-of-memory kill.'],
        ],
      },
      {
        prompt: 'Recover — fix it without losing the healthy pod.',
        choices: [
          ['Correct the Secret key reference and roll out', true, 'New pods start cleanly. The old healthy pod kept serving until its replacement was Ready.'],
          ['Remove the liveness probe', false, 'The container exits by itself; the probe is not what is restarting it.'],
          ['Restart the healthy pod too', false, 'It would come back with the same broken configuration and you would have no capacity left.'],
        ],
      },
    ],
  },
  certificate: {
    name: 'Expired certificate',
    title: 'Browsers refuse to connect',
    brief: 'At 00:00 UTC every external request started failing. Internal health checks are green and nothing was deployed.',
    steps: [
      {
        prompt: 'Observe — what do users actually see?',
        choices: [
          ['Reproduce the request from outside the cluster', true, 'curl reports “certificate has expired”. The request never reaches the application.'],
          ['Check the application error rate', false, 'It is zero. Requests fail before they arrive, so the application has nothing to report.'],
          ['Restart the API', false, 'The API is healthy and is not receiving the failing traffic at all.'],
        ],
      },
      {
        prompt: 'Inspect — why are internal checks green?',
        choices: [
          ['They call the pod directly and skip TLS at the edge', true, 'Probes test the application, not the path users take. Monitoring from outside would have caught this.'],
          ['The probes are broken', false, 'They are working as designed. They simply do not cover the edge.'],
          ['The Service is misconfigured', false, 'Traffic inside the cluster flows normally.'],
        ],
      },
      {
        prompt: 'Localize — confirm the expiry.',
        choices: [
          ['Read the certificate’s notAfter date', true, 'It expired at midnight. An exact time with no deploy is the signature of something expiring.'],
          ['Look for a code change', false, 'There was none. Time-based failures need no change to happen.'],
          ['Check DNS', false, 'The name resolves and the connection opens; it is the TLS handshake that fails.'],
        ],
      },
      {
        prompt: 'Recover — and stop it happening again.',
        choices: [
          ['Renew the certificate, then automate renewal and alert on expiry', true, 'Service returns once the new certificate is served. An alert 14 days before expiry makes this a non-event next time.'],
          ['Tell users to click through the warning', false, 'That trains people to ignore the one check protecting them from interception.'],
          ['Disable TLS until morning', false, 'That exposes credentials and data in transit to fix an outage.'],
        ],
      },
    ],
  },
};

const wrongTurnSeconds = 120;
const game = { scenario: null, step: 0, started: 0, wrong: 0, timer: null, real: false };
const scenarioState = $('#scenario-state');
const scenarioPicker = $('#scenario-picker');

const formatClock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const gameSeconds = () => (Date.now() - game.started) / 1000 + game.wrong * wrongTurnSeconds;
const labHeaders = { 'content-type': 'application/json', 'x-opslab-role': 'operator' };

scenarioPicker.innerHTML = Object.entries(scenarios)
  .map(([key, scenario]) => `<button type="button" data-scenario="${key}">${scenario.name}${scenario.fault ? '<i title="Can be injected for real">●</i>' : ''}</button>`)
  .join('');

function renderBestTimes() {
  const best = readStore('opslab-best', {});
  const parts = Object.keys(scenarios).filter((key) => best[key]).map((key) => `${scenarios[key].name} ${formatClock(best[key])}`);
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
  // No JSON content type here: Fastify rejects an empty body that claims to be JSON.
  await fetch('/api/chaos', { method: 'DELETE', headers: { 'x-opslab-role': 'operator' } }).catch(() => {});
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
  next.focus({ preventScroll: true });
}

async function startGame(key) {
  await clearFault();
  clearInterval(game.timer);
  const scenario = scenarios[key];
  Object.assign(game, { scenario: key, step: 0, started: Date.now(), wrong: 0 });
  game.real = Boolean(scenario.fault) && $('#real-chaos').checked && realFaultsAllowed && (await injectFault(scenario.fault));

  scenarioState.textContent = game.real ? 'LIVE FAULT' : 'INCIDENT';
  scenarioState.className = 'state-alert';
  $('#scenario-title').textContent = scenario.title;
  $('#scenario-copy').textContent = scenario.brief + (game.real ? ' The fault is really active in this API: watch the snapshot, the alerts and the error budget.' : '');
  scenarioPicker.hidden = true;
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
  $('#game-feedback').textContent = 'Order that worked: observe impact, inspect signals, localize the failing boundary, take the smallest safe action.';
  $('#game-feedback').className = 'game-feedback right';
  scenarioPicker.hidden = false;
  renderBestTimes();
  celebrate($('#game-clock'));
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
  scenarioPicker.hidden = false;
  $('#incident-game').hidden = true;
}

$$('[data-scenario]').forEach((button) => button.addEventListener('click', () => startGame(button.dataset.scenario)));
$('#reset-scenario').addEventListener('click', resetGame);
renderBestTimes();

/* ---------- Deployment lab ---------- */

const strategyCopy = {
  rolling: 'Replace pods one at a time (<code>maxSurge 1</code>, <code>maxUnavailable 0</code>). A new pod must pass readiness before an old one leaves.',
  bluegreen: 'Start a complete second set of pods that receives no traffic. Once it is Ready, switch the Service over in one step.',
  canary: 'Send 10% of traffic to one new pod and watch its errors. If it stays healthy, grow to 50%, then 100%.',
};
const podGrid = $('#pod-grid');
const rolloutState = $('#rollout-state');
const rolloutNote = $('#rollout-note');
const rollout = { pods: [], version: 1, previous: 1, replicas: 2, strategy: 'rolling', busy: false, stalled: false, served: 0, failed: 0, sequence: 0 };

function setRolloutState(text, tone = '') {
  rolloutState.textContent = text;
  rolloutState.className = tone;
}

function podLabel(pod) {
  if (pod.phase === 'ready') return pod.weight > 0 ? 'Ready' : 'Ready · no traffic';
  return { pending: 'Pending', starting: 'Running · not ready', notready: 'Readiness 503', terminating: 'Terminating' }[pod.phase];
}

function renderPod(pod) {
  pod.element.className = `pod ${pod.phase}${pod.phase === 'ready' && pod.weight === 0 ? ' standby' : ''}${pod.failing ? ' failing' : ''}`;
  $('b', pod.element).textContent = podLabel(pod);
  $('small', pod.element).textContent = pod.errors ? `${pod.served} ok · ${pod.errors} err` : `${pod.served} req`;
}

function setPhase(pod, phase) {
  pod.phase = phase;
  renderPod(pod);
}

function setWeight(pod, weight) {
  pod.weight = weight;
  renderPod(pod);
}

function addPod(version, phase, { weight = 1, failing = false } = {}) {
  const element = document.createElement('div');
  element.innerHTML = `<i class="pod-pipe" aria-hidden="true"></i><span>v0.${version}</span><b></b><small></small>`;
  const pod = { version, phase, weight, failing, served: 0, errors: 0, created: Date.now(), element, name: `opslab-api-${(rollout.sequence += 1)}` };
  element.title = pod.name;
  renderPod(pod);
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

const servingPods = () => rollout.pods.filter((pod) => pod.phase === 'ready' && pod.weight > 0);

function renderSplit() {
  const serving = servingPods();
  const total = serving.reduce((sum, pod) => sum + pod.weight, 0) || 1;
  const stable = serving.filter((pod) => pod.version === rollout.version).reduce((sum, pod) => sum + pod.weight, 0);
  const candidate = serving.find((pod) => pod.version !== rollout.version);
  const stableShare = Math.round((stable / total) * 100);
  $('#split-old').style.width = stableShare + '%';
  $('#split-new').style.width = 100 - stableShare + '%';
  $('#split-old-label').textContent = `v0.${rollout.version} · ${stableShare}%`;
  $('#split-new-label').textContent = candidate ? `v0.${candidate.version} · ${100 - stableShare}%` : '';
}

// The Service sends each request to one Ready pod, in proportion to its weight.
setInterval(() => {
  const serving = servingPods();
  renderSplit();
  if (!opsVisible || document.hidden || serving.length === 0) return;

  let pick = Math.random() * serving.reduce((sum, pod) => sum + pod.weight, 0);
  const pod = serving.find((candidate) => (pick -= candidate.weight) <= 0) ?? serving[0];
  if (pod.failing) {
    pod.errors += 1;
    rollout.failed += 1;
  } else {
    pod.served += 1;
    rollout.served += 1;
  }
  renderPod(pod);
  $('#rollout-traffic').textContent = rollout.failed ? `${rollout.served} ok · ${rollout.failed} failed` : `${rollout.served} req`;
  if (!reducedMotion) {
    pod.element.classList.remove('hit');
    void pod.element.offsetWidth;
    pod.element.classList.add('hit');
  }
}, 220);

async function startPod(version, options) {
  const pod = addPod(version, 'pending', options);
  await pace(700);
  setPhase(pod, 'starting');
  await pace(1100);
  return pod;
}

// Each strategy resolves to 'complete', 'stalled' (needs a rollback) or 'aborted' (already safe).
const strategies = {
  async rolling(version, bad) {
    for (const old of rollout.pods.filter((pod) => pod.version !== version)) {
      rolloutNote.textContent = 'Surging one new pod. It receives no traffic until its readiness probe passes.';
      const fresh = await startPod(version);
      if (bad) {
        setPhase(fresh, 'notready');
        rolloutNote.textContent = `${fresh.name} answers readiness with 503, so the rollout stops here. The old pods keep serving every request. Roll back to recover.`;
        return 'stalled';
      }
      setPhase(fresh, 'ready');
      rolloutNote.textContent = `${fresh.name} is Ready and joins the Service. Now one v0.${old.version} pod can leave.`;
      await pace(700);
      await removePod(old);
    }
    return 'complete';
  },

  async bluegreen(version, bad) {
    const blue = [...rollout.pods];
    rolloutNote.textContent = `Starting a full green set (v0.${version}) beside blue. The Service still selects blue only.`;
    const green = await Promise.all(blue.map(() => startPod(version, { weight: 0 })));
    if (bad) {
      green.forEach((pod) => setPhase(pod, 'notready'));
      rolloutNote.textContent = 'Green never became Ready, so the switch never happened. Users saw nothing. Roll back to remove the green set.';
      return 'stalled';
    }
    green.forEach((pod) => setPhase(pod, 'ready'));
    rolloutNote.textContent = 'Green is Ready and idle. This is the moment to smoke-test it before any user arrives.';
    await pace(1600);
    green.forEach((pod) => setWeight(pod, 1));
    blue.forEach((pod) => setWeight(pod, 0));
    rolloutNote.textContent = 'Service selector switched: 100% of traffic moved to green in one step. Blue is kept briefly for an instant switch back.';
    await pace(1800);
    await Promise.all(blue.map(removePod));
    return 'complete';
  },

  async canary(version, bad) {
    const stable = [...rollout.pods];
    rolloutNote.textContent = 'Starting one canary pod.';
    const canary = await startPod(version, { weight: 0, failing: bad });
    setPhase(canary, 'ready');
    const share = (canaryShare) => {
      setWeight(canary, canaryShare);
      stable.forEach((pod) => setWeight(pod, (1 - canaryShare) / stable.length));
    };

    share(0.1);
    rolloutNote.textContent = 'Canary takes 10% of traffic. Analysis compares its error rate with the stable pods.';
    await pace(3200);
    if (bad) {
      rolloutNote.textContent = `Analysis failed: the canary returned ${canary.errors} error${canary.errors === 1 ? '' : 's'}. It was removed automatically, and only about one request in ten ever reached it.`;
      await removePod(canary);
      stable.forEach((pod) => setWeight(pod, 1));
      return 'aborted';
    }

    share(0.5);
    rolloutNote.textContent = 'Canary is healthy, so its share grows to 50%.';
    await pace(2400);
    const rest = await Promise.all(stable.slice(1).map(() => startPod(version, { weight: 0 })));
    rest.forEach((pod) => setPhase(pod, 'ready'));
    [canary, ...rest].forEach((pod) => setWeight(pod, 1));
    stable.forEach((pod) => setWeight(pod, 0));
    rolloutNote.textContent = 'Promoted to 100%. The old pods drain and leave.';
    await pace(900);
    await Promise.all(stable.map(removePod));
    return 'complete';
  },
};

async function startRollout() {
  if (rollout.busy) return;
  if (rollout.stalled) {
    rolloutNote.textContent = 'The rollout is stalled on an unready pod. Roll back before starting another.';
    return;
  }
  rollout.busy = true;
  const target = rollout.version + 1;
  setRolloutState('PROGRESSING', 'state-alert');
  const outcome = await strategies[rollout.strategy](target, $('#bad-release').checked);

  if (outcome === 'complete') {
    rollout.previous = rollout.version;
    rollout.version = target;
    setRolloutState('COMPLETE', 'state-ok');
    rolloutNote.textContent = `v0.${target} is fully available. Capacity never dropped below ${rollout.replicas} Ready pods.`;
    celebrate(podGrid);
    markOnboarding('rollout');
  } else if (outcome === 'stalled') {
    rollout.stalled = true;
    setRolloutState('STALLED', 'state-error');
  } else {
    setRolloutState('ABORTED', 'state-alert');
  }
  rollout.busy = false;
}

async function rollBack() {
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
    rolloutNote.textContent = `The unready pods are gone and v0.${rollout.version} never stopped serving. Users saw no errors.`;
  } else {
    const target = rollout.previous;
    await strategies.rolling(target, false);
    rollout.previous = rollout.version = target;
    rolloutNote.textContent = `v0.${target} is serving again. A real rollback restores the pod template only, so check data compatibility too.`;
  }
  setRolloutState('ROLLED BACK', 'state-ok');
  rollout.busy = false;
}

async function scaleTo(replicas) {
  rollout.replicas = replicas;
  const current = rollout.pods.filter((pod) => pod.version === rollout.version && pod.phase !== 'terminating');
  if (current.length < replicas) {
    const added = await Promise.all(Array.from({ length: replicas - current.length }, () => startPod(rollout.version)));
    added.forEach((pod) => setPhase(pod, 'ready'));
  } else {
    await Promise.all(current.slice(replicas).map(removePod));
  }
}

function setStrategy(strategy) {
  if (rollout.busy) return;
  rollout.strategy = strategy;
  $$('#rollout-strategy button').forEach((button) => button.classList.toggle('active', button.dataset.strategy === strategy));
  $('#strategy-copy').innerHTML = strategyCopy[strategy];
}

$$('#rollout-strategy button').forEach((button) => button.addEventListener('click', () => setStrategy(button.dataset.strategy)));
$('#start-rollout').addEventListener('click', startRollout);
$('#rollback').addEventListener('click', rollBack);
setStrategy('rolling');
addPod(1, 'ready');
addPod(1, 'ready');
renderSplit();

/* ---------- kubectl terminal (reads the deployment lab above) ---------- */

const kubectlScreen = $('#kubectl-screen');
const kubectlInput = $('#kubectl-input');
const kubectlHistory = [];
const kubectlUsed = new Set();
let historyIndex = 0;

const column = (value, width) => String(value).padEnd(width);
const podAge = (pod) => formatUptime(Math.max(1, Math.round((Date.now() - pod.created) / 1000)));
const podStatus = (pod) => ({ pending: 'Pending', starting: 'Running', notready: 'Running', ready: 'Running', terminating: 'Terminating' })[pod.phase];
const podIp = (pod) => `10.42.0.${10 + Number(pod.name.split('-').pop())}`;
const findPod = (name) => rollout.pods.find((pod) => pod.name === name);

function describePod(pod) {
  const events = {
    pending: ['Normal   Scheduled  Successfully assigned opslab/' + pod.name + ' to k3d-opslab-agent-0'],
    starting: ['Normal   Started    Started container opslab-api', 'Normal   Probing    Waiting for readiness probe (initialDelaySeconds 5)'],
    ready: ['Normal   Started    Started container opslab-api', 'Normal   Ready      Readiness probe succeeded: HTTP 200'],
    notready: ['Normal   Started    Started container opslab-api', 'Warning  Unhealthy  Readiness probe failed: HTTP probe failed with statuscode: 503'],
    terminating: ['Normal   Killing    Stopping container opslab-api'],
  }[pod.phase];
  return [
    `Name:         ${pod.name}`,
    'Namespace:    opslab',
    `Image:        opslab-api:v0.${pod.version}`,
    `Status:       ${podStatus(pod)}`,
    `IP:           ${podIp(pod)}`,
    `Ready:        ${pod.phase === 'ready' ? 'True' : 'False'}`,
    'Restarts:     0',
    'Events:',
    ...events.map((event) => '  ' + event),
  ];
}

function podLogs(pod) {
  if (pod.phase === 'pending') return ['Error from server (BadRequest): container "opslab-api" is waiting to start: ContainerCreating'];
  const line = (status, route) => `{"level":30,"route":"${route}","statusCode":${status},"durationMs":${status === 200 ? 2 : 1},"msg":"request completed"}`;
  if (pod.phase === 'notready') return ['{"level":30,"msg":"OpsLab API listening on http://0.0.0.0:3000"}', line(503, '/health/ready'), line(503, '/health/ready')];
  return ['{"level":30,"msg":"OpsLab API listening on http://0.0.0.0:3000"}', line(200, '/health/ready'), line(pod.failing ? 500 : 200, '/api/services')];
}

function rolloutStatus() {
  if (rollout.stalled) return ['Waiting for deployment "opslab-api" rollout to finish: 1 out of ' + rollout.replicas + ' new replicas have been updated...', 'error: deployment "opslab-api" exceeded its progress deadline'];
  if (rollout.busy) return ['Waiting for deployment "opslab-api" rollout to finish: 1 old replicas are pending termination...'];
  return ['deployment "opslab-api" successfully rolled out'];
}

// Returns the output lines for one command. Unknown input gets the same hint kubectl would give.
function runKubectl(input) {
  const args = input
    .replace(/^k\s/, 'kubectl ')
    .replace(/\s(-n|--namespace)[ =]\S+/g, '')
    .trim()
    .split(/\s+/);
  if (args[0] === 'help' || input === 'kubectl' || args[1] === 'help') {
    return ['Try:', '  kubectl get pods | deploy | svc | endpoints', '  kubectl describe pod <name>', '  kubectl logs <name>', '  kubectl rollout status|undo deployment/opslab-api', '  kubectl set image deployment/opslab-api opslab-api=opslab-api:next', '  kubectl scale deployment/opslab-api --replicas=3', '  clear'];
  }
  if (args[0] !== 'kubectl') return [`${args[0]}: command not found. This terminal only understands kubectl (try "help").`];

  const [, verb, kind = '', name = ''] = args;
  const ready = rollout.pods.filter((pod) => pod.phase === 'ready');

  if (verb === 'get' && /^(po|pod|pods)$/.test(kind)) {
    return [
      column('NAME', 18) + column('READY', 8) + column('STATUS', 13) + column('RESTARTS', 10) + 'AGE',
      ...rollout.pods.map((pod) => column(pod.name, 18) + column(pod.phase === 'ready' ? '1/1' : '0/1', 8) + column(podStatus(pod), 13) + column(0, 10) + podAge(pod)),
      column('postgres-0', 18) + column('1/1', 8) + column('Running', 13) + column(0, 10) + '2d',
    ];
  }
  if (verb === 'get' && /^(deploy|deployment|deployments)$/.test(kind)) {
    const updated = rollout.pods.filter((pod) => pod.version === Math.max(...rollout.pods.map((other) => other.version))).length;
    return [column('NAME', 14) + column('READY', 8) + column('UP-TO-DATE', 13) + 'AVAILABLE', column('opslab-api', 14) + column(`${ready.length}/${rollout.replicas}`, 8) + column(updated, 13) + ready.length];
  }
  if (verb === 'get' && /^(svc|service|services)$/.test(kind)) {
    return [column('NAME', 14) + column('TYPE', 12) + column('CLUSTER-IP', 15) + 'PORT(S)', column('opslab-api', 14) + column('ClusterIP', 12) + column('10.43.12.80', 15) + '80/TCP', column('postgres', 14) + column('ClusterIP', 12) + column('None', 15) + '5432/TCP'];
  }
  if (verb === 'get' && /^(ep|endpoints)$/.test(kind)) {
    return [column('NAME', 14) + 'ENDPOINTS', column('opslab-api', 14) + (servingPods().map((pod) => podIp(pod) + ':3000').join(',') || '<none>'), column('postgres', 14) + '10.42.0.5:5432'];
  }
  if (verb === 'describe' && /^(po|pod|pods)$/.test(kind)) {
    const pod = findPod(name);
    return pod ? describePod(pod) : [`Error from server (NotFound): pods "${name || '<name>'}" not found`];
  }
  if (verb === 'logs') {
    const pod = findPod(kind);
    return pod ? podLogs(pod) : [`Error from server (NotFound): pods "${kind || '<name>'}" not found`];
  }
  if (verb === 'rollout' && kind === 'status') return rolloutStatus();
  if (verb === 'rollout' && kind === 'undo') {
    rollBack();
    return ['deployment.apps/opslab-api rolled back'];
  }
  if (verb === 'set' && kind === 'image') {
    if (rollout.busy || rollout.stalled) return ['error: a rollout is already in progress; check "kubectl rollout status deployment/opslab-api"'];
    startRollout();
    return ['deployment.apps/opslab-api image updated', `(the deployment lab above is rolling out with the ${rollout.strategy} strategy)`];
  }
  if (verb === 'scale') {
    const replicas = Number((input.match(/--replicas[= ](\d+)/) || [])[1]);
    if (!Number.isInteger(replicas) || replicas < 1 || replicas > 6) return ['error: this lab supports --replicas between 1 and 6'];
    if (rollout.busy || rollout.stalled) return ['error: finish or roll back the current rollout before scaling'];
    scaleTo(replicas);
    return ['deployment.apps/opslab-api scaled'];
  }
  return [`error: unknown command "${args.slice(1).join(' ')}" (try "help")`];
}

function printKubectl(command, lines) {
  const prompt = document.createElement('div');
  prompt.className = 'prompt-line';
  prompt.textContent = '$ ' + command;
  const output = document.createElement('pre');
  output.textContent = lines.join('\n');
  if (lines[0]?.toLowerCase().startsWith('error')) output.className = 'error';
  kubectlScreen.append(prompt, output);
  kubectlScreen.scrollTop = kubectlScreen.scrollHeight;
}

function submitKubectl(command) {
  if (!command) return;
  kubectlHistory.push(command);
  historyIndex = kubectlHistory.length;
  if (command === 'clear') {
    kubectlScreen.innerHTML = '';
    return;
  }
  const lines = runKubectl(command);
  printKubectl(command, lines);
  if (command.startsWith('kubectl') && !lines[0]?.toLowerCase().startsWith('error')) kubectlUsed.add(command.split(/\s+/).slice(0, 3).join(' '));
  if (kubectlUsed.size >= 5) earnBadge('operator');
}

$('#kubectl-form').addEventListener('submit', (event) => {
  event.preventDefault();
  submitKubectl(kubectlInput.value.trim());
  kubectlInput.value = '';
});

kubectlInput.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  historyIndex = Math.min(kubectlHistory.length, Math.max(0, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
  kubectlInput.value = kubectlHistory[historyIndex] ?? '';
});

const kubectlSuggestions = ['kubectl get pods', 'kubectl describe pod', 'kubectl rollout status deployment/opslab-api', 'kubectl get endpoints', 'kubectl scale deployment/opslab-api --replicas=3', 'kubectl set image deployment/opslab-api opslab-api=opslab-api:next', 'kubectl rollout undo deployment/opslab-api'];
$('#kubectl-chips').innerHTML = kubectlSuggestions.map((command) => `<button type="button">${command}</button>`).join('');
$$('#kubectl-chips button').forEach((chip) =>
  chip.addEventListener('click', () => {
    // "describe pod" needs a name: use the newest pod, which is usually the interesting one.
    const newest = rollout.pods[rollout.pods.length - 1];
    submitKubectl(chip.textContent === 'kubectl describe pod' && newest ? `kubectl describe pod ${newest.name}` : chip.textContent);
  }),
);
printKubectl('kubectl get pods', runKubectl('kubectl get pods'));

/* ---------- Incident board (real incidents from the API) ---------- */

const boardList = $('#board-list');
const nextStatus = { open: ['investigating', 'Investigate'], investigating: ['resolved', 'Resolve'], resolved: ['open', 'Reopen'] };

function boardHeaders() {
  return { 'content-type': 'application/json', 'x-opslab-role': $('#operator-role').value };
}

async function boardRequest(url, options) {
  const response = await fetch(url, { ...options, headers: boardHeaders() });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
  return body;
}

async function loadBoard() {
  try {
    const { incidents } = await (await fetch('/api/incidents')).json();
    const order = { open: 0, investigating: 1, resolved: 2 };
    const active = incidents.filter((incident) => incident.status !== 'resolved').length;
    $('#board-count').textContent = `${active} ACTIVE · ${incidents.length} TOTAL`;
    boardList.innerHTML = '';

    [...incidents]
      .sort((a, b) => order[a.status] - order[b.status])
      .slice(0, 7)
      .forEach((incident) => {
        const row = document.createElement('li');
        row.className = `status-${incident.status}`;
        const [target, label] = nextStatus[incident.status] ?? nextStatus.open;
        row.innerHTML = `<span class="sev sev-${escapeHtml(incident.severity)}">${escapeHtml(incident.severity)}</span><div><b></b><small>${escapeHtml(incident.id)} · ${escapeHtml(incident.status)}</small></div><button type="button">${label}</button>`;
        $('b', row).textContent = incident.title;
        $('button', row).addEventListener('click', async () => {
          try {
            await boardRequest(`/api/incidents/${encodeURIComponent(incident.id)}`, { method: 'PATCH', body: JSON.stringify({ status: target }) });
            loadBoard();
          } catch (error) {
            showToast(error.message);
          }
        });
        boardList.append(row);
      });
  } catch {
    $('#board-count').textContent = 'OFFLINE';
  }
}

$('#board-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = $('#board-title');
  try {
    await boardRequest('/api/incidents', { method: 'POST', body: JSON.stringify({ title: title.value.trim(), severity: $('#board-severity').value, status: 'open' }) });
    title.value = '';
    loadBoard();
  } catch (error) {
    showToast(error.message);
  }
});
loadBoard();

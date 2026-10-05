'use strict';
// Lesson simulators, lesson checks and the guided tour. Loaded after app.js and labs.js.

/* ---------- Docker layer cache ---------- */

// [instruction, seconds to rebuild]
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

/* ---------- Terraform plan ---------- */

const stateReplicas = 2;
const namespacedResources = [
  'kubernetes_config_map_v1.opslab_config',
  'kubernetes_secret_v1.opslab_db',
  'kubernetes_service_v1.postgres',
  'kubernetes_stateful_set_v1.postgres',
  'kubernetes_deployment_v1.opslab_api',
  'kubernetes_service_v1.opslab_api',
  'kubernetes_pod_disruption_budget_v1.opslab_api',
];

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
    namespacedResources.forEach((address) => {
      const [type, name] = address.split('.');
      line(`-/+ resource "${type}" "${name}" {`, 'plan-replace');
      line('      ~ namespace = "opslab" -> "opslab-v2" # forces replacement', 'plan-replace');
      if (replicasChanged && type.includes('deployment')) replicaLine();
      line('    }');
    });
    line('');
    line(`Plan: ${namespacedResources.length + 1} to add, 0 to change, ${namespacedResources.length + 1} to destroy.`, 'plan-summary');
    line('A namespace cannot be renamed in place, so everything inside it is destroyed and recreated,');
    line('including the database StatefulSet. Read a plan like this twice before applying it.');
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

/* ---------- Secret inspector ---------- */

const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

function renderSecret(decoded = false) {
  const value = $('#secret-input').value;
  const encoded = toBase64(value);
  $('#secret-output').innerHTML = [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: opslab-db',
    'data:',
    `  password: <span class="plan-change">${escapeHtml(encoded)}</span>`,
    decoded ? `\n$ echo ${escapeHtml(encoded)} | base64 -d\n<span class="plan-replace">${escapeHtml(value)}</span>` : '',
  ].join('\n');
  $('#secret-result').textContent = decoded
    ? 'Decoded with one command and no key. base64 only makes the value safe to put in YAML; it protects nothing.'
    : 'It looks scrambled, but press “Decode it back”.';
}

$('#secret-input').addEventListener('input', () => renderSecret());
$('#secret-decode').addEventListener('click', () => renderSecret(true));
renderSecret();

/* ---------- Autoscaler ---------- */

const hpa = { replicas: 2, target: 60, perPod: 50, min: 2, max: 8, timer: null };

function renderHpa(load) {
  const utilisation = Math.round((load / (hpa.replicas * hpa.perPod)) * 100);
  const desired = Math.min(hpa.max, Math.max(hpa.min, Math.ceil((hpa.replicas * utilisation) / hpa.target)));
  $('#hpa-load-value').textContent = load;
  $('#hpa-pods').innerHTML = Array.from({ length: hpa.replicas }, () => {
    const tone = utilisation > 100 ? 'over' : utilisation > hpa.target ? 'hot' : '';
    return `<div class="${tone}"><i style="height:${Math.min(utilisation, 100)}%"></i><span>${Math.min(utilisation, 999)}%</span></div>`;
  }).join('');

  const formula = `ceil(${hpa.replicas} × ${utilisation}% ÷ ${hpa.target}%) = ${Math.ceil((hpa.replicas * utilisation) / hpa.target)}`;
  if (desired === hpa.replicas) {
    $('#hpa-result').textContent =
      utilisation > 100 && hpa.replicas === hpa.max
        ? `At the maximum of ${hpa.max} replicas and still at ${utilisation}% CPU: requests are being dropped. Scaling out has a ceiling.`
        : `${hpa.replicas} replicas at ${utilisation}% CPU. ${formula}, so nothing changes.`;
    return;
  }

  $('#hpa-result').textContent = `${hpa.replicas} replicas at ${utilisation}% CPU. ${formula}: scaling ${desired > hpa.replicas ? 'up' : 'down'} to ${desired}…`;
  clearTimeout(hpa.timer);
  // Scale-up reacts quickly; scale-down waits, as the real controller does.
  hpa.timer = setTimeout(() => {
    hpa.replicas = desired;
    renderHpa(Number($('#hpa-load').value));
  }, reducedMotion ? 0 : desired > hpa.replicas ? 700 : 1800);
}

$('#hpa-load').addEventListener('input', (event) => renderHpa(Number(event.target.value)));
renderHpa(40);

/* ---------- GitOps reconcile loop ---------- */

const gitops = { desired: 2, actual: 2, timer: null };

function gitopsLog(message) {
  const row = document.createElement('li');
  row.textContent = message;
  $('#gitops-log').prepend(row);
  if ($('#gitops-log').children.length > 5) $('#gitops-log').lastElementChild.remove();
}

function renderGitops() {
  const synced = gitops.desired === gitops.actual;
  $('#gitops-desired').textContent = `replicas: ${gitops.desired}`;
  $('#gitops-pods').innerHTML = Array.from({ length: gitops.actual }, () => '<i></i>').join('');
  $('#gitops-status').textContent = synced ? 'Synced' : 'OutOfSync';
  $('#gitops-status').className = synced ? 'synced' : 'drifted';
}

function reconcile(reason) {
  renderGitops();
  clearTimeout(gitops.timer);
  if (gitops.desired === gitops.actual) return;
  gitops.timer = setTimeout(() => {
    gitopsLog(`controller: ${reason}; setting replicas ${gitops.actual} → ${gitops.desired}`);
    gitops.actual = gitops.desired;
    renderGitops();
  }, reducedMotion ? 0 : 1800);
}

$('#gitops-drift').addEventListener('click', () => {
  gitops.actual = 5;
  gitopsLog('you: kubectl scale --replicas=5 (not in Git)');
  reconcile('cluster drifted from Git');
});
$('#gitops-commit').addEventListener('click', () => {
  gitops.desired = gitops.desired === 4 ? 2 : 4;
  $('#gitops-commit').textContent = `Commit replicas: ${gitops.desired === 4 ? 2 : 4}`;
  gitopsLog(`you: merged commit "replicas: ${gitops.desired}"`);
  reconcile('new commit detected');
});
$('#gitops-reset').addEventListener('click', () => {
  clearTimeout(gitops.timer);
  Object.assign(gitops, { desired: 2, actual: 2 });
  $('#gitops-commit').textContent = 'Commit replicas: 4';
  $('#gitops-log').innerHTML = '';
  renderGitops();
});
renderGitops();

/* ---------- Lesson checks ---------- */

// One question per lesson: [question, options, index of the right option, why].
const quizzes = {
  container: ['You delete a running container. What happens to its image?', ['The image is deleted too', 'Nothing: the image is unchanged', 'The image loses its top layer'], 1, 'An image is an immutable blueprint. Containers are disposable instances created from it.'],
  health: ['The database is down for two minutes. What should the API’s liveness probe report?', ['Failure, so the pod restarts', 'Success: the process itself is fine', 'It should stop responding'], 1, 'Restarting the API cannot repair the database. Readiness, not liveness, should take the pod out of traffic.'],
  iac: ['Someone edits the Deployment by hand with kubectl. What does the next terraform plan show?', ['Nothing, Terraform ignores manual edits', 'A change that puts the configuration’s value back', 'An error that stops Terraform'], 1, 'Terraform treats configuration as the owner. It detects the drift and proposes to undo it.'],
  networking: ['Inside the api container, what does localhost:5432 point to?', ['The postgres container', 'Your laptop', 'The api container itself'], 2, 'Each container has its own network namespace. Peers are reached by service name, such as postgres:5432.'],
  rollouts: ['A new pod never passes readiness during a rolling update. What do users see?', ['Errors until someone intervenes', 'Nothing: the old pods keep serving', 'Half of requests fail'], 1, 'With maxUnavailable 0 an old pod only leaves after a new one is Ready, so a bad release stalls safely.'],
  observability: ['Which label would be dangerous to add to a request counter?', ['HTTP method', 'Route template', 'User ID'], 2, 'Every distinct label value is a new time series. Unbounded values like user IDs can overwhelm the metrics store.'],
  config: ['A Secret value in a manifest is base64. What does that protect against?', ['Anyone reading the manifest', 'Nothing: it is an encoding, not encryption', 'Other pods in the namespace'], 1, 'base64 is reversible by anyone. Protection comes from access control and encryption at rest.'],
  autoscaling: ['Two pods run at 90% CPU and the target is 60%. How many replicas does the autoscaler want?', ['2', '3', '4'], 1, 'ceil(2 × 90 ÷ 60) = 3. The same formula scales down when usage drops.'],
  gitops: ['Under GitOps, an engineer scales the Deployment by hand at 3 a.m. What happens next?', ['The change stays until someone reverts it', 'The controller puts back what Git declares', 'Git is updated automatically'], 1, 'Git is the source of truth. Lasting changes have to be committed, even emergency ones.'],
};
const quizPassed = new Set(readStore('opslab-quiz', []));

lessonCards.forEach((card) => {
  const quiz = quizzes[card.dataset.lesson];
  if (!quiz) return;
  const [question, options, answer, why] = quiz;
  const box = document.createElement('div');
  box.className = 'lesson-quiz';
  box.innerHTML = `<span>CHECK YOURSELF</span><p>${question}</p><div class="quiz-options"></div><p class="quiz-feedback" aria-live="polite"></p>`;

  options.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      const feedback = $('.quiz-feedback', box);
      if (index !== answer) {
        button.classList.add('wrong');
        button.disabled = true;
        feedback.textContent = 'Not quite. Re-read the panels above and try again.';
        feedback.className = 'quiz-feedback wrong';
        return;
      }
      $$('button', box).forEach((other) => (other.disabled = true));
      button.classList.add('right');
      feedback.textContent = `✓ ${why}`;
      feedback.className = 'quiz-feedback right';
      const wasDone = card.classList.contains('completed');
      card.setComplete(true);
      if (!wasDone) celebrate(button);
      quizPassed.add(card.dataset.lesson);
      writeStore('opslab-quiz', [...quizPassed]);
      if (quizPassed.size === Object.keys(quizzes).length) earnBadge('quiz');
    });
    $('.quiz-options', box).append(button);
  });
  $('.lesson-details', card).insertBefore(box, $('.lesson-experiment', card));
});

/* ---------- Guided tour ---------- */

const tourSteps = [
  ['#pipeline .pipeline-shell', 'Start with the pipeline', 'Press “Run pipeline” to watch a commit pass four stages. Tick “Break the build” to see a failed check stop it.'],
  ['#architecture .arch-card', 'See where it runs', 'Switch between Docker Compose, Kubernetes and Terraform. Click any box to learn what it does and where it is configured.'],
  ['#request-path .trace-shell', 'Follow one request', '“Trace request” sends a real request and draws where the time went, measured by the API itself.'],
  ['#lesson-grid', 'Nine short lessons', 'Each opens into explanations, a simulator to play with, and one question that marks it done.'],
  ['.ops-grid', 'Then operate it', 'Watch live signals, diagnose an incident against the clock, and steer a rollout with three strategies.'],
  ['.ops-pair', 'Hands on the controls', 'Type kubectl commands against the deployment lab, and manage real incidents on the board.'],
];
const tour = $('#tour');
let tourIndex = 0;

function placeTour() {
  if (tour.hidden) return;
  const box = $(tourSteps[tourIndex][0]).getBoundingClientRect();
  const ring = $('#tour-ring');
  const top = Math.max(box.top - 8, 8);
  const height = Math.min(box.bottom, innerHeight - 8) - top + 8;
  Object.assign(ring.style, { top: top + 'px', left: Math.max(box.left - 8, 4) + 'px', width: Math.min(box.width + 16, innerWidth - 8) + 'px', height: Math.max(height, 40) + 'px' });
}

function showTourStep(index) {
  tourIndex = index;
  const [selector, title, text] = tourSteps[index];
  $('#tour-step').textContent = `${index + 1} / ${tourSteps.length}`;
  $('#tour-title').textContent = title;
  $('#tour-text').textContent = text;
  $('#tour-back').disabled = index === 0;
  $('#tour-next').textContent = index === tourSteps.length - 1 ? 'Finish' : 'Next →';
  $(selector).scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  placeTour();
}

function endTour() {
  tour.hidden = true;
  $('#start-tour').focus({ preventScroll: true });
}

$('#start-tour').addEventListener('click', () => {
  tour.hidden = false;
  showTourStep(0);
  $('#tour-next').focus({ preventScroll: true });
});
$('#tour-next').addEventListener('click', () => (tourIndex === tourSteps.length - 1 ? endTour() : showTourStep(tourIndex + 1)));
$('#tour-back').addEventListener('click', () => showTourStep(tourIndex - 1));
$('#tour-skip').addEventListener('click', endTour);
document.addEventListener('keydown', (event) => event.key === 'Escape' && !tour.hidden && endTour());
addEventListener('scroll', placeTour, { passive: true });
addEventListener('resize', placeTour);

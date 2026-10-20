'use strict';
// Guide behaviour: pipeline, architecture, request trace, lessons and API playground.
// Teaching copy lives in content.js; the operations labs live in labs.js.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pace = (ms) => wait(reducedMotion ? 0 : ms);

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function readStore(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may block storage; progress is then kept for this page view only.
  }
}

async function copyText(text, label, original) {
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied ✓';
  } catch {
    label.textContent = 'Copy blocked';
  }
  setTimeout(() => (label.textContent = original), 1600);
}

function factGrid(className, facts) {
  return `<div class="${className}">${facts.map(([name, value]) => `<div><span>${name}</span><b>${value}</b></div>`).join('')}</div>`;
}

function explanation(why, verify) {
  return `<div class="explanation"><span>WHY IT MATTERS</span><p>${why}</p><div class="verify-step"><span>VERIFY IN THE PROJECT</span><p>${verify}</p></div></div>`;
}

/* ---------- Pipeline ---------- */

const stageDetail = $('#stage-detail');
const stageButtons = $$('.stage');
const runButton = $('#run-pipeline');
const breakBuild = $('#break-build');
const trackProgress = $('.track-progress');

function logLineClass(line) {
  if (line.startsWith('✓')) return 'success';
  if (line.startsWith('✗') || line.startsWith('   ')) return 'failure';
  return 'muted';
}

// Renders a stage and returns once its terminal output has finished appearing.
async function showStage(key, { stream = false, fail = false } = {}) {
  const stage = stages[key];
  const log = stageLogs[key];
  const lines = fail && log.fail ? log.fail : log.lines;

  stageButtons.forEach((button) => button.classList.toggle('active', button.dataset.stage === key));
  stageDetail.innerHTML =
    `<div><span class="detail-kicker">${stage.kicker}</span><h3>${stage.title}</h3>` +
    `<span class="explanation-label">WHAT HAPPENS</span><p>${stage.body}</p>` +
    explanation(stage.why, stage.verify) +
    factGrid('stage-facts', stage.facts) +
    '</div><div class="terminal"><div class="terminal-head"><span></span><span></span><span></span><b>.github/workflows/ci.yml</b></div>' +
    `<pre><code><span class="prompt">$</span> ${escapeHtml(stage.command)}\n</code></pre>` +
    `<div class="terminal-yaml"><b>WORKFLOW THAT RUNS THIS</b><pre>${log.yaml.map(escapeHtml).join('\n')}</pre></div></div>`;

  const code = $('code', stageDetail);
  for (const line of lines) {
    if (stream) await pace(260);
    const row = document.createElement('span');
    row.className = logLineClass(line);
    row.textContent = line + '\n';
    code.append(row);
  }
}

async function runPipeline() {
  const shouldFail = breakBuild.checked;
  runButton.disabled = true;
  runButton.innerHTML = '<span>◌</span> Running…';
  stageButtons.forEach((button) => button.classList.remove('done', 'running', 'failed', 'skipped'));
  trackProgress.style.width = '0';

  let failedAt = -1;
  for (const [index, button] of stageButtons.entries()) {
    const fails = shouldFail && button.dataset.stage === 'verify';
    button.classList.add('running');
    await showStage(button.dataset.stage, { stream: true, fail: fails });
    await pace(300);
    button.classList.remove('running');
    if (fails) {
      button.classList.add('failed');
      failedAt = index;
      break;
    }
    button.classList.add('done');
    trackProgress.style.width = (index / (stageButtons.length - 1)) * 100 + '%';
  }

  if (failedAt >= 0) {
    stageButtons.slice(failedAt + 1).forEach((button) => button.classList.add('skipped'));
    earnBadge('breaker');
  }
  $('#pipeline-result').textContent = failedAt >= 0
    ? 'Failed at Verify: no image was built, so nothing broken can be deployed.'
    : 'All four stages passed. The image is ready to deploy.';
  runButton.disabled = false;
  runButton.innerHTML = '<span>↻</span> Run again';
}

stageButtons.forEach((button) => button.addEventListener('click', () => showStage(button.dataset.stage)));
runButton.addEventListener('click', runPipeline);
showStage('checkout');

/* ---------- Architecture ---------- */

function inspectNode(view, key) {
  const [title, body, facts, source, why, verify] = view.nodes[key];
  $('#concept-panel').innerHTML =
    `<span>SELECTED COMPONENT</span><h3>${title}</h3><span class="explanation-label">WHAT HAPPENS</span><p>${body}</p>` +
    explanation(why, verify) +
    factGrid('tech-grid', facts) +
    `<p class="source-ref">SOURCE · ${source}</p>`;
}

function renderView(key) {
  const view = views[key];
  const diagram = $('#diagram');
  diagram.innerHTML = view.html;
  inspectNode(view, view.first);

  $$('.node', diagram).forEach((node) => {
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    const select = () => {
      $$('.node', diagram).forEach((other) => other.classList.remove('active'));
      node.classList.add('active');
      inspectNode(view, node.dataset.node);
    };
    node.addEventListener('click', select);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
  });
}

$$('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('.tab').forEach((other) => other.classList.remove('active'));
    tab.classList.add('active');
    renderView(tab.dataset.view);
  }),
);
renderView('compose');

/* ---------- Request trace ---------- */

const traceDetail = $('#trace-detail');
const traceHops = $$('.trace-hop');
const traceButton = $('#run-trace');
const traceProgress = $('#trace-progress');

function showHop(key) {
  const hop = hops[key];
  traceHops.forEach((button) => button.classList.toggle('active', button.dataset.hop === key));
  traceDetail.innerHTML =
    `<div><span class="detail-kicker">${hop.kicker}</span><h3>${hop.title}</h3>` +
    `<span class="explanation-label">WHAT HAPPENS</span><p>${hop.body}</p>${explanation(hop.why, hop.verify)}</div>` +
    factGrid('protocol-stack', hop.facts);
}

// "db;dur=1.2, total;dur=3.4" → { db: 1.2, total: 3.4 }
function parseServerTiming(header) {
  const timings = {};
  (header || '').split(',').forEach((part) => {
    const match = part.trim().match(/^([\w-]+);dur=([\d.]+)/);
    if (match) timings[match[1]] = Number(match[2]);
  });
  return timings;
}

function renderWaterfall(result) {
  const server = result.timing;
  const total = Math.max(result.ms, server.total ?? 0, 1);
  const serverTotal = Math.min(server.total ?? 0, total);
  const network = Math.max(total - serverTotal, 0);
  const chaos = server.chaos ?? 0;
  const store = Math.min(server.db ?? 0, serverTotal);
  const handler = Math.max(serverTotal - chaos - store, 0);

  const spans = [
    ['Network + port publish', network / 2, ''],
    ['Injected latency (lab)', chaos, 'warn'],
    ['Fastify handler', handler, ''],
    ['Store query', store, 'warn'],
    ['Response to browser', network / 2, ''],
  ].filter(([name, ms]) => ms > 0.05 || name === 'Store query');

  let offset = 0;
  const rows = spans.map(([name, ms, tone]) => {
    const row = `<div class="wf-row"><b>${name}</b><div class="wf-track"><i class="${tone}" style="left:${(offset / total) * 100}%;width:${Math.max((ms / total) * 100, 0.8)}%"></i></div><small>${ms.toFixed(1)} ms</small></div>`;
    offset += ms;
    return row;
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => `<span>${(total * fraction).toFixed(total < 20 ? 1 : 0)} ms</span>`).join('');
  $('#waterfall').innerHTML =
    `<div class="wf-head"><span>MEASURED · ${escapeHtml(result.statusText)}</span><div class="wf-ticks">${ticks}</div><span>${total.toFixed(1)} ms</span></div>${rows.join('')}`;
}

async function runTrace() {
  traceButton.disabled = true;
  traceButton.innerHTML = '<span>◌</span> Tracing…';
  traceHops.forEach((hop) => hop.classList.remove('done', 'tracing'));
  traceProgress.className = 'moving';
  traceProgress.style.width = '0';

  for (const [index, hop] of traceHops.entries()) {
    hop.classList.add('tracing');
    showHop(hop.dataset.hop);
    traceProgress.style.width = (index / (traceHops.length - 1)) * 100 + '%';
    await pace(550);
    hop.classList.remove('tracing');
    hop.classList.add('done');
  }

  // The response travels back along the same path.
  traceProgress.className = 'moving returning';
  traceProgress.style.width = '0';
  await pace(650);
  traceProgress.className = '';

  const result = await sendRequest('/api/services', { method: 'GET' });
  if (result) {
    renderWaterfall(result);
    const traceUi = window.opslabTracing?.ui;
    $('#trace-id').textContent = result.traceId ? `TRACE ${result.traceId.slice(0, 8)}` : 'TRACE · LOCAL';
    $('#trace-link').hidden = !(result.traceId && traceUi);
    if (result.traceId && traceUi) $('#trace-link').href = `${traceUi}/trace/${result.traceId}`;
  }
  traceButton.disabled = false;
  traceButton.innerHTML = '<span>↻</span> Trace again';
}

traceHops.forEach((hop) => hop.addEventListener('click', () => showHop(hop.dataset.hop)));
traceButton.addEventListener('click', runTrace);
showHop('client');

/* ---------- API playground ---------- */

const endpointSelect = $('#endpoint');
const methodSelect = $('#method');
const requestJson = $('#request-json');
const roleSelect = $('#operator-role');

const requestExamples = {
  '/api/chaos': '{"latencyMs":400,"errorRate":0,"failReadiness":false,"durationSeconds":30}',
  '/api/services': '{"name":"Catalog API","owner":"Platform","status":"healthy"}',
  '/api/incidents': '{"title":"Example incident","severity":"medium","status":"open"}',
};

function colourJson(data) {
  const token = /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[^"\d-]+|./g;
  return JSON.stringify(data, null, 2).replace(token, (match, string, colon) => {
    if (string) return `<span class="${colon ? 'json-key' : 'json-string'}">${escapeHtml(string)}</span>${colon || ''}`;
    if (/^-?\d/.test(match)) return `<span class="json-number">${match}</span>`;
    return escapeHtml(match);
  });
}

// Sends a request and shows it in the response panel. Returns timing details, or null when offline.
async function sendRequest(path = endpointSelect.value, { method = methodSelect.value } = {}) {
  const body = $('#response-body');
  const status = $('#response-status');
  const time = $('#response-time');
  body.textContent = 'Sending request…';
  status.textContent = 'WAIT';
  const started = performance.now();

  try {
    const options = { method, headers: { accept: 'application/json', 'x-opslab-role': roleSelect.value } };
    if (method !== 'GET') {
      try {
        options.body = JSON.stringify(JSON.parse(requestJson.value));
      } catch {
        throw new Error('Request body must be valid JSON');
      }
      options.headers['content-type'] = 'application/json';
    }

    const response = await fetch(path, options);
    const isJson = (response.headers.get('content-type') || '').includes('json');
    const data = isJson ? await response.json() : await response.text();
    const ms = performance.now() - started;
    const statusText = `${response.status} ${response.ok ? 'OK' : 'ERROR'}`;

    time.textContent = Math.round(ms) + ' ms';
    status.textContent = statusText;
    status.classList.toggle('is-error', !response.ok);
    body.innerHTML = typeof data === 'string' ? escapeHtml(data) : colourJson(data);
    $('#response-instance').textContent = response.headers.get('x-served-by') ? `via ${response.headers.get('x-served-by')}` : '';
    return { ms, statusText, timing: parseServerTiming(response.headers.get('server-timing')), traceId: response.headers.get('x-trace-id') };
  } catch (error) {
    status.textContent = 'OFFLINE';
    status.classList.add('is-error');
    body.textContent = error.message;
    return null;
  }
}

function syncPlayground() {
  $('#endpoint-note').textContent = notes[endpointSelect.value] || '';
  requestJson.value = methodSelect.value === 'POST' ? requestExamples[endpointSelect.value] || '{}' : '{}';
}

endpointSelect.addEventListener('change', syncPlayground);
methodSelect.addEventListener('change', syncPlayground);

$('#send-request').addEventListener('click', async () => {
  if (await sendRequest()) markOnboarding('api');
});

$('#copy-curl').addEventListener('click', (event) => {
  const payload = methodSelect.value === 'POST' ? ` -H "content-type: application/json" -d '${requestJson.value}'` : '';
  const command = `curl -X ${methodSelect.value} -H "x-opslab-role: ${roleSelect.value}" ${location.origin}${endpointSelect.value}${payload}`;
  copyText(command, event.currentTarget, 'Copy as curl');
});

$('#quick-health').addEventListener('click', async () => {
  const toast = $('#health-toast');
  toast.textContent = 'Pinging /health/live…';
  try {
    const data = await (await fetch('/health/live')).json();
    toast.textContent = data.status === 'ok' ? '● API is live — round trip successful' : 'API responded, but is not healthy';
  } catch {
    toast.textContent = 'Could not reach the API';
  }
});

/* ---------- Lessons ---------- */

const lessonCards = $$('.lesson-card');
const completedLessons = new Set(readStore('opslab-lessons', []));

function renderLessonProgress() {
  const percent = Math.round((completedLessons.size / lessonCards.length) * 100);
  $('#lesson-progress').style.width = percent + '%';
  $('#progress-label').textContent = `${completedLessons.size} of ${lessonCards.length} complete`;
  $('#progress-percent').textContent = percent + '%';
}

function closeLesson(card) {
  const expand = $('.lesson-expand', card);
  card.classList.remove('open');
  $('.lesson-details', card).hidden = true;
  expand.setAttribute('aria-expanded', 'false');
  $('span', expand).textContent = 'Explore concept';
  $('i', expand).textContent = '+';
}

lessonCards.forEach((card) => {
  const lesson = card.dataset.lesson;
  const completeButton = $('.lesson-complete', card);
  const expand = $('.lesson-expand', card);

  const renderComplete = () => {
    const done = completedLessons.has(lesson);
    card.classList.toggle('completed', done);
    $('i', completeButton).textContent = done ? '●' : '○';
    $('span', completeButton).textContent = done ? 'Done' : 'Mark done';
    completeButton.setAttribute('aria-pressed', String(done));
  };

  // Also used by the lesson quiz in learn.js to mark a lesson done.
  card.setComplete = (done) => {
    if (done) completedLessons.add(lesson);
    else completedLessons.delete(lesson);
    writeStore('opslab-lessons', [...completedLessons]);
    renderComplete();
    renderLessonProgress();
    if (completedLessons.size === lessonCards.length) earnBadge('scholar');
  };
  completeButton.addEventListener('click', () => card.setComplete(!completedLessons.has(lesson)));

  expand.addEventListener('click', () => {
    const opening = expand.getAttribute('aria-expanded') !== 'true';
    lessonCards.filter((other) => other !== card && other.classList.contains('open')).forEach(closeLesson);
    if (!opening) return closeLesson(card);
    card.classList.add('open');
    $('.lesson-details', card).hidden = false;
    expand.setAttribute('aria-expanded', 'true');
    $('span', expand).textContent = 'Close explanation';
    $('i', expand).textContent = '−';
  });

  renderComplete();
});
renderLessonProgress();

$$('[data-lesson-copy]').forEach((button) =>
  button.addEventListener('click', () => copyText(button.dataset.lessonCopy, $('i', button), 'Copy')),
);

$('.copy-command').addEventListener('click', (event) => {
  const button = event.currentTarget;
  copyText(button.dataset.copy, $('span', button), 'Copy command');
});

/* ---------- Scroll reveal ---------- */

const revealObserver = new IntersectionObserver(
  (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('visible')),
  // No threshold: a section taller than the viewport could never reach a fixed visible fraction.
  { rootMargin: '0px 0px -60px 0px' },
);
$$('.reveal').forEach((element) => revealObserver.observe(element));

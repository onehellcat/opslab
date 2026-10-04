import Fastify, { LogController, type FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostname } from 'node:os';
import { context, SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { chaosEnabled, chaosToken, clearChaos, getChaos, setChaos } from './chaos.js';
import { observeRequest, recentWindow, renderRequestMetrics, requestTotals, sloStatus } from './metrics.js';
import { shutdownTracing, tracer, traceUi, tracingEnabled } from './tracing.js';

declare module 'fastify' {
  interface FastifyRequest {
    timings: Record<string, number>;
    span: Span;
  }
}

// In Kubernetes this is the pod name, which shows which replica answered a request.
const instance = hostname();

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info') },
  // One structured line per request is written in the onResponse hook below.
  logController: new LogController({ disableRequestLogging: true }),
});

const startedAt = Date.now();
const eventClients = new Set<import('node:http').ServerResponse>();
const eventHistory: Array<{ id: string; type: string; message: string; at: string }> = [];

function publishEvent(type: string, message: string) {
  const event = { id: randomUUID(), type, message, at: new Date().toISOString() };
  eventHistory.unshift(event);
  eventHistory.splice(30);
  const payload = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  eventClients.forEach((client) => client.write(payload));
  return event;
}

// Injected latency only slows the data routes, so health, metrics and the
// dashboard stay responsive enough to observe the fault.
const chaosLatencyRoutes = new Set(['/api/services', '/api/incidents', '/api/incidents/:id']);

app.addHook('onRequest', async (request, reply) => {
  const route = request.routeOptions.url ?? 'unmatched';
  request.timings = {};
  request.span = tracer.startSpan(`${request.method} ${route}`, {
    kind: SpanKind.SERVER,
    attributes: { 'http.request.method': request.method, 'http.route': route, 'url.path': request.url.split('?')[0] },
  });
  reply.header('x-served-by', instance);
  if (tracingEnabled) {
    reply.header('x-trace-id', request.span.spanContext().traceId);
  }

  const { latencyMs, errorRate } = getChaos();
  if (!chaosLatencyRoutes.has(route)) {
    return;
  }
  if (latencyMs > 0) {
    await childSpan(request, 'injected latency (incident lab)', () => sleep(latencyMs));
    request.timings.chaos = latencyMs;
  }
  if (errorRate > 0 && Math.random() < errorRate) {
    return reply.code(500).send({ error: 'Injected failure from the incident lab' });
  }
});

app.addHook('onSend', async (request, reply, payload) => {
  const parts = Object.entries(request.timings ?? {}).map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`);
  parts.push(`total;dur=${reply.elapsedTime.toFixed(1)}`);
  reply.header('Server-Timing', parts.join(', '));
  return payload;
});

app.addHook('onResponse', async (request, reply) => {
  const route = request.routeOptions.url ?? 'unmatched';
  observeRequest(request.method, route, reply.statusCode, reply.elapsedTime);
  request.span?.setAttribute('http.response.status_code', reply.statusCode);
  if (reply.statusCode >= 500) {
    request.span?.setStatus({ code: SpanStatusCode.ERROR });
  }
  request.span?.end();
  request.log.info({ requestId: request.id, method: request.method, route, statusCode: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }, 'request completed');
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, '..', 'public');

const staticFiles: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/labs.css': { file: 'labs.css', type: 'text/css; charset=utf-8' },
  '/content.js': { file: 'content.js', type: 'application/javascript; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'application/javascript; charset=utf-8' },
  '/labs.js': { file: 'labs.js', type: 'application/javascript; charset=utf-8' },
  '/learn.js': { file: 'learn.js', type: 'application/javascript; charset=utf-8' },
  '/ui-kit': { file: 'ui-kit/index.html', type: 'text/html; charset=utf-8' },
  '/ui-kit/opslab-ui.css': { file: 'ui-kit/opslab-ui.css', type: 'text/css; charset=utf-8' },
  '/ui-kit/ui-kit.js': { file: 'ui-kit/ui-kit.js', type: 'application/javascript; charset=utf-8' },
};

// Production serves assets from memory; development re-reads them so edits show on refresh.
const cacheStaticFiles = process.env.NODE_ENV === 'production';
const staticCache = new Map<string, Promise<string>>();

function loadStaticFile(file: string) {
  if (!cacheStaticFiles) {
    return readFile(join(publicDirectory, file), 'utf8');
  }
  if (!staticCache.has(file)) {
    staticCache.set(file, readFile(join(publicDirectory, file), 'utf8'));
  }
  return staticCache.get(file)!;
}

for (const [url, { file, type }] of Object.entries(staticFiles)) {
  app.get(url, async (_request, reply) => reply.type(type).send(await loadStaticFile(file)));
}

const severities = ['low', 'medium', 'high', 'critical'] as const;
const incidentStatuses = ['open', 'investigating', 'resolved'] as const;
const serviceStatuses = ['healthy', 'degraded', 'down'] as const;

interface Incident {
  id: string;
  title: string;
  severity: (typeof severities)[number];
  status: (typeof incidentStatuses)[number];
  createdAt: string;
}

interface ServiceRecord {
  id: string;
  name: string;
  owner: string;
  status: (typeof serviceStatuses)[number];
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function isViewer(request: FastifyRequest) {
  return request.headers['x-opslab-role'] === 'viewer';
}

const services: ServiceRecord[] = [
  { id: 'svc-1', name: 'Ticketing API', owner: 'Platform', status: 'healthy' },
  { id: 'svc-2', name: 'Authentication', owner: 'Security', status: 'degraded' },
  { id: 'svc-3', name: 'Inventory API', owner: 'Ops', status: 'healthy' },
];

const incidents: Incident[] = [
  {
    id: 'INC-001',
    title: 'Database latency',
    severity: 'high',
    status: 'investigating',
    createdAt: new Date().toISOString(),
  },
];

const databaseEnabled = Boolean(process.env.DATABASE_HOST);
const pool = databaseEnabled
  ? new Pool({
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      database: process.env.DATABASE_NAME ?? 'opslab',
      user: process.env.DATABASE_USER ?? 'opslab',
      password: process.env.DATABASE_PASSWORD ?? 'development',
    })
  : null;

async function ensureDatabaseSchema() {
  if (!pool) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  if ((await pool.query('SELECT COUNT(*) FROM services')).rows[0].count === '0') {
    await pool.query(`
      INSERT INTO services (id, name, owner, status)
      VALUES
        ('svc-1', 'Ticketing API', 'Platform', 'healthy'),
        ('svc-2', 'Authentication', 'Security', 'degraded'),
        ('svc-3', 'Inventory API', 'Ops', 'healthy');
    `);
  }

  if ((await pool.query('SELECT COUNT(*) FROM incidents')).rows[0].count === '0') {
    await pool.query(`
      INSERT INTO incidents (id, title, severity, status, created_at)
      VALUES ('INC-001', 'Database latency', 'high', 'investigating', $1);
    `, [new Date().toISOString()]);
  }
}

// Runs work inside a span that is a child of the request's server span.
async function childSpan<T>(request: FastifyRequest, name: string, work: () => Promise<T>) {
  const span = tracer.startSpan(name, { kind: SpanKind.INTERNAL }, trace.setSpan(context.active(), request.span));
  try {
    return await work();
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}

// Records time spent in the data store so it can be reported in Server-Timing.
async function measureStore<T>(request: FastifyRequest, work: () => Promise<T>) {
  const started = performance.now();
  try {
    return await childSpan(request, databaseEnabled ? 'postgres query' : 'in-memory store', work);
  } finally {
    request.timings.db = (request.timings.db ?? 0) + performance.now() - started;
  }
}

async function loadServices() {
  if (!pool) {
    return services;
  }

  const result = await pool.query('SELECT * FROM services ORDER BY name');
  return result.rows as ServiceRecord[];
}

async function loadIncidents() {
  if (!pool) {
    return incidents;
  }

  const result = await pool.query('SELECT id, title, severity, status, created_at AS "createdAt" FROM incidents ORDER BY created_at DESC');
  return result.rows as Incident[];
}

async function nextIncidentId() {
  const highest = (await loadIncidents()).reduce((max, incident) => Math.max(max, Number(incident.id.replace(/\D/g, '')) || 0), 0);
  return `INC-${String(highest + 1).padStart(3, '0')}`;
}

async function saveService(service: ServiceRecord) {
  if (!pool) {
    services.push(service);
    return service;
  }

  await pool.query(
    'INSERT INTO services (id, name, owner, status) VALUES ($1, $2, $3, $4)',
    [service.id, service.name, service.owner, service.status],
  );

  return service;
}

async function saveIncident(incident: Incident) {
  if (!pool) {
    incidents.push(incident);
    return incident;
  }

  await pool.query(
    'INSERT INTO incidents (id, title, severity, status, created_at) VALUES ($1, $2, $3, $4, $5)',
    [incident.id, incident.title, incident.severity, incident.status, incident.createdAt],
  );

  return incident;
}

type IncidentChanges = Partial<Pick<Incident, 'title' | 'severity' | 'status'>>;

async function updateIncidentRecord(id: string, changes: IncidentChanges) {
  if (!pool) {
    const incident = incidents.find((item) => item.id === id);
    if (!incident) {
      return null;
    }
    Object.assign(incident, changes);
    return incident;
  }

  // Column names come from this fixed list, never from the request body.
  const columns = (['title', 'severity', 'status'] as const).filter((column) => changes[column] !== undefined);
  const assignments = columns.map((column, index) => `${column} = $${index + 1}`);
  await pool.query(
    `UPDATE incidents SET ${assignments.join(', ')} WHERE id = $${columns.length + 1}`,
    [...columns.map((column) => changes[column]), id],
  );

  return (await pool.query('SELECT id, title, severity, status, created_at AS "createdAt" FROM incidents WHERE id = $1', [id])).rows[0] ?? null;
}

app.get('/health/live', async () => ({ status: 'ok' }));

// Readiness answers with 503 when this replica should not receive traffic, which
// is what makes a Kubernetes readinessProbe remove the pod from Service endpoints.
app.get('/health/ready', async (_request, reply) => {
  if (getChaos().failReadiness) {
    return reply.code(503).send({ status: 'degraded', database: databaseEnabled ? 'unknown' : 'not configured', reason: 'readiness failure injected by the incident lab' });
  }

  if (!databaseEnabled) {
    return { status: 'ready', database: 'not configured', store: 'in-memory' };
  }

  try {
    await pool!.query('SELECT 1');
    return { status: 'ready', database: 'connected', store: 'postgres' };
  } catch (error) {
    return reply.code(503).send({ status: 'degraded', database: 'unreachable', error: (error as Error).message });
  }
});

app.get('/api/whoami', async (request) => {
  const requestedRole = request.headers['x-opslab-role'];
  const role = requestedRole === 'viewer' || requestedRole === 'admin' ? requestedRole : 'operator';
  return { role, capabilities: role === 'viewer' ? ['read:status', 'read:incidents'] : ['read:status', 'read:incidents', 'write:incidents', 'run:labs'] };
});

app.get('/api/events', async (_request, reply) => {
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  eventHistory.slice().reverse().forEach((event) => reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
  eventClients.add(reply.raw);
  reply.raw.on('close', () => eventClients.delete(reply.raw));
  return reply.hijack();
});

app.get('/api/services', async (request) => ({ services: await measureStore(request, loadServices) }));

app.post('/api/services', async (request, reply) => {
  if (isViewer(request)) {
    return reply.code(403).send({ error: 'Viewer role cannot change services' });
  }
  const { name, owner, status } = (request.body ?? {}) as Record<string, unknown>;

  if (!isText(name) || !isText(owner)) {
    return reply.code(400).send({ error: 'name and owner are required text fields (200 characters at most)' });
  }
  if (!isOneOf(serviceStatuses, status)) {
    return reply.code(400).send({ error: `status must be one of: ${serviceStatuses.join(', ')}` });
  }

  const service = await measureStore(request, () => saveService({ id: `svc-${randomUUID().slice(0, 8)}`, name, owner, status }));
  publishEvent('service', `Service ${service.name} was created`);
  return reply.code(201).send(service);
});

app.get('/api/incidents', async (request) => ({ incidents: await measureStore(request, loadIncidents) }));

app.post('/api/incidents', async (request, reply) => {
  if (isViewer(request)) {
    return reply.code(403).send({ error: 'Viewer role cannot create incidents' });
  }
  const { title, severity, status } = (request.body ?? {}) as Record<string, unknown>;

  if (!isText(title)) {
    return reply.code(400).send({ error: 'title is a required text field (200 characters at most)' });
  }
  if (!isOneOf(severities, severity)) {
    return reply.code(400).send({ error: `severity must be one of: ${severities.join(', ')}` });
  }
  if (!isOneOf(incidentStatuses, status)) {
    return reply.code(400).send({ error: `status must be one of: ${incidentStatuses.join(', ')}` });
  }

  const incident = await measureStore(request, async () =>
    saveIncident({ id: await nextIncidentId(), title, severity, status, createdAt: new Date().toISOString() }));
  publishEvent('incident', `Incident ${incident.id} opened: ${incident.title}`);
  return reply.code(201).send(incident);
});

app.patch('/api/incidents/:id', async (request, reply) => {
  if (isViewer(request)) {
    return reply.code(403).send({ error: 'Viewer role cannot update incidents' });
  }
  const { id } = request.params as { id: string };
  const { title, severity, status } = (request.body ?? {}) as Record<string, unknown>;
  const changes: IncidentChanges = {};

  if (title !== undefined) {
    if (!isText(title)) {
      return reply.code(400).send({ error: 'title must be text (200 characters at most)' });
    }
    changes.title = title;
  }
  if (severity !== undefined) {
    if (!isOneOf(severities, severity)) {
      return reply.code(400).send({ error: `severity must be one of: ${severities.join(', ')}` });
    }
    changes.severity = severity;
  }
  if (status !== undefined) {
    if (!isOneOf(incidentStatuses, status)) {
      return reply.code(400).send({ error: `status must be one of: ${incidentStatuses.join(', ')}` });
    }
    changes.status = status;
  }
  if (Object.keys(changes).length === 0) {
    return reply.code(400).send({ error: 'Provide at least one of: title, severity, status' });
  }

  const incident = await measureStore(request, () => updateIncidentRecord(id, changes));

  if (!incident) {
    return reply.code(404).send({ error: 'Incident not found' });
  }

  publishEvent('incident', `Incident ${id} updated to ${incident.status}`);
  return incident;
});

app.get('/api/chaos', async () => ({ enabled: chaosEnabled, tokenRequired: Boolean(chaosToken), ...getChaos() }));

// Returns an error message when this caller may not change faults, otherwise null.
function chaosDenied(request: FastifyRequest) {
  if (isViewer(request)) {
    return 'Viewer role cannot run labs';
  }
  if (!chaosEnabled) {
    return 'Fault injection is disabled on this server (set OPSLAB_CHAOS=on to allow it)';
  }
  if (chaosToken && request.headers['x-opslab-chaos-token'] !== chaosToken) {
    return 'Fault injection needs a valid x-opslab-chaos-token header';
  }
  return null;
}

app.post('/api/chaos', async (request, reply) => {
  const denied = chaosDenied(request);
  if (denied) {
    return reply.code(403).send({ error: denied });
  }

  const state = setChaos((request.body ?? {}) as Record<string, unknown>);
  const faults = [
    state.latencyMs ? `${state.latencyMs} ms latency on data routes` : '',
    state.errorRate ? `${Math.round(state.errorRate * 100)}% errors on data routes` : '',
    state.failReadiness ? 'readiness failing' : '',
  ].filter(Boolean);
  publishEvent('chaos', faults.length ? `Fault injected: ${faults.join(' and ')}` : 'Fault injection cleared');
  return { enabled: chaosEnabled, ...state };
});

app.delete('/api/chaos', async (request, reply) => {
  const denied = chaosDenied(request);
  if (denied) {
    return reply.code(403).send({ error: denied });
  }

  const wasActive = getChaos().expiresAt !== null;
  const state = clearChaos();
  if (wasActive) {
    publishEvent('chaos', 'Fault injection cleared');
  }
  return { enabled: chaosEnabled, ...state };
});

function isActive(incident: Incident) {
  return incident.status !== 'resolved';
}

// The same conditions as observability/alerts.yml, evaluated in-process so the UI can show them.
function evaluateAlerts() {
  const recent = recentWindow();
  const slo = sloStatus();
  const chaos = getChaos();
  const errorRatio = recent.requests ? recent.errors / recent.requests : 0;

  return [
    { name: 'HighLatency', severity: 'warning', firing: recent.p95_ms > slo.latency_objective_ms, detail: `p95 ${recent.p95_ms} ms against a ${slo.latency_objective_ms} ms objective` },
    { name: 'HighErrorRate', severity: 'critical', firing: errorRatio > 0.05, detail: `${(errorRatio * 100).toFixed(1)}% of recent requests failed` },
    { name: 'ErrorBudgetBurn', severity: 'critical', firing: slo.budget_remaining < 0.5, detail: `${Math.round(Math.max(slo.budget_remaining, 0) * 100)}% of the error budget left` },
    { name: 'ReadinessFailing', severity: 'critical', firing: chaos.failReadiness, detail: 'this replica is answering 503 on /health/ready' },
  ];
}

app.get('/api/ops/summary', async () => {
  const loadedServices = await loadServices();
  const loadedIncidents = await loadIncidents();
  const totals = requestTotals();

  return {
    http_requests_total: totals.requests,
    http_errors_total: totals.errors,
    http_request_duration_ms: Math.round(totals.meanDurationMs),
    recent: recentWindow(),
    active_incidents: loadedIncidents.filter(isActive).length,
    incidents_total: loadedIncidents.length,
    services_total: loadedServices.length,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    store: databaseEnabled ? 'postgres' : 'in-memory',
    instance,
    chaos: { enabled: chaosEnabled, tokenRequired: Boolean(chaosToken), ...getChaos() },
    slo: sloStatus(),
    alerts: evaluateAlerts(),
    tracing: { enabled: tracingEnabled, ui: traceUi },
    status: 'ok',
  };
});

app.get('/metrics', async (_request, reply) => {
  const loadedServices = await loadServices();
  const loadedIncidents = await loadIncidents();
  const chaos = getChaos();
  const slo = sloStatus();

  return reply.type('text/plain; version=0.0.4').send([
    ...renderRequestMetrics(),
    '# HELP opslab_active_incidents Incidents that are not resolved',
    '# TYPE opslab_active_incidents gauge', `opslab_active_incidents ${loadedIncidents.filter(isActive).length}`,
    '# HELP opslab_services_total Current number of services',
    '# TYPE opslab_services_total gauge', `opslab_services_total ${loadedServices.length}`,
    '# HELP opslab_chaos_active Whether the incident lab is currently injecting a fault',
    '# TYPE opslab_chaos_active gauge', `opslab_chaos_active ${chaos.expiresAt ? 1 : 0}`,
    '# HELP opslab_slo_error_budget_remaining Share of the error budget left in the rolling window (1 = untouched)',
    '# TYPE opslab_slo_error_budget_remaining gauge', `opslab_slo_error_budget_remaining ${slo.budget_remaining}`,
    '# HELP opslab_uptime_seconds Seconds since the process started',
    '# TYPE opslab_uptime_seconds gauge', `opslab_uptime_seconds ${Math.round((Date.now() - startedAt) / 1000)}`,
  ].join('\n') + '\n');
});

app.addHook('onClose', async () => {
  eventClients.forEach((client) => client.end());
  await pool?.end();
  await shutdownTracing();
});

const port = Number(process.env.PORT ?? 3000);

// The database may still be starting (for example when both are deployed together),
// so wait for it instead of exiting and relying on the platform to restart the process.
async function waitForDatabase(attempts = 20, delayMs = 3000) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await ensureDatabaseSchema();
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      app.log.warn({ attempt, error: (error as Error).message }, 'database not ready, retrying');
      await sleep(delayMs);
    }
  }
}

const start = async () => {
  try {
    await waitForDatabase();
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`OpsLab API listening on http://0.0.0.0:${port}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app, ensureDatabaseSchema, services, incidents };

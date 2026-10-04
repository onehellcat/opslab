import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, ensureDatabaseSchema } from '../src/server.js';

// With DATABASE_HOST set (as in CI) the routes use PostgreSQL, so the tables must exist first.
beforeAll(async () => {
  await ensureDatabaseSchema();
});

afterAll(async () => {
  await app.inject({ method: 'DELETE', url: '/api/chaos' });
  await app.close();
});

const createIncident = (title: string) =>
  app.inject({ method: 'POST', url: '/api/incidents', payload: { title, severity: 'low', status: 'open' } });

describe('OpsLab API', () => {
  it('serves the interactive learning frontend', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('A commit’s journey');
    expect(response.body).toContain('Follow one packet');
    expect(response.body).toContain('Safe rollouts and rollback');
    expect(response.body).toContain('Logs, metrics, and traces');
  });

  it('serves every frontend asset the page references', async () => {
    const page = await app.inject({ method: 'GET', url: '/' });
    const assets = [...page.body.matchAll(/(?:href|src)="(\/[^"#]+\.(?:css|js))"/g)].map((match) => match[1]);

    expect(assets).toEqual(expect.arrayContaining(['/styles.css', '/labs.css', '/content.js', '/app.js', '/labs.js']));
    for (const url of assets) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }
  });

  it('serves the reusable UI kit and its stylesheet', async () => {
    const [gallery, stylesheet] = await Promise.all([
      app.inject({ method: 'GET', url: '/ui-kit' }),
      app.inject({ method: 'GET', url: '/ui-kit/opslab-ui.css' }),
    ]);

    expect(gallery.statusCode).toBe(200);
    expect(gallery.headers['content-type']).toContain('text/html');
    expect(gallery.body).toContain('Reusable interface system');
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers['content-type']).toContain('text/css');
    expect(stylesheet.body).toContain('--ops-accent: #b8f337');
  });

  it('returns application live status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns ready status for the service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('creates a new incident', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/incidents',
      payload: {
        title: 'Deployment failed',
        severity: 'critical',
        status: 'open',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      title: 'Deployment failed',
      severity: 'critical',
      status: 'open',
    });
  });

  it('rejects incident values outside the allowed lists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/incidents',
      payload: { title: 'Bad severity', severity: 'catastrophic', status: 'open' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('severity');
  });

  it('gives each new incident a distinct id', async () => {
    const first = (await createIncident('Id check one')).json();
    const second = (await createIncident('Id check two')).json();

    expect(first.id).toMatch(/^INC-\d{3,}$/);
    expect(second.id).not.toBe(first.id);
  });

  it('updates only whitelisted incident fields', async () => {
    const created = (await createIncident('Patch target')).json();
    const patch = (payload: Record<string, unknown>, id = created.id) =>
      app.inject({ method: 'PATCH', url: `/api/incidents/${id}`, payload });

    expect((await patch({ "status = 'resolved' --": 'x' })).statusCode).toBe(400);
    expect((await patch({ status: 'closed' })).statusCode).toBe(400);

    const updated = await patch({ status: 'resolved', id: 'INC-999' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: created.id, status: 'resolved', title: 'Patch target' });

    expect((await patch({ status: 'resolved' }, 'INC-does-not-exist')).statusCode).toBe(404);
  });

  it('does not count resolved incidents as active', async () => {
    const summary = async () => (await app.inject({ method: 'GET', url: '/api/ops/summary' })).json();
    const before = await summary();
    const created = (await createIncident('Short lived')).json();
    const during = await summary();
    await app.inject({ method: 'PATCH', url: `/api/incidents/${created.id}`, payload: { status: 'resolved' } });
    const after = await summary();

    expect(during.active_incidents).toBe(before.active_incidents + 1);
    expect(after.active_incidents).toBe(before.active_incidents);
    expect(after.incidents_total).toBe(before.incidents_total + 1);
  });

  it('exposes an operational summary and Prometheus-compatible metrics', async () => {
    const [summary, metrics] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/ops/summary' }),
      app.inject({ method: 'GET', url: '/metrics' }),
    ]);

    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({
      http_requests_total: expect.any(Number),
      services_total: expect.any(Number),
      active_incidents: expect.any(Number),
      recent: { p95_ms: expect.any(Number), rate_per_second: expect.any(Number) },
    });
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('opslab_http_requests_total');
  });

  it('labels request metrics by route and exposes a duration histogram', async () => {
    await app.inject({ method: 'GET', url: '/api/services' });
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });

    expect(metrics.body).toContain('opslab_http_requests_total{method="GET",route="/api/services",status="200"}');
    expect(metrics.body).toContain('opslab_http_request_duration_seconds_bucket{method="GET",route="/api/services",le="+Inf"}');
    expect(metrics.body).toContain('opslab_http_request_duration_seconds_count{method="GET",route="/api/services"}');
  });

  it('reports store and total time in the Server-Timing header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/services' });

    expect(response.headers['server-timing']).toMatch(/db;dur=[\d.]+, total;dur=[\d.]+/);
  });

  it('enforces the read-only viewer role for write routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/incidents',
      headers: { 'x-opslab-role': 'viewer' },
      payload: { title: 'Blocked write', severity: 'low', status: 'open' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('fails readiness with 503 while a readiness fault is injected, then recovers', async () => {
    const injected = await app.inject({ method: 'POST', url: '/api/chaos', payload: { failReadiness: true, durationSeconds: 30 } });
    expect(injected.statusCode).toBe(200);
    expect(injected.json()).toMatchObject({ failReadiness: true, expiresAt: expect.any(String) });

    const degraded = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json()).toMatchObject({ status: 'degraded' });
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);

    await app.inject({ method: 'DELETE', url: '/api/chaos' });
    const recovered = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({ status: 'ready' });
  });

  it('adds injected latency to data routes and caps what can be requested', async () => {
    const capped = (await app.inject({ method: 'POST', url: '/api/chaos', payload: { latencyMs: 999999, durationSeconds: 999999 } })).json();
    expect(capped.latencyMs).toBe(3000);
    expect(new Date(capped.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);

    await app.inject({ method: 'POST', url: '/api/chaos', payload: { latencyMs: 60, durationSeconds: 30 } });
    const slow = await app.inject({ method: 'GET', url: '/api/services' });
    expect(slow.headers['server-timing']).toContain('chaos;dur=60.0');

    const viewer = await app.inject({ method: 'POST', url: '/api/chaos', headers: { 'x-opslab-role': 'viewer' }, payload: { latencyMs: 60 } });
    expect(viewer.statusCode).toBe(403);
    await app.inject({ method: 'DELETE', url: '/api/chaos' });
  });
});

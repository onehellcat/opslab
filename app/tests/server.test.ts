import { describe, expect, it } from 'vitest';
import { app } from '../src/server.js';

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
    expect(response.json()).toMatchObject({ status: expect.any(String) });
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
});

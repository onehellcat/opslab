import Fastify from 'fastify';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = Fastify({
  logger: false,
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, '..', 'public');

const frontendAssets = {
  html: readFile(join(publicDirectory, 'index.html'), 'utf8'),
  css: readFile(join(publicDirectory, 'styles.css'), 'utf8'),
  js: readFile(join(publicDirectory, 'app.js'), 'utf8'),
  uiKitHtml: readFile(join(publicDirectory, 'ui-kit', 'index.html'), 'utf8'),
  uiKitCss: readFile(join(publicDirectory, 'ui-kit', 'opslab-ui.css'), 'utf8'),
  uiKitJs: readFile(join(publicDirectory, 'ui-kit', 'ui-kit.js'), 'utf8'),
};

interface Incident {
  id: string;
  title: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved';
  createdAt: string;
}

interface ServiceRecord {
  id: string;
  name: string;
  owner: string;
  status: 'healthy' | 'degraded' | 'down';
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

async function updateIncidentRecord(id: string, payload: Partial<Incident>) {
  if (!pool) {
    const incident = incidents.find((item) => item.id === id);
    if (!incident) {
      return null;
    }
    Object.assign(incident, payload);
    return incident;
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let counter = 1;

  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      const column = key === 'createdAt' ? 'created_at' : key;
      fields.push(`${column} = $${counter}`);
      values.push(value);
      counter += 1;
    }
  }

  if (fields.length === 0) {
    return (await pool.query('SELECT id, title, severity, status, created_at AS "createdAt" FROM incidents WHERE id = $1', [id])).rows[0] ?? null;
  }

  values.push(id);
  await pool.query(
    `UPDATE incidents SET ${fields.join(', ')} WHERE id = $${counter}`,
    values,
  );

  return (await pool.query('SELECT id, title, severity, status, created_at AS "createdAt" FROM incidents WHERE id = $1', [id])).rows[0] ?? null;
}

app.get('/health/live', async () => ({ status: 'ok' }));

app.get('/', async (_request, reply) => {
  return reply.type('text/html; charset=utf-8').send(await frontendAssets.html);
});

app.get('/styles.css', async (_request, reply) => {
  return reply.type('text/css; charset=utf-8').send(await frontendAssets.css);
});

app.get('/app.js', async (_request, reply) => {
  return reply.type('application/javascript; charset=utf-8').send(await frontendAssets.js);
});

app.get('/ui-kit', async (_request, reply) => {
  return reply.type('text/html; charset=utf-8').send(await frontendAssets.uiKitHtml);
});

app.get('/ui-kit/opslab-ui.css', async (_request, reply) => {
  return reply.type('text/css; charset=utf-8').send(await frontendAssets.uiKitCss);
});

app.get('/ui-kit/ui-kit.js', async (_request, reply) => {
  return reply.type('application/javascript; charset=utf-8').send(await frontendAssets.uiKitJs);
});

app.get('/health/ready', async () => {
  if (!databaseEnabled) {
    return {
      status: 'degraded',
      database: 'not configured',
    };
  }

  try {
    await pool!.query('SELECT 1');
    return {
      status: 'ready',
      database: 'connected',
    };
  } catch (error) {
    return {
      status: 'degraded',
      database: 'unreachable',
      error: (error as Error).message,
    };
  }
});

app.get('/api/services', async () => ({ services: await loadServices() }));

app.post('/api/services', async (request, reply) => {
  const { name, owner, status } = request.body as Partial<ServiceRecord>;

  if (!name || !owner || !status) {
    return reply.code(400).send({ error: 'name, owner and status are required' });
  }

  const service: ServiceRecord = {
    id: `svc-${Date.now()}`,
    name,
    owner,
    status,
  };

  return reply.code(201).send(await saveService(service));
});

app.get('/api/incidents', async () => ({ incidents: await loadIncidents() }));

app.post('/api/incidents', async (request, reply) => {
  const { title, severity, status } = request.body as Partial<Incident>;

  if (!title || !severity || !status) {
    return reply.code(400).send({ error: 'title, severity and status are required' });
  }

  const incident: Incident = {
    id: `INC-${String((await loadIncidents()).length + 1).padStart(3, '0')}`,
    title,
    severity,
    status,
    createdAt: new Date().toISOString(),
  };

  return reply.code(201).send(await saveIncident(incident));
});

app.patch('/api/incidents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const payload = request.body as Partial<Incident>;
  const incident = await updateIncidentRecord(id, payload);

  if (!incident) {
    return reply.code(404).send({ error: 'Incident not found' });
  }

  return incident;
});

app.get('/metrics', async () => {
  const loadedServices = await loadServices();
  const loadedIncidents = await loadIncidents();

  return {
    http_requests_total: 1,
    http_request_duration_ms: 15,
    active_incidents: loadedIncidents.length,
    services_total: loadedServices.length,
    status: 'ok',
  };
});

const port = Number(process.env.PORT ?? 3000);

const start = async () => {
  try {
    await ensureDatabaseSchema();
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

export { app, services, incidents };

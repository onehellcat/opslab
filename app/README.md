# App service

This directory contains the Node.js API for OpsLab.

## Run locally

```bash
npm install
npm run dev
```

## Health endpoints

- GET /health/live
- GET /health/ready

## Key environment variables

```bash
PORT=3000
NODE_ENV=development
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=opslab
DATABASE_USER=opslab
DATABASE_PASSWORD=development
```

## Test commands

```bash
npm test
npm run build
```

## Reusable UI kit

Open `http://localhost:3000/ui-kit` for the component gallery. The standalone
stylesheet, usage notes, and examples live in `public/ui-kit/`.

## Operations lab

The main UI includes a fully interactive operations console:

- **Live system snapshot** reads `/health/live`, `/health/ready`, and `/api/ops/summary` to display actual service state, incident count, service count, and average request duration.
- **API explorer** sends GET or POST requests with an editable JSON body. Choose Viewer to prove that write routes return `403`, or Operator/Admin to create a service or incident. It also creates a matching `curl` command.
- **Event stream** uses Server-Sent Events from `/api/events`. Creating an incident or service broadcasts a live event into the UI without browser polling.
- **Incident and deployment labs** are explicitly browser-only simulations. They teach diagnosis, readiness, rolling updates, and rollback without modifying Docker, Kubernetes, or PostgreSQL.

Every completed request is written as structured JSON through Fastify's logger. The entry includes Fastify's `requestId`, method, route, status code, and duration, so one request can be followed from the UI to a terminal log.

## Metrics and dashboards

`GET /metrics` is Prometheus exposition text, suitable for a scraper. `GET /api/ops/summary` is the JSON counterpart used by the UI. Start the optional local dashboard stack with:

```bash
docker compose --profile observe up --build
```

Then open Prometheus at `http://localhost:9090` or Grafana at `http://localhost:3001` (`admin` / `admin` for the local-only default). The setup and first PromQL queries are in [../observability/README.md](../observability/README.md).

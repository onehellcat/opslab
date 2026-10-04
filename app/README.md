# App service

This directory contains the Node.js API for OpsLab.

## Run locally

```bash
npm install
npm run dev
```

## Health endpoints

- `GET /health/live` — `200` while the process can answer HTTP.
- `GET /health/ready` — `200` when the API can serve work; `503` when PostgreSQL is configured but unreachable, or a readiness fault is injected. Without `DATABASE_HOST` the API uses its in-memory store and reports ready.

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

## Frontend files

| File | Purpose |
| --- | --- |
| `public/content.js` | Teaching copy: pipeline stages, architecture nodes, trace hops, endpoint notes |
| `public/app.js` | Pipeline, architecture, request trace, lessons, and API playground |
| `public/labs.js` | Live signals, incident lab, deployment lab, lesson simulators, theme, badges |
| `public/styles.css` | Base layout and components |
| `public/labs.css` | Lab styles and the dark theme |

Assets are re-read on every request unless `NODE_ENV=production`, so edits show on refresh during development.

## Operations lab

- **Live system snapshot** polls `/api/ops/summary` and draws rolling p95 latency and request-rate charts. "Send 50 requests" makes them move.
- **Incident lab** is a timed diagnosis exercise. It is a browser simulation unless you tick "Inject it for real", which calls the fault-injection API below.
- **Deployment lab** simulates a two-replica rolling update with `maxSurge 1` and `maxUnavailable 0`, including a release that fails readiness. It never calls `kubectl`.
- **Event stream** uses Server-Sent Events from `/api/events` for incident, service, and fault changes.
- **API playground** sends GET or POST requests with an editable JSON body. Choose Viewer to see write routes return `403`.

## Fault injection

`POST /api/chaos` injects a fault into this API process only:

```bash
curl -X POST localhost:3000/api/chaos -H "content-type: application/json" \
  -d '{"latencyMs":800,"failReadiness":false,"durationSeconds":60}'
```

- `latencyMs` (0–3000) delays `/api/services` and `/api/incidents`.
- `failReadiness` makes `/health/ready` answer `503`, which is what removes a pod from a Kubernetes Service.
- Every fault expires on its own (120 seconds at most); `DELETE /api/chaos` clears it sooner.
- Set `OPSLAB_CHAOS=off` to disable the endpoint. The Viewer role cannot use it.

## Request logs and timing

Every completed request writes one structured JSON log line with the request id, method, route, status code, and duration. Responses carry a `Server-Timing` header (`db`, `chaos`, `total`), which the request trace in the UI uses to draw its timing waterfall.

## Metrics and dashboards

`GET /metrics` is Prometheus exposition text: `opslab_http_requests_total` labelled by method, route, and status, the `opslab_http_request_duration_seconds` histogram, and gauges for active incidents, services, uptime, and injected faults. `GET /api/ops/summary` is the JSON counterpart used by the UI. Start Prometheus and a provisioned Grafana dashboard with:

```bash
docker compose --profile observe up --build
```

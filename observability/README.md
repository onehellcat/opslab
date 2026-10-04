# Local observability stack

Run the optional metrics stack alongside OpsLab:

```bash
docker compose --profile observe up --build
```

Open Prometheus at `http://localhost:9090` and Grafana at `http://localhost:3001` (default credentials: `admin` / `admin`). Prometheus scrapes the API's real `/metrics` endpoint every five seconds.

Useful first queries:

- `opslab_http_requests_total`
- `opslab_http_request_duration_ms_mean`
- `opslab_active_incidents`

The application UI also displays the same operational data through `/api/ops/summary`; this deliberately separates human-friendly JSON from Prometheus' scraper-oriented exposition format.

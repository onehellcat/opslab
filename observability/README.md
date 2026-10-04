# Local observability stack

Run the optional metrics stack alongside OpsLab:

```bash
docker compose --profile observe up --build
```

- **Prometheus** at `http://localhost:9090` scrapes the API's `/metrics` endpoint every five seconds.
- **Grafana** at `http://localhost:3001` opens on the provisioned **OpsLab API overview** dashboard. The default credentials are `admin` / `admin`; they are for local use only.

The datasource and dashboard are provisioned from `grafana/`, so there is nothing to click through. To change the dashboard, edit `grafana/dashboards/opslab-overview.json` and restart Grafana.

## Useful queries

```promql
# Request rate by route
sum by (route) (rate(opslab_http_requests_total[1m]))

# 95th percentile latency
histogram_quantile(0.95, sum by (le) (rate(opslab_http_request_duration_seconds_bucket[1m])))

# Share of requests answered with a 5xx status
sum(rate(opslab_http_requests_total{status=~"5.."}[1m])) / sum(rate(opslab_http_requests_total[1m]))
```

## See a fault on the dashboard

Open the incident lab in the UI, tick "Inject it for real", and start the database latency scenario. Then press "Send 50 requests" in the live snapshot: the p95 panel rises and the "Fault injected" panel turns to Yes until the fault expires.

The application UI shows the same signals through `/api/ops/summary`, which keeps human-friendly JSON separate from the scraper-oriented exposition format.

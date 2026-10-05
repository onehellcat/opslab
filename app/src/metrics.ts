// Minimal in-process metrics registry: labelled request counters, a duration
// histogram, and a short rolling window for the UI's live charts.

const bucketBounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
const recentLimit = 2000;

interface Histogram {
  buckets: number[];
  sum: number;
  count: number;
}

const requestCounts = new Map<string, number>();
const durations = new Map<string, Histogram>();
const recent: Array<{ at: number; ms: number; error: boolean }> = [];
let requestsTotal = 0;
let errorsTotal = 0;
let durationMsTotal = 0;

function escapeLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function observeRequest(method: string, route: string, statusCode: number, durationMs: number) {
  const error = statusCode >= 500;
  requestsTotal += 1;
  durationMsTotal += durationMs;
  if (error) {
    errorsTotal += 1;
  }

  const countKey = `method="${method}",route="${escapeLabel(route)}",status="${statusCode}"`;
  requestCounts.set(countKey, (requestCounts.get(countKey) ?? 0) + 1);

  const durationKey = `method="${method}",route="${escapeLabel(route)}"`;
  const histogram = durations.get(durationKey) ?? { buckets: bucketBounds.map(() => 0), sum: 0, count: 0 };
  const seconds = durationMs / 1000;
  bucketBounds.forEach((bound, index) => {
    if (seconds <= bound) {
      histogram.buckets[index] += 1;
    }
  });
  histogram.sum += seconds;
  histogram.count += 1;
  durations.set(durationKey, histogram);

  recent.push({ at: Date.now(), ms: durationMs, error });
  if (recent.length > recentLimit) {
    recent.shift();
  }
}

export function requestTotals() {
  return {
    requests: requestsTotal,
    errors: errorsTotal,
    meanDurationMs: requestsTotal ? durationMsTotal / requestsTotal : 0,
  };
}

function percentile(sorted: number[], fraction: number) {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function recentWindow(windowSeconds = 10) {
  const cutoff = Date.now() - windowSeconds * 1000;
  const samples = recent.filter((sample) => sample.at >= cutoff);
  const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);

  return {
    window_seconds: windowSeconds,
    requests: samples.length,
    errors: samples.filter((sample) => sample.error).length,
    rate_per_second: Number((samples.length / windowSeconds).toFixed(2)),
    p50_ms: Number(percentile(sorted, 0.5).toFixed(1)),
    p95_ms: Number(percentile(sorted, 0.95).toFixed(1)),
  };
}

export function renderRequestMetrics() {
  const lines = [
    '# HELP opslab_http_requests_total Total HTTP requests served, by method, route and status',
    '# TYPE opslab_http_requests_total counter',
  ];
  requestCounts.forEach((value, labels) => lines.push(`opslab_http_requests_total{${labels}} ${value}`));

  lines.push(
    '# HELP opslab_http_request_duration_seconds HTTP request duration in seconds',
    '# TYPE opslab_http_request_duration_seconds histogram',
  );
  durations.forEach((histogram, labels) => {
    bucketBounds.forEach((bound, index) => {
      lines.push(`opslab_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${histogram.buckets[index]}`);
    });
    lines.push(`opslab_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${histogram.count}`);
    lines.push(`opslab_http_request_duration_seconds_sum{${labels}} ${histogram.sum.toFixed(6)}`);
    lines.push(`opslab_http_request_duration_seconds_count{${labels}} ${histogram.count}`);
  });

  return lines;
}

// Service level objective: a request is "good" when it is not a server error and
// finishes within the latency objective. The error budget is the share of
// requests allowed to be bad before the target is missed.
export const sloTarget = 0.95;
export const sloLatencyMs = 300;

export function sloStatus(windowSeconds = 300) {
  const cutoff = Date.now() - windowSeconds * 1000;
  const samples = recent.filter((sample) => sample.at >= cutoff);
  const bad = samples.filter((sample) => sample.error || sample.ms > sloLatencyMs).length;
  const allowedBad = samples.length * (1 - sloTarget);
  const budgetRemaining = allowedBad > 0 ? 1 - bad / allowedBad : 1;

  return {
    target: sloTarget,
    latency_objective_ms: sloLatencyMs,
    window_seconds: windowSeconds,
    total: samples.length,
    bad,
    compliance: samples.length ? Number(((samples.length - bad) / samples.length).toFixed(4)) : 1,
    budget_remaining: Number(Math.max(-1, budgetRemaining).toFixed(3)),
  };
}

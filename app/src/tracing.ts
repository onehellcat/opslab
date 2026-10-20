// Optional distributed tracing. Spans are created by hand in server.ts, so no
// module patching is needed; they are exported only when an OTLP endpoint is set.
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { hostname } from 'node:os';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

export const tracingEnabled = Boolean(endpoint);
// Where a person can look a trace up, e.g. the Jaeger UI. Shown as a link in the request trace.
export const traceUi = tracingEnabled ? (process.env.OPSLAB_TRACE_UI ?? null) : null;

let provider: NodeTracerProvider | null = null;

if (endpoint) {
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'opslab-api',
      'service.instance.id': hostname(),
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }), { scheduledDelayMillis: 1000 })],
  });
  provider.register();
}

// Without a registered provider this is the API's no-op tracer.
export const tracer = trace.getTracer('opslab-api');

export async function shutdownTracing() {
  await provider?.shutdown();
}

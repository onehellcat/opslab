// Opt-in fault injection for the incident lab. Faults only affect this process
// and always expire, so a forgotten experiment cannot leave the API degraded.

export interface ChaosState {
  latencyMs: number;
  errorRate: number;
  failReadiness: boolean;
  expiresAt: string | null;
}

const maxLatencyMs = 3000;
const maxDurationSeconds = 120;
const defaultDurationSeconds = 60;

// On for local development and tests. A production build must opt in with
// OPSLAB_CHAOS=on, because the endpoint deliberately degrades the service.
export const chaosEnabled = process.env.OPSLAB_CHAOS
  ? process.env.OPSLAB_CHAOS === 'on'
  : process.env.NODE_ENV !== 'production';

// When set, changing faults also requires this value in the x-opslab-chaos-token header.
export const chaosToken = process.env.OPSLAB_CHAOS_TOKEN ?? null;

const idle: ChaosState = { latencyMs: 0, errorRate: 0, failReadiness: false, expiresAt: null };
let state: ChaosState = { ...idle };
let expiresAtMs = 0;

export function clearChaos() {
  state = { ...idle };
  expiresAtMs = 0;
  return state;
}

export function getChaos() {
  if (expiresAtMs && Date.now() >= expiresAtMs) {
    clearChaos();
  }
  return state;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

export function setChaos(input: { latencyMs?: unknown; errorRate?: unknown; failReadiness?: unknown; durationSeconds?: unknown }) {
  const durationSeconds = Math.round(clamp(input.durationSeconds, 5, maxDurationSeconds, defaultDurationSeconds));
  expiresAtMs = Date.now() + durationSeconds * 1000;
  state = {
    latencyMs: Math.round(clamp(input.latencyMs, 0, maxLatencyMs, 0)),
    errorRate: Number(clamp(input.errorRate, 0, 1, 0).toFixed(2)),
    failReadiness: input.failReadiness === true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  return state;
}

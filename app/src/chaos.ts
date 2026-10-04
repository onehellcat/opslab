// Opt-in fault injection for the incident lab. Faults only affect this process
// and always expire, so a forgotten experiment cannot leave the API degraded.

export interface ChaosState {
  latencyMs: number;
  failReadiness: boolean;
  expiresAt: string | null;
}

const maxLatencyMs = 3000;
const maxDurationSeconds = 120;
const defaultDurationSeconds = 60;

export const chaosEnabled = process.env.OPSLAB_CHAOS !== 'off';

let state: ChaosState = { latencyMs: 0, failReadiness: false, expiresAt: null };
let expiresAtMs = 0;

export function clearChaos() {
  state = { latencyMs: 0, failReadiness: false, expiresAt: null };
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
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

export function setChaos(input: { latencyMs?: unknown; failReadiness?: unknown; durationSeconds?: unknown }) {
  const durationSeconds = clamp(input.durationSeconds, 5, maxDurationSeconds, defaultDurationSeconds);
  expiresAtMs = Date.now() + durationSeconds * 1000;
  state = {
    latencyMs: clamp(input.latencyMs, 0, maxLatencyMs, 0),
    failReadiness: input.failReadiness === true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
  return state;
}

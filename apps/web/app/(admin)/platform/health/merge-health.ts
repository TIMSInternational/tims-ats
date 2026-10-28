// Pure merge of the two health sources the page reads:
//   1. tRPC `platform.getSystemHealth` — the database row (a live SELECT 1), the auth activity counts, stats.
//   2. C# `GET /platform/health/dependencies` — live read-only probes for the other seven rows.
//
// The rule: a row is only operational/degraded/down when a probe established it just now. Anything the page
// could not verify is `not_configured` or `not_monitored`, with a reason code the UI renders as text.

import {
  DEPENDENCY_HEALTH_MAX_AGE_MS,
  type DependencyHealthState,
  type DependencyStatus,
} from '../../../../lib/platform-api/platform-health';
import type { HealthService } from '../../../../lib/trpc-types';

export type DisplayStatus = DependencyStatus;
export type OverallStatus = 'operational' | 'degraded' | 'down' | 'incomplete';

export interface DisplayMetric {
  id: string;
  value: string | null;
  color?: 'green' | 'amber' | 'red';
}

export interface DisplayService {
  id: string;
  status: DisplayStatus;
  reason: string | null;
  metrics: DisplayMetric[];
}

/**
 * State of the tRPC source. `error` = the last tRPC request failed (initial or background refresh);
 * `loading` = no tRPC result yet. Either way the tRPC rows are not shown as a state, but the probe rows
 * still are: the two sources are independent and one failing must not hide the other (tier-1 review).
 */
export type TrpcSourceState = 'ok' | 'loading' | 'error';

/** Rows whose state comes from the tRPC source; always rendered, even when that source has no data. */
export const TRPC_SERVICE_IDS = ['database'] as const;

/** Rows whose state comes from the C# probes. `database` stays on the tRPC probe. */
export const PROBED_SERVICE_IDS = ['api_gateway', 'auth', 'storage', 'jobs', 'ai', 'email', 'realtime'] as const;

const PROBED = new Set<string>(PROBED_SERVICE_IDS);

const fromTrpcStatus = (status: string): DisplayStatus =>
  status === 'operational' || status === 'degraded' || status === 'down' ? status : 'not_monitored';

/** Real activity counts the tRPC path measures for auth; every other tRPC metric on a probed row is a null placeholder. */
const keepTrpcMetrics = (id: string, metrics: HealthService['metrics']): DisplayMetric[] =>
  id === 'auth' ? metrics.map((metric) => ({ ...metric })) : [];

function unavailableRow(id: string, reason: string, apiStatus: DisplayStatus, trpc?: HealthService): DisplayService {
  return {
    id,
    status: id === 'api_gateway' ? apiStatus : 'not_monitored',
    reason,
    metrics: trpc ? keepTrpcMetrics(id, trpc.metrics) : [],
  };
}

/** True when a dependency result is too old (or undated) to be shown as a current state. */
export function isExpiredProbeResult(checkedAt: Date, now: Date): boolean {
  const at = checkedAt.getTime();
  return !Number.isFinite(at) || now.getTime() - at > DEPENDENCY_HEALTH_MAX_AGE_MS;
}

/**
 * The time the banner shows: the OLDER of the two measurements, so a fresh tRPC refresh never makes an older
 * dependency result look new (tier-1 review: the banner used the tRPC refresh time for both sources).
 */
/** The local-clock time a probe result applies from: receipt time when known (skew-free), else checkedAt. */
export function probeResultTime(probes: Extract<DependencyHealthState, { kind: 'ok' }>): Date {
  return probes.receivedAt !== undefined ? new Date(probes.receivedAt) : probes.checkedAt;
}

/** `trpcUpdatedAt <= 0` means the tRPC source has no usable measurement; only the probe time then counts. */
export function healthMeasuredAt(trpcUpdatedAt: number, probes: DependencyHealthState): number {
  const trpcAt = trpcUpdatedAt > 0 ? trpcUpdatedAt : 0;
  if (probes.kind !== 'ok') return trpcAt;
  const at = probeResultTime(probes).getTime();
  if (!(Number.isFinite(at) && at > 0)) return trpcAt;
  return trpcAt > 0 ? Math.min(trpcAt, at) : at;
}

export function mergeHealthServices(
  trpcServices: HealthService[],
  probes: DependencyHealthState,
  now: Date = new Date(),
  /** When the tRPC rows were measured (react-query dataUpdatedAt); omitted = treated as current. */
  trpcUpdatedAt: number = now.getTime(),
  /** Whether the tRPC source answered; on `loading`/`error` its rows render unverified, probes still render. */
  trpcState: TrpcSourceState = 'ok',
): DisplayService[] {
  const trpcRows = trpcState === 'ok' ? trpcServices : [];
  // The tRPC rows (the database row) expire by the same rule as the probes: a stalled tRPC poll must not
  // keep an arbitrarily old green database row on screen (tier-1 review).
  const trpcExpired = isExpiredProbeResult(new Date(trpcUpdatedAt), now);
  const trpcById = new Map(trpcRows.map((service) => [service.id as string, service]));
  const ids: string[] = trpcRows.map((service) => service.id);
  // Without tRPC rows, keep the grid order the tRPC source uses (API first, database second).
  for (const id of [PROBED_SERVICE_IDS[0], ...TRPC_SERVICE_IDS, ...PROBED_SERVICE_IDS.slice(1)]) {
    if (!ids.includes(id)) ids.push(id);
  }
  const trpcUnavailableReason = trpcState === 'error' ? 'trpc_unavailable' : 'checking';

  return ids.map((id): DisplayService => {
    const trpc = trpcById.get(id);
    if (!PROBED.has(id)) {
      if (trpcState !== 'ok') return { id, status: 'not_monitored', reason: trpcUnavailableReason, metrics: [] };
      if (trpc && trpcExpired) return { id, status: 'not_monitored', reason: 'stale_result', metrics: [] };
      return {
        id,
        status: trpc ? fromTrpcStatus(trpc.status) : 'not_monitored',
        reason: null,
        metrics: trpc?.metrics.map((metric) => ({ ...metric })) ?? [],
      };
    }

    switch (probes.kind) {
      case 'disabled':
        return unavailableRow(id, 'platform_api_not_configured', 'not_configured', trpc);
      case 'loading':
        return unavailableRow(id, 'checking', 'not_monitored', trpc);
      case 'unavailable':
        return unavailableRow(
          id,
          probes.reason === 'unreachable' && id !== 'api_gateway' ? 'platform_api_unreachable' : probes.reason,
          probes.reason === 'unreachable' ? 'down' : 'not_monitored',
          trpc,
        );
      case 'ok': {
        if (isExpiredProbeResult(probeResultTime(probes), now))
          return unavailableRow(id, 'stale_result', 'not_monitored', trpc);
        const probe = probes.dependencies.find((dependency) => dependency.id === id);
        if (!probe) return unavailableRow(id, 'probe_failed', 'not_monitored', trpc);
        const metrics: DisplayMetric[] = [];
        if (probe.latencyMs !== null) metrics.push({ id: 'probe_latency', value: `${probe.latencyMs}ms` });
        metrics.push(...probe.metrics.map((metric) => ({ id: metric.id, value: metric.value })));
        metrics.push(...(trpc ? keepTrpcMetrics(id, trpc.metrics) : []));
        return { id, status: probe.status, reason: probe.reason, metrics };
      }
    }
  });
}

/**
 * Down beats degraded beats incomplete. A row reported `not_used` (a dependency the platform does not have)
 * does not make monitoring "incomplete"; every other unverified row does.
 */
export function overallHealthStatus(services: DisplayService[]): OverallStatus {
  if (services.length === 0) return 'incomplete';
  if (services.some((service) => service.status === 'down')) return 'down';
  if (services.some((service) => service.status === 'degraded')) return 'degraded';
  const unverified = services.some(
    (service) =>
      service.status === 'not_configured' || (service.status === 'not_monitored' && service.reason !== 'not_used'),
  );
  return unverified ? 'incomplete' : 'operational';
}

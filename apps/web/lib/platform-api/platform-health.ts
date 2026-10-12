'use client';

// Platform Health page — live dependency probes from the C# Platform service
// (GET /platform/health/dependencies, services/Tims.Platform/src/Tims.Api/PlatformHealth).
//
// Unlike the strangler wrappers this is NOT a dual path: there is no tRPC twin (new probe logic does not go
// into packages/api). The page keeps reading the database row, stats and recent errors from
// `platform.getSystemHealth`, and overlays these results on the other seven rows (see
// app/(admin)/platform/health/merge-health.ts).
//
// Every failure mode maps to an explicit, honest state — the hook never throws into the page and never
// invents a green row:
//   - no platform API configured        → { kind: 'disabled' }
//   - the relay/C# could not be reached → { kind: 'unavailable', reason: 'unreachable' }  (API row: down)
//   - 404 (the C# flag is still dark)   → { kind: 'unavailable', reason: 'probes_disabled' }
//   - 401/403                           → { kind: 'unavailable', reason: 'access_denied' }

import { useQuery } from '@tanstack/react-query';
import { isPlatformApiEnabled, platformGet, PlatformApiError } from './client';

export const DEPENDENCY_STATUSES = ['operational', 'degraded', 'down', 'not_configured', 'not_monitored'] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export interface DependencyMetric {
  id: string;
  value: string | null;
}

export interface DependencyResult {
  id: string;
  status: DependencyStatus;
  reason: string | null;
  latencyMs: number | null;
  metrics: DependencyMetric[];
}

export type DependencyUnavailableReason = 'unreachable' | 'probes_disabled' | 'access_denied' | 'probe_failed';

export type DependencyHealthState =
  | { kind: 'disabled' }
  | { kind: 'loading' }
  | { kind: 'ok'; checkedAt: Date; dependencies: DependencyResult[] }
  | { kind: 'unavailable'; reason: DependencyUnavailableReason };

/** The page polls every 30s; the server caches 30–60s, so this never fans out to the dependencies. */
export const DEPENDENCY_HEALTH_REFETCH_MS = 30_000;
/** The relay itself waits up to 30s on the upstream; the page gives up sooner and says so. */
export const DEPENDENCY_HEALTH_CLIENT_TIMEOUT_MS = 8_000;

const isStatus = (value: unknown): value is DependencyStatus =>
  typeof value === 'string' && (DEPENDENCY_STATUSES as readonly string[]).includes(value);

const shortToken = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null;

/**
 * Wire → view. The C# contract types int64 as `number | string`; an unknown status (a newer server, a bad
 * proxy) is shown as not_monitored rather than trusted, and every string is length-bounded.
 */
export function mapDependencyHealth(raw: unknown): { checkedAt: Date; dependencies: DependencyResult[] } {
  const body = (raw ?? {}) as { checkedAt?: unknown; dependencies?: unknown };
  const list = Array.isArray(body.dependencies) ? body.dependencies : [];
  const dependencies = list.flatMap((item): DependencyResult[] => {
    const d = (item ?? {}) as Record<string, unknown>;
    const id = shortToken(d.id);
    if (!id) return [];
    const known = isStatus(d.status);
    const latency = d.latencyMs === null || d.latencyMs === undefined ? null : Number(d.latencyMs);
    const metrics = Array.isArray(d.metrics) ? d.metrics : [];
    return [
      {
        id,
        status: known ? (d.status as DependencyStatus) : 'not_monitored',
        reason: known ? shortToken(d.reason) : 'probe_failed',
        latencyMs: latency !== null && Number.isFinite(latency) ? latency : null,
        metrics: metrics.flatMap((m): DependencyMetric[] => {
          const metric = (m ?? {}) as Record<string, unknown>;
          const metricId = shortToken(metric.id);
          return metricId ? [{ id: metricId, value: shortToken(metric.value) }] : [];
        }),
      },
    ];
  });
  const checkedAt = new Date(typeof body.checkedAt === 'string' ? body.checkedAt : Number.NaN);
  return { checkedAt, dependencies };
}

/** Any failure → the honest unavailable reason. A non-HTTP failure (network, client timeout) is unreachable. */
export function classifyDependencyHealthError(error: unknown): DependencyUnavailableReason {
  if (error instanceof PlatformApiError) {
    if (error.status === 404) return 'probes_disabled';
    if (error.status === 401 || error.status === 403) return 'access_denied';
    if (error.status >= 500) return 'unreachable';
    return 'probe_failed';
  }
  return 'unreachable';
}

async function fetchDependencyHealth(): Promise<DependencyHealthState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      platformGet('/platform/health/dependencies'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dependency health timed out')), DEPENDENCY_HEALTH_CLIENT_TIMEOUT_MS);
      }),
    ]);
    return { kind: 'ok', ...mapDependencyHealth(raw) };
  } catch (error) {
    return { kind: 'unavailable', reason: classifyDependencyHealthError(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function usePlatformDependencyHealth(): { state: DependencyHealthState; refetch: () => void } {
  const enabled = isPlatformApiEnabled();
  const query = useQuery({
    queryKey: ['platform-health', 'dependencies'],
    queryFn: fetchDependencyHealth,
    enabled,
    refetchInterval: DEPENDENCY_HEALTH_REFETCH_MS,
    retry: false,
  });
  const state: DependencyHealthState = !enabled ? { kind: 'disabled' } : (query.data ?? { kind: 'loading' });
  return { state, refetch: () => void query.refetch() };
}

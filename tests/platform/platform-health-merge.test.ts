import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  healthMeasuredAt,
  isExpiredProbeResult,
  mergeHealthServices,
  overallHealthStatus,
  PROBED_SERVICE_IDS,
} from '../../apps/web/app/(admin)/platform/health/merge-health';
import {
  classifyDependencyHealthError,
  mapDependencyHealth,
  type DependencyHealthState,
  type DependencyResult,
} from '../../apps/web/lib/platform-api/platform-health';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';
import { buildSystemHealthServices } from '../../packages/api/src/routers/platform/system.helpers';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// The real tRPC output shape (database operational, seven placeholders) — not a hand-written stand-in.
const trpcServices = buildSystemHealthServices({
  dbHealthy: true,
  dbLatency: 12,
  orgCount: 2,
  userCount: 10,
  vacancyCount: 3,
  loginsToday: 4,
  failedLogins: 1,
  enabledUsers: 8,
  auditLogsToday: 30,
});

const dep = (id: string, status: DependencyResult['status'], reason: string | null = null): DependencyResult => ({
  id,
  status,
  reason,
  latencyMs: 42,
  metrics: [],
});

const allOperational: DependencyHealthState = {
  kind: 'ok',
  checkedAt: new Date('2026-10-12T12:00:00Z'),
  dependencies: [
    ...PROBED_SERVICE_IDS.filter((id) => id !== 'realtime').map((id) => dep(id, 'operational')),
    dep('realtime', 'not_monitored', 'not_used'),
  ],
};

const byId = (services: ReturnType<typeof mergeHealthServices>) => new Map(services.map((s) => [s.id, s]));

// 30 s after the fixtures' checkedAt: inside DEPENDENCY_HEALTH_MAX_AGE_MS.
const NOW = new Date('2026-10-12T12:00:30Z');

describe('mergeHealthServices — the database row stays on tRPC, the other seven come from the probes', () => {
  it('keeps the tRPC database row verbatim and overlays every probed row', () => {
    const services = byId(mergeHealthServices(trpcServices, allOperational, NOW));

    expect([...services.keys()]).toEqual([
      'api_gateway',
      'database',
      'auth',
      'storage',
      'jobs',
      'ai',
      'email',
      'realtime',
    ]);
    expect(services.get('database')?.status).toBe('operational');
    expect(services.get('database')?.metrics.find((m) => m.id === 'query_time')?.value).toBe('12ms');
    expect(services.get('storage')).toMatchObject({ status: 'operational', reason: null });
    expect(services.get('storage')?.metrics).toEqual([{ id: 'probe_latency', value: '42ms' }]);
    // auth keeps its real tRPC activity counts after the probe's own metrics.
    expect(services.get('auth')?.metrics.map((m) => m.id)).toEqual([
      'probe_latency',
      'logins_today',
      'failed_logins_today',
      'enabled_users',
    ]);
    // the old null placeholders on the other rows are gone, not shown as "N/A" next to a live state.
    expect(services.get('jobs')?.metrics.some((m) => m.id === 'queue')).toBe(false);
  });

  it('is operational overall when everything verifiable is, and a not_used row is not a gap', () => {
    expect(overallHealthStatus(mergeHealthServices(trpcServices, allOperational, NOW))).toBe('operational');
  });

  it('reports not_deployed workers and unconfigured services as incomplete — never operational', () => {
    const state: DependencyHealthState = {
      ...allOperational,
      dependencies: allOperational.dependencies.map((d) =>
        d.id === 'jobs'
          ? dep('jobs', 'not_monitored', 'not_deployed')
          : d.id === 'ai'
            ? dep('ai', 'not_configured', 'missing_config')
            : d,
      ),
    };
    const services = mergeHealthServices(trpcServices, state, NOW);

    expect(byId(services).get('jobs')).toMatchObject({ status: 'not_monitored', reason: 'not_deployed' });
    expect(overallHealthStatus(services)).toBe('incomplete');
  });

  it('down beats degraded beats incomplete', () => {
    const degraded: DependencyHealthState = {
      ...allOperational,
      dependencies: allOperational.dependencies.map((d) =>
        d.id === 'email' ? dep('email', 'degraded', 'quota_near_limit') : d,
      ),
    };
    expect(overallHealthStatus(mergeHealthServices(trpcServices, degraded, NOW))).toBe('degraded');

    const down: DependencyHealthState = {
      ...degraded,
      dependencies:
        degraded.kind === 'ok'
          ? degraded.dependencies.map((d) => (d.id === 'storage' ? dep('storage', 'down', 'not_found') : d))
          : [],
    };
    expect(overallHealthStatus(mergeHealthServices(trpcServices, down, NOW))).toBe('down');
  });

  it('an unreachable platform API marks the API row DOWN and claims nothing about the rest', () => {
    const services = byId(mergeHealthServices(trpcServices, { kind: 'unavailable', reason: 'unreachable' }, NOW));

    expect(services.get('api_gateway')).toMatchObject({ status: 'down', reason: 'unreachable' });
    for (const id of ['auth', 'storage', 'jobs', 'ai', 'email', 'realtime']) {
      expect(services.get(id)).toMatchObject({ status: 'not_monitored', reason: 'platform_api_unreachable' });
    }
    expect(services.get('database')?.status).toBe('operational');
  });

  it('a dark C# flag (404) or a refused credential is not_monitored everywhere, including the API row', () => {
    for (const reason of ['probes_disabled', 'access_denied'] as const) {
      const services = mergeHealthServices(trpcServices, { kind: 'unavailable', reason }, NOW);
      for (const service of services.filter((s) => s.id !== 'database')) {
        expect(service).toMatchObject({ status: 'not_monitored', reason });
      }
      expect(overallHealthStatus(services)).toBe('incomplete');
    }
  });

  it('no platform API at all: the API row is not_configured and nothing is guessed', () => {
    const services = byId(mergeHealthServices(trpcServices, { kind: 'disabled' }, NOW));

    expect(services.get('api_gateway')).toMatchObject({
      status: 'not_configured',
      reason: 'platform_api_not_configured',
    });
    expect(services.get('email')).toMatchObject({ status: 'not_monitored', reason: 'platform_api_not_configured' });
  });

  it('a probe missing from an ok response is not_monitored / probe_failed, not silently dropped', () => {
    const state: DependencyHealthState = { ...allOperational, dependencies: [dep('api_gateway', 'operational')] };
    expect(byId(mergeHealthServices(trpcServices, state, NOW)).get('ai')).toMatchObject({
      status: 'not_monitored',
      reason: 'probe_failed',
    });
  });
});

describe('mapDependencyHealth / classifyDependencyHealthError', () => {
  it('coerces int64-as-string latency and distrusts unknown statuses', () => {
    const mapped = mapDependencyHealth({
      checkedAt: '2026-10-12T12:00:00+00:00',
      cacheSeconds: 30,
      dependencies: [
        { id: 'auth', status: 'operational', reason: null, latencyMs: '17', metrics: [{ id: 'x', value: '1' }] },
        { id: 'ai', status: 'green', reason: 'whatever', latencyMs: null, metrics: [] },
        { id: '', status: 'operational' },
      ],
    });

    expect(mapped.checkedAt.toISOString()).toBe('2026-10-12T12:00:00.000Z');
    expect(mapped.dependencies).toEqual([
      { id: 'auth', status: 'operational', reason: null, latencyMs: 17, metrics: [{ id: 'x', value: '1' }] },
      { id: 'ai', status: 'not_monitored', reason: 'probe_failed', latencyMs: null, metrics: [] },
    ]);
  });

  it('maps every failure to an honest reason', () => {
    expect(classifyDependencyHealthError(new PlatformApiError(404, 'Not Found'))).toBe('probes_disabled');
    expect(classifyDependencyHealthError(new PlatformApiError(401, 'Unauthorized'))).toBe('access_denied');
    expect(classifyDependencyHealthError(new PlatformApiError(403, 'Forbidden'))).toBe('access_denied');
    expect(classifyDependencyHealthError(new PlatformApiError(502, 'Bad Gateway'))).toBe('unreachable');
    expect(classifyDependencyHealthError(new PlatformApiError(400, 'Bad Request'))).toBe('probe_failed');
    expect(classifyDependencyHealthError(new TypeError('fetch failed'))).toBe('unreachable');
  });
});

describe('i18n covers every code the server and the merge can emit', () => {
  const reasons = [
    'timeout',
    'unreachable',
    'error_status',
    'access_denied',
    'not_found',
    'misconfigured',
    'missing_config',
    'sending_paused',
    'quota_near_limit',
    'quota_exhausted',
    'guardrail_not_ready',
    'guardrail_failed',
    'readiness_failed',
    'heartbeat_stale',
    'not_deployed',
    'not_used',
    'probe_failed',
    'checking',
    'platform_api_not_configured',
    'platform_api_unreachable',
    'probes_disabled',
    'stale_result',
    'trpc_unavailable',
    'unknown',
  ];
  const metrics = [
    'probe_latency',
    'ready_postgres',
    'ready_redis',
    'sent_last_24h',
    'max_24h_send',
    'quota_used_pct',
    'guardrail_status',
    'worker_nodes',
    'heartbeat_age_s',
  ];

  for (const [name, dict] of [
    ['es', es],
    ['en', en],
  ] as const) {
    it(`${name}: every reason code and metric label is translated`, () => {
      for (const code of reasons) expect((dict.health.reasons as Record<string, string>)[code], code).toBeTruthy();
      for (const id of metrics) expect((dict.health.metricLabels as Record<string, string>)[id], id).toBeTruthy();
      expect(dict.health.statusNotConfigured).toBeTruthy();
      expect(dict.health.statusNotMonitored).toBeTruthy();
    });
  }
});

describe('cross-stack pin — the web app translates every reason code the C# probes can emit', () => {
  it('every DependencyReason constant in DependencyHealthModels.cs has an es and en translation', () => {
    const source = readFileSync(
      resolve(__dirname, '../../services/Tims.Platform/src/Tims.Application/PlatformHealth/DependencyHealthModels.cs'),
      'utf8',
    );
    // A bounded regex capture of the one class body (no open-ended slice — see no-hollow-source-slices).
    const block = /public static class DependencyReason\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
    const codes = [...block.matchAll(/public const string \w+ = "([a-z_]+)";/g)].map((m) => m[1]!);

    expect(codes.length).toBeGreaterThanOrEqual(15);
    for (const code of codes) {
      expect((es.health.reasons as Record<string, string>)[code], `es reason ${code}`).toBeTruthy();
      expect((en.health.reasons as Record<string, string>)[code], `en reason ${code}`).toBeTruthy();
    }
  });
});

describe('expired dependency results are never shown as a current state (tier-1 review)', () => {
  const okAt = (checkedAt: Date) => ({ ...allOperational, checkedAt }) as typeof allOperational;

  it('a result older than the max age makes every probed row unverified, not green', () => {
    const old = okAt(new Date(NOW.getTime() - 121_000));
    const services = byId(mergeHealthServices(trpcServices, old, NOW));
    for (const id of ['api_gateway', 'auth', 'storage', 'jobs', 'ai', 'email', 'realtime']) {
      expect(services.get(id)).toMatchObject({ status: 'not_monitored', reason: 'stale_result' });
    }
    expect(overallHealthStatus(mergeHealthServices(trpcServices, old, NOW))).toBe('incomplete');
    expect(isExpiredProbeResult(new Date(Number.NaN), NOW)).toBe(true);
  });

  it('expiry uses the browser receipt time, so server/browser clock skew cannot keep or kill a result (tier-1 r4)', () => {
    // Server clock 10 minutes AHEAD of the browser (checkedAt in the browser's future), received just now.
    const ahead = { ...okAt(new Date(NOW.getTime() + 600_000)), receivedAt: NOW.getTime() - 5_000 };
    expect(byId(mergeHealthServices(trpcServices, ahead, NOW)).get('ai')?.reason).not.toBe('stale_result');
    // Server clock 10 minutes BEHIND, received just now: still current.
    const behind = { ...okAt(new Date(NOW.getTime() - 600_000)), receivedAt: NOW.getTime() - 5_000 };
    expect(byId(mergeHealthServices(trpcServices, behind, NOW)).get('ai')?.reason).not.toBe('stale_result');
    // Received 3 minutes ago (polling stalled): expired whatever the server's timestamp says.
    const oldReceipt = { ...okAt(new Date(NOW.getTime() + 600_000)), receivedAt: NOW.getTime() - 180_000 };
    expect(byId(mergeHealthServices(trpcServices, oldReceipt, NOW)).get('ai')?.reason).toBe('stale_result');
  });

  it('an old tRPC measurement makes the database row unverified too (tier-1 r3)', () => {
    const fresh = okAt(new Date(NOW.getTime() - 10_000));
    const stale = byId(mergeHealthServices(trpcServices, fresh, NOW, NOW.getTime() - 121_000));
    expect(stale.get('database')).toMatchObject({ status: 'not_monitored', reason: 'stale_result' });
    const current = byId(mergeHealthServices(trpcServices, fresh, NOW, NOW.getTime() - 10_000));
    expect(current.get('database')?.status).toBe('operational');
  });

  it('the banner shows the OLDER of the two measurements', () => {
    const probedAt = new Date(NOW.getTime() - 50_000);
    expect(healthMeasuredAt(NOW.getTime(), okAt(probedAt))).toBe(probedAt.getTime());
    expect(healthMeasuredAt(NOW.getTime() - 90_000, okAt(probedAt))).toBe(NOW.getTime() - 90_000);
    expect(healthMeasuredAt(NOW.getTime(), { kind: 'loading' })).toBe(NOW.getTime());
  });

  it('a tRPC source with no usable result leaves only the probe time on the banner', () => {
    const probedAt = new Date(NOW.getTime() - 50_000);
    expect(healthMeasuredAt(0, okAt(probedAt))).toBe(probedAt.getTime());
    expect(healthMeasuredAt(0, { kind: 'unavailable', reason: 'unreachable' })).toBe(0);
  });

  it('the page re-evaluates expiry on a clock, so a stalled poll cannot keep a result green', () => {
    // Source-level: the page needs trpc + react-query mocks to mount; the merge rule itself is tested above.
    const page = readFileSync(resolve(__dirname, '../../apps/web/app/(admin)/platform/health/page.tsx'), 'utf8');
    expect(page).toMatch(/setInterval\(\(\) => setNow\(new Date\(\)\), 15_000\)/);
    expect(page).toMatch(
      /mergeHealthServices\(trpcData\?\.services \?\? \[\], dependencyHealth\.state, now, dataUpdatedAt, trpcState\)/,
    );
  });

  it('the dependency query re-probes on every visit instead of serving the 5-minute provider cache', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/web/lib/platform-api/platform-health.ts'), 'utf8');
    expect(src).toMatch(/staleTime: 0,/);
    expect(src).toMatch(/refetchOnMount: 'always',/);
  });
});

describe('the two sources are independent — a tRPC failure never hides the probe rows (tier-1 review r4-2)', () => {
  it('tRPC error: probe rows keep their states; the database row is unverified / trpc_unavailable', () => {
    const services = byId(mergeHealthServices(trpcServices, allOperational, NOW, NOW.getTime(), 'error'));
    for (const id of PROBED_SERVICE_IDS.filter((x) => x !== 'realtime'))
      expect(services.get(id)?.status, id).toBe('operational');
    expect(services.get('database')).toEqual({
      id: 'database',
      status: 'not_monitored',
      reason: 'trpc_unavailable',
      metrics: [],
    });
    // Cached tRPC auth counts from a failed refresh are not overlaid on the probe row.
    expect(services.get('auth')?.metrics.some((m) => m.id === 'logins_today')).toBe(false);
  });

  it('tRPC error with no tRPC data at all still renders a database row, in the usual grid order', () => {
    const services = mergeHealthServices([], allOperational, NOW, 0, 'error');
    expect(services.map((s) => s.id)).toEqual(['api_gateway', 'database', ...PROBED_SERVICE_IDS.slice(1)]);
    expect(overallHealthStatus(services)).toBe('incomplete');
  });

  it('tRPC still loading: the database row is checking, the probe rows are shown', () => {
    const services = byId(mergeHealthServices([], allOperational, NOW, 0, 'loading'));
    expect(services.get('database')?.reason).toBe('checking');
    expect(services.get('email')?.status).toBe('operational');
  });

  it('a probe-found outage still drives the overall state when tRPC fails', () => {
    const storageDown: DependencyHealthState = {
      ...allOperational,
      dependencies: allOperational.dependencies.map((d) =>
        d.id === 'storage' ? dep('storage', 'down', 'not_found') : d,
      ),
    } as DependencyHealthState;
    expect(overallHealthStatus(mergeHealthServices([], storageDown, NOW, 0, 'error'))).toBe('down');
  });
});

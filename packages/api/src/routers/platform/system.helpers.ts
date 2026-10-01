import { logger } from '@tims/shared';

export const auditLogSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  userId: true,
  metadata: true,
  createdAt: true,
  ipAddress: true,
  actor: { select: { id: true, firstName: true, lastName: true, email: true, avatar: true } },
} as const;

export const SYSTEM_FLAG_KEYS = [
  'ai_enabled',
  'nine_box_enabled',
  'dei_enabled',
  'compensation_enabled',
  'succession_enabled',
  'video_interviews',
  'whatsapp_enabled',
  'advanced_analytics',
  'api_access',
  'sso_saml',
];

export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unmonitored';

/** Stable ids: the web app renders localized names/labels from them (health.services.* / health.metrics.*). */
export type HealthServiceId = 'api_gateway' | 'database' | 'auth' | 'storage' | 'jobs' | 'ai' | 'email' | 'realtime';

export type HealthMetricId =
  | 'api_latency'
  | 'availability'
  | 'requests_per_min'
  | 'connectivity'
  | 'query_time'
  | 'entity_counts'
  | 'logins_today'
  | 'failed_logins_today'
  | 'enabled_users'
  | 'storage_used'
  | 'uploads_today'
  | 'queue'
  | 'failed_jobs'
  | 'processed_today'
  | 'ai_calls_today'
  | 'ai_cost'
  | 'ai_budget'
  | 'emails_sent_today'
  | 'bounce_rate'
  | 'reputation'
  | 'connections'
  | 'messages_per_sec'
  | 'active_channels';

export interface HealthMetric {
  id: HealthMetricId;
  /** Locale-invariant value (a number, "12ms", "OK"); null = not measured / unavailable. */
  value: string | null;
  color?: 'green' | 'amber' | 'red';
}

export interface HealthService {
  id: HealthServiceId;
  status: HealthStatus;
  metrics: HealthMetric[];
}

/** A count that could not be read (DB down, or that one query failed) is null — never a guessed 0. */
export interface SystemHealthCounts {
  userCount: number | null;
  orgCount: number | null;
  loginsToday: number | null;
  enabledUsers: number | null;
  auditLogsToday: number | null;
  vacancyCount: number | null;
  failedLogins: number | null;
}

interface SystemHealthInputs extends SystemHealthCounts {
  dbHealthy: boolean;
  dbLatency: number;
}

const unmeasured = (...ids: HealthMetricId[]): HealthMetric[] => ids.map((id) => ({ id, value: null }));
const countValue = (count: number | null): string | null => (count === null ? null : String(count));

/** Logs a swallowed health-probe failure by error NAME only — never the message (it can carry SQL/PII). */
export function logHealthFailure(probe: string, error: unknown): void {
  logger.warn(
    { module: 'platform_health', probe, error: error instanceof Error ? error.name : typeof error },
    'system health probe failed',
  );
}

/**
 * Reads every count independently: one failing query yields null for that count instead of rejecting the
 * whole health check. When the SELECT 1 probe already failed, no count is attempted (all null) — the page
 * must be able to SAY the database is down, not fail with a 500 trying to count rows in it.
 */
export async function readSystemHealthCounts(
  dbHealthy: boolean,
  queries: { [K in keyof SystemHealthCounts]: () => Promise<number> },
): Promise<SystemHealthCounts> {
  const keys = Object.keys(queries) as Array<keyof SystemHealthCounts>;
  const entries = await Promise.all(
    keys.map(
      async (key) =>
        [
          key,
          dbHealthy
            ? await queries[key]().catch((error: unknown) => {
                logHealthFailure(`count:${key}`, error);
                return null;
              })
            : null,
        ] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<keyof SystemHealthCounts, number | null>;
}

/**
 * Only a successful live DB query establishes a service's operational state. A reachable database whose
 * counts could not all be read is degraded, not operational.
 */
export function buildSystemHealthServices({
  dbHealthy,
  dbLatency,
  userCount,
  vacancyCount,
  orgCount,
  loginsToday,
  failedLogins,
  enabledUsers,
  auditLogsToday,
}: SystemHealthInputs): HealthService[] {
  const countsComplete = [userCount, orgCount, vacancyCount, loginsToday, failedLogins, enabledUsers, auditLogsToday].every(
    (count) => count !== null,
  );
  const entityCounts =
    userCount === null || orgCount === null || vacancyCount === null ? null : `${userCount} / ${orgCount} / ${vacancyCount}`;
  return [
    { id: 'api_gateway', status: 'unmonitored', metrics: unmeasured('api_latency', 'availability', 'requests_per_min') },
    {
      id: 'database',
      status: !dbHealthy ? 'down' : countsComplete ? 'operational' : 'degraded',
      metrics: [
        { id: 'connectivity', value: dbHealthy ? 'OK' : null, color: dbHealthy ? undefined : 'red' },
        {
          id: 'query_time',
          value: dbHealthy ? `${dbLatency}ms` : null,
          color: dbHealthy ? (dbLatency < 50 ? 'green' : 'amber') : 'red',
        },
        { id: 'entity_counts', value: entityCounts },
      ],
    },
    {
      id: 'auth',
      status: 'unmonitored',
      metrics: [
        { id: 'logins_today', value: countValue(loginsToday) },
        {
          id: 'failed_logins_today',
          value: countValue(failedLogins),
          color: failedLogins !== null && failedLogins > 0 ? 'red' : undefined,
        },
        { id: 'enabled_users', value: countValue(enabledUsers) },
      ],
    },
    { id: 'storage', status: 'unmonitored', metrics: unmeasured('storage_used', 'uploads_today') },
    { id: 'jobs', status: 'unmonitored', metrics: unmeasured('queue', 'failed_jobs', 'processed_today') },
    { id: 'ai', status: 'unmonitored', metrics: unmeasured('ai_calls_today', 'ai_cost', 'ai_budget') },
    { id: 'email', status: 'unmonitored', metrics: unmeasured('emails_sent_today', 'bounce_rate', 'reputation') },
    { id: 'realtime', status: 'unmonitored', metrics: unmeasured('connections', 'messages_per_sec', 'active_channels') },
  ];
}

export function getOverallHealthStatus(services: HealthService[]): HealthStatus {
  if (services.some((service) => service.status === 'down')) return 'down';
  if (services.some((service) => service.status === 'degraded')) return 'degraded';
  if (services.length === 0 || services.some((service) => service.status === 'unmonitored')) return 'unmonitored';
  return 'operational';
}

import { describe, expect, it } from 'vitest';
import {
  buildSystemHealthServices,
  getOverallHealthStatus,
  readSystemHealthCounts,
} from '../../packages/api/src/routers/platform/system.helpers';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const inputs = {
  dbHealthy: true,
  dbLatency: 12,
  orgCount: 2,
  userCount: 10,
  vacancyCount: 3,
  loginsToday: 4,
  failedLogins: 1,
  enabledUsers: 8,
};

describe('platform health reports only measured states', () => {
  it('verifies the database probe without inferring seven other services are healthy', () => {
    const services = buildSystemHealthServices(inputs);
    expect(services).toHaveLength(8);
    expect(services.filter((service) => service.status === 'operational').map((service) => service.id)).toEqual([
      'database',
    ]);
    expect(services.filter((service) => service.status === 'unmonitored')).toHaveLength(7);
    expect(getOverallHealthStatus(services)).toBe('unmonitored');
    // Unmeasured metrics carry no value at all (the UI renders "N/D" / "N/A"), never a number.
    expect(services.find((service) => service.id === 'api_gateway')?.metrics[0]).toEqual({ id: 'api_latency', value: null });
    expect(services.find((service) => service.id === 'jobs')?.metrics[2]).toEqual({ id: 'processed_today', value: null });
  });

  it('reports database probe failures as down and does not show a measured latency', () => {
    const services = buildSystemHealthServices({ ...inputs, dbHealthy: false });
    const database = services.find((service) => service.id === 'database');
    expect(database?.status).toBe('down');
    expect(database?.metrics.find((metric) => metric.id === 'query_time')?.value).toBeNull();
    expect(database?.metrics.find((metric) => metric.id === 'connectivity')?.value).toBeNull();
    expect(getOverallHealthStatus(services)).toBe('down');
  });

  it('marks a reachable database whose counts could not all be read as degraded, with no invented numbers', () => {
    const services = buildSystemHealthServices({ ...inputs, userCount: null, failedLogins: null });
    const database = services.find((service) => service.id === 'database');
    expect(database?.status).toBe('degraded');
    expect(database?.metrics.find((metric) => metric.id === 'entity_counts')?.value).toBeNull();
    const auth = services.find((service) => service.id === 'auth');
    expect(auth?.metrics.find((metric) => metric.id === 'failed_logins_today')).toEqual({
      id: 'failed_logins_today',
      value: null,
      color: undefined,
    });
    expect(getOverallHealthStatus(services)).toBe('degraded');
  });

  it('does not turn account counts into a session-health claim', () => {
    const authentication = buildSystemHealthServices(inputs).find((service) => service.id === 'auth');
    expect(authentication?.status).toBe('unmonitored');
    expect(authentication?.metrics.map((metric) => metric.id)).toEqual([
      'logins_today',
      'failed_logins_today',
      'enabled_users',
    ]);
  });

  it('requires all services to be measured before declaring the whole platform operational', () => {
    const services = buildSystemHealthServices(inputs);
    expect(getOverallHealthStatus([])).toBe('unmonitored');
    expect(getOverallHealthStatus(services.map((service) => ({ ...service, status: 'operational' })))).toBe(
      'operational',
    );
    expect(getOverallHealthStatus(services.map((service) => ({ ...service, status: 'degraded' })))).toBe('degraded');
  });

  it('has an es and en label for every service and metric id the API returns', () => {
    for (const service of buildSystemHealthServices(inputs)) {
      expect(es.health.serviceNames[service.id]).toBeTruthy();
      expect(en.health.serviceNames[service.id]).toBeTruthy();
      for (const metric of service.metrics) {
        expect(es.health.metricLabels[metric.id]).toBeTruthy();
        expect(en.health.metricLabels[metric.id]).toBeTruthy();
      }
    }
  });
});

describe('readSystemHealthCounts', () => {
  const ok = (n: number) => () => Promise.resolve(n);
  const boom = () => Promise.reject(new Error('relation does not exist'));
  const queries = {
    userCount: ok(10),
    orgCount: ok(2),
    loginsToday: ok(4),
    enabledUsers: ok(8),
    auditLogsToday: ok(30),
    vacancyCount: ok(3),
    failedLogins: ok(1),
  };

  it('isolates one failing count as null instead of rejecting', async () => {
    await expect(readSystemHealthCounts(true, { ...queries, vacancyCount: boom })).resolves.toEqual({
      userCount: 10,
      orgCount: 2,
      loginsToday: 4,
      enabledUsers: 8,
      auditLogsToday: 30,
      vacancyCount: null,
      failedLogins: 1,
    });
  });

  it('attempts no count once the probe failed', async () => {
    let calls = 0;
    const counted = () => {
      calls += 1;
      return Promise.resolve(1);
    };
    const all = Object.fromEntries(Object.keys(queries).map((key) => [key, counted])) as typeof queries;
    const counts = await readSystemHealthCounts(false, all);
    expect(calls).toBe(0);
    expect(Object.values(counts).every((value) => value === null)).toBe(true);
  });
});

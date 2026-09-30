import { describe, expect, it } from 'vitest';
import {
  buildSystemHealthServices,
  getOverallHealthStatus,
} from '../../packages/api/src/routers/platform/system.helpers';

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
    expect(services.filter((service) => service.status === 'operational').map((service) => service.name)).toEqual([
      'Base de Datos',
    ]);
    expect(services.filter((service) => service.status === 'unmonitored')).toHaveLength(7);
    expect(getOverallHealthStatus(services)).toBe('unmonitored');
    expect(services.find((service) => service.name === 'API Gateway')?.metrics[0].value).toBe('N/D');
    expect(services.find((service) => service.name === 'Background Jobs')?.metrics[2].value).toBe('N/D');
  });

  it('reports database probe failures as down and does not show a measured latency', () => {
    const services = buildSystemHealthServices({ ...inputs, dbHealthy: false });
    const database = services.find((service) => service.name === 'Base de Datos');
    expect(database?.status).toBe('down');
    expect(database?.metrics.find((metric) => metric.label === 'Query time')?.value).toBe('N/D');
    expect(getOverallHealthStatus(services)).toBe('down');
  });

  it('does not turn account counts into a session-health claim', () => {
    const authentication = buildSystemHealthServices(inputs).find((service) => service.name === 'Autenticacion');
    expect(authentication?.status).toBe('unmonitored');
    expect(authentication?.metrics.map((metric) => metric.label)).toEqual([
      'Usuarios con ingreso hoy',
      'Fallos auditados hoy',
      'Usuarios habilitados',
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
});

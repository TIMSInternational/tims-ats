import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, renderHook, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

/**
 * platform-health-ui.test.tsx — the Health page's live-probe path at RUNTIME:
 *   1. usePlatformDependencyHealth requests the same-origin relay with the bearer token and maps the body;
 *      a 404 (C# flag dark), a 5xx and a network failure each become an honest unavailable state.
 *   2. HealthServiceGrid renders the five statuses and the reason text — a not_deployed worker row can never
 *      read "Operativo".
 */

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';

vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));

const payload = {
  // A fresh measurement: results older than DEPENDENCY_HEALTH_MAX_AGE_MS render as unverified.
  checkedAt: new Date().toISOString(),
  cacheSeconds: 30,
  ageMs: 0,
  dependencies: [
    {
      id: 'api_gateway',
      status: 'operational',
      reason: null,
      latencyMs: '4',
      metrics: [{ id: 'ready_postgres', value: 'healthy' }],
    },
    { id: 'auth', status: 'operational', reason: null, latencyMs: 80, metrics: [] },
    { id: 'storage', status: 'down', reason: 'not_found', latencyMs: 60, metrics: [] },
    {
      id: 'jobs',
      status: 'not_monitored',
      reason: 'not_deployed',
      latencyMs: 3,
      metrics: [{ id: 'worker_nodes', value: '0' }],
    },
    { id: 'ai', status: 'not_configured', reason: 'missing_config', latencyMs: null, metrics: [] },
    {
      id: 'email',
      status: 'degraded',
      reason: 'quota_near_limit',
      latencyMs: 90,
      metrics: [{ id: 'quota_used_pct', value: '90' }],
    },
    { id: 'realtime', status: 'not_monitored', reason: 'not_used', latencyMs: null, metrics: [] },
  ],
};

let respond: () => Promise<Response> = async () =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() => respond());
vi.stubGlobal('fetch', fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  fetchMock.mockClear();
});

describe('usePlatformDependencyHealth', () => {
  it('requests the relay with the bearer token and returns the mapped probes', async () => {
    const { usePlatformDependencyHealth } = await import('../../apps/web/lib/platform-api/platform-health');
    const { result } = renderHook(() => usePlatformDependencyHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.state.kind).toBe('ok'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/platform/platform/health/dependencies');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    const state = result.current.state;
    if (state.kind !== 'ok') throw new Error('expected ok');
    expect(state.dependencies.find((d) => d.id === 'api_gateway')?.latencyMs).toBe(4);
  });

  it('anchors the measurement time to the local request start minus the server-reported age (tier-1 r5)', async () => {
    const saved = respond;
    respond = async () =>
      new Response(JSON.stringify({ ...payload, ageMs: 45_000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const { usePlatformDependencyHealth } = await import('../../apps/web/lib/platform-api/platform-health');
    const before = Date.now();
    const { result } = renderHook(() => usePlatformDependencyHealth(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.state.kind).toBe('ok'));
    respond = saved;
    const state = result.current.state;
    if (state.kind !== 'ok') throw new Error('expected ok');
    // A cached 45-second-old answer is not presented as measured on receipt.
    expect(state.measuredAt).toBeLessThanOrEqual(Date.now() - 45_000);
    expect(state.measuredAt).toBeGreaterThanOrEqual(before - 45_000);
  });

  it.each([
    [404, 'probes_disabled'],
    [403, 'access_denied'],
    [502, 'unreachable'],
  ])('HTTP %i becomes unavailable/%s', async (status, reason) => {
    respond = async () => new Response('', { status });
    const { usePlatformDependencyHealth } = await import('../../apps/web/lib/platform-api/platform-health');
    const { result } = renderHook(() => usePlatformDependencyHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.state.kind).toBe('unavailable'));
    expect(result.current.state).toEqual({ kind: 'unavailable', reason });
  });

  it('a network failure is unreachable', async () => {
    respond = async () => {
      throw new TypeError('fetch failed');
    };
    const { usePlatformDependencyHealth } = await import('../../apps/web/lib/platform-api/platform-health');
    const { result } = renderHook(() => usePlatformDependencyHealth(), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.state).toEqual({ kind: 'unavailable', reason: 'unreachable' }));
  });
});

describe('HealthServiceGrid', () => {
  it('renders each probed state with its honest label and reason', async () => {
    const { HealthServiceGrid } = await import('../../apps/web/app/(admin)/platform/health/health-service-grid');
    const { mergeHealthServices } = await import('../../apps/web/app/(admin)/platform/health/merge-health');
    const { mapDependencyHealth } = await import('../../apps/web/lib/platform-api/platform-health');

    const { checkedAt, dependencies } = mapDependencyHealth(payload);
    const services = mergeHealthServices([], { kind: 'ok', checkedAt, measuredAt: Date.now(), dependencies });
    render(<HealthServiceGrid services={services} />);

    const card = (id: string) => screen.getByTestId(`health-service-${id}`);
    expect(card('api_gateway')).toHaveAttribute('data-status', 'operational');
    expect(within(card('api_gateway')).getByText(es.health.statusOperational)).toBeInTheDocument();
    expect(within(card('api_gateway')).getByText(es.health.metricValues.healthy)).toBeInTheDocument();

    expect(within(card('storage')).getByText(es.health.statusDown)).toBeInTheDocument();
    expect(within(card('storage')).getByText(es.health.reasons.not_found)).toBeInTheDocument();

    expect(card('jobs')).toHaveAttribute('data-status', 'not_monitored');
    expect(within(card('jobs')).getByText(es.health.statusNotMonitored)).toBeInTheDocument();
    expect(within(card('jobs')).getByText(es.health.reasons.not_deployed)).toBeInTheDocument();
    expect(within(card('jobs')).queryByText(es.health.statusOperational)).toBeNull();

    expect(within(card('ai')).getByText(es.health.statusNotConfigured)).toBeInTheDocument();
    expect(within(card('email')).getByText(es.health.statusDegraded)).toBeInTheDocument();
    expect(within(card('email')).getByText('90')).toBeInTheDocument();
    expect(within(card('realtime')).getByText(es.health.reasons.not_used)).toBeInTheDocument();
  });

  it('renders an unmeasured metric as N/D, never as a number', async () => {
    const { HealthServiceGrid } = await import('../../apps/web/app/(admin)/platform/health/health-service-grid');
    render(
      <HealthServiceGrid
        services={[
          { id: 'database', status: 'down', reason: null, metrics: [{ id: 'query_time', value: null, color: 'red' }] },
        ]}
      />,
    );

    expect(within(screen.getByTestId('health-service-database')).getByText(es.health.notAvailable)).toBeInTheDocument();
  });
});

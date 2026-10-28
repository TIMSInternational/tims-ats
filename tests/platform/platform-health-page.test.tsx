import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

/**
 * platform-health-page.test.tsx — the Health page MOUNTED, with the two sources failing independently:
 *   - tRPC `platform.getSystemHealth` failing must not hide the C# dependency results that did load: the probe
 *     rows render, the database row is unverified with a scoped reason, and a scoped notice replaces the old
 *     full-page error (tier-1 review r4-2).
 *   - a failed BACKGROUND tRPC refresh (data still cached) behaves the same: the stale database row is not shown
 *     as a current state.
 */

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';

type TrpcResult = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  dataUpdatedAt: number;
};

const mocks = vi.hoisted(() => ({
  trpc: { current: undefined as unknown as TrpcResult },
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { platform: { getSystemHealth: { useQuery: () => mocks.trpc.current } } },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));

const probes = () => ({
  checkedAt: new Date().toISOString(),
  cacheSeconds: 30,
  dependencies: [
    { id: 'api_gateway', status: 'operational', reason: null, latencyMs: 4, metrics: [] },
    { id: 'auth', status: 'operational', reason: null, latencyMs: 80, metrics: [] },
    { id: 'storage', status: 'down', reason: 'not_found', latencyMs: 60, metrics: [] },
    { id: 'jobs', status: 'not_monitored', reason: 'not_deployed', latencyMs: 3, metrics: [] },
    { id: 'ai', status: 'operational', reason: null, latencyMs: 40, metrics: [] },
    { id: 'email', status: 'operational', reason: null, latencyMs: 90, metrics: [] },
    { id: 'realtime', status: 'not_monitored', reason: 'not_used', latencyMs: null, metrics: [] },
  ],
});

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
  async () => new Response(JSON.stringify(probes()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);
vi.stubGlobal('fetch', fetchMock);

const healthyTrpcData = {
  services: [
    { id: 'api_gateway', status: 'unmonitored', metrics: [] },
    {
      id: 'database',
      status: 'operational',
      metrics: [{ id: 'connectivity', value: 'OK' }],
    },
  ],
  recentErrors: [],
  stats: { userCount: 12, orgCount: 3, loginsToday: 5, auditLogsToday: 9 },
};

async function renderPage() {
  const { default: PlatformHealthPage } = await import('../../apps/web/app/(admin)/platform/health/page');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlatformHealthPage />
    </QueryClientProvider>,
  );
}

const card = (id: string) => screen.getByTestId(`health-service-${id}`);

beforeEach(() => {
  fetchMock.mockClear();
});

describe('PlatformHealthPage — independent sources', () => {
  it('a failed tRPC query still renders the dependency results, with a scoped error', async () => {
    mocks.trpc.current = { data: undefined, isLoading: false, isError: true, refetch: vi.fn(), dataUpdatedAt: 0 };
    await renderPage();

    await waitFor(() => expect(card('storage')).toHaveAttribute('data-status', 'down'));
    expect(within(card('storage')).getByText(es.health.reasons.not_found)).toBeInTheDocument();
    expect(card('api_gateway')).toHaveAttribute('data-status', 'operational');
    expect(card('email')).toHaveAttribute('data-status', 'operational');

    // The database row comes from tRPC: unverified, with the scoped reason — never green, never missing.
    expect(card('database')).toHaveAttribute('data-status', 'not_monitored');
    expect(within(card('database')).getByText(es.health.reasons.trpc_unavailable)).toBeInTheDocument();

    expect(screen.getByTestId('health-trpc-error')).toHaveTextContent(es.health.trpcSourceError);
    // The storage outage the probes found drives the banner.
    expect(screen.getByText(es.health.someDown)).toBeInTheDocument();
    // The errors feed comes from tRPC too: unavailable, not "no errors".
    expect(screen.getByText(es.health.recentErrorsUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(es.health.noRecentErrors)).toBeNull();
  });

  it('a failed background tRPC refresh does not keep the cached database row as current', async () => {
    mocks.trpc.current = {
      data: healthyTrpcData,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    await renderPage();

    await waitFor(() => expect(card('storage')).toHaveAttribute('data-status', 'down'));
    expect(card('database')).toHaveAttribute('data-status', 'not_monitored');
    expect(within(card('database')).getByText(es.health.reasons.trpc_unavailable)).toBeInTheDocument();
    expect(screen.getByTestId('health-trpc-error')).toBeInTheDocument();
    // Cached stats are not presented as current either.
    expect(screen.queryByText(es.health.totalUsers)).toBeNull();
  });

  it('a pending tRPC query does not block the dependency results', async () => {
    mocks.trpc.current = { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), dataUpdatedAt: 0 };
    await renderPage();

    await waitFor(() => expect(card('storage')).toHaveAttribute('data-status', 'down'));
    expect(card('database')).toHaveAttribute('data-status', 'not_monitored');
    expect(within(card('database')).getByText(es.health.reasons.checking)).toBeInTheDocument();
    expect(screen.queryByTestId('health-trpc-error')).toBeNull();
  });

  it('with both sources healthy, the database row is the tRPC result and no scoped error shows', async () => {
    mocks.trpc.current = {
      data: healthyTrpcData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    };
    await renderPage();

    await waitFor(() => expect(card('storage')).toHaveAttribute('data-status', 'down'));
    expect(card('database')).toHaveAttribute('data-status', 'operational');
    expect(screen.queryByTestId('health-trpc-error')).toBeNull();
    expect(screen.getByText(es.health.totalUsers)).toBeInTheDocument();
  });
});

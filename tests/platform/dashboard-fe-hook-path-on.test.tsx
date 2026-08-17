import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * dashboard-fe-hook-path-on.test.tsx — the FLAG-ON half of the runtime hook-path pair.
 * See dashboard-fe-hook-path-off.test.tsx's header for why this is a separate file.
 *
 * What only THIS file can prove (source-text pins cannot): with the flag on, a hook actually
 * requests the expected C# URL with the session bearer token, routes the payload through its
 * mapper (string-form numerics arrive as numbers), and the search hook's `callerEnabled` gate
 * still suppresses the request — the panel's concrete post-cutover failure scenario was an
 * empty-query search firing on every navbar render if `&& callerEnabled` were dropped from the
 * C# branch, a mutation every other test in the suite survives.
 */

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP = 'true';

const trpcSentinel = { __branch: 'trpc' };
const trpcUseQuery = vi.fn(() => trpcSentinel);
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    platform: new Proxy(
      {},
      {
        get: () => ({ useQuery: trpcUseQuery }),
      },
    ),
  },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));

// String-form numerics on purpose: data arriving as numbers on the other side proves the hook
// routed the payload through mapDashboardKpis at RUNTIME, not merely that the mapper is exported.
const kpisPayload = {
  totalOrgs: '12',
  totalOrgsChange: '2',
  totalUsers: '300',
  totalUsersChange: '25',
  mrr: '4990',
  mrrPrevMonth: '4491',
  activeTrials: '3',
  trialsExpiringThisWeek: '1',
  overdueInvoices: '2',
  outstandingAmount: '1200.5',
  currency: 'USD',
  outstandingConverted: true,
  outstandingRatesAsOf: null,
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
  async () =>
    new Response(JSON.stringify(kpisPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }),
);
vi.stubGlobal('fetch', fetchMock);

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  trpcUseQuery.mockClear();
  fetchMock.mockClear();
});

describe('flag ON — the C# branch is the live one', () => {
  it('useDashboardKpis requests the C# route with the bearer token and returns MAPPED data', async () => {
    const { useDashboardKpis } = await import('../../apps/web/lib/platform-api/dashboard');
    const { result } = renderHook(() => useDashboardKpis(), { wrapper: makeWrapper() });

    // The tRPC branch is the disabled one now.
    expect(trpcUseQuery).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(result.current).not.toBe(trpcSentinel);

    await waitFor(() => expect((result.current as { data?: unknown }).data).toBeDefined());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://csharp.test/platform/dashboard/kpis');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');

    const data = (result.current as { data: Record<string, unknown> }).data;
    // Coerced by the mapper: the wire sent '12' (string), the consumer must see 12 (number).
    expect(data.totalOrgs).toBe(12);
    expect(data.outstandingAmount).toBe(1200.5);
    expect(data.outstandingRatesAsOf).toBeNull();
  });

  it("useDashboardSearch with the caller's gate CLOSED fires nothing, even with the flag on", async () => {
    const { useDashboardSearch } = await import('../../apps/web/lib/platform-api/dashboard');
    renderHook(() => useDashboardSearch({ query: '' }, { enabled: false }), { wrapper: makeWrapper() });

    // The panel's scenario: drop `&& callerEnabled` from the C# branch and the navbar fires an
    // empty-query search on every render of every admin page. This is the runtime kill for it.
    //
    // The flush is LOAD-BEARING: a fired queryFn awaits getAccessToken() before fetch, so a
    // synchronous not-called assertion passes even against the mutation — proven by running that
    // exact mutation and watching only the text pin go red. The gate-OPEN test below is this
    // file's positive control that fetch observation works at all.
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(trpcUseQuery).toHaveBeenLastCalledWith({ query: '' }, { enabled: false });
  });

  it("useDashboardSearch with the caller's gate OPEN requests the search route with the term", async () => {
    const { useDashboardSearch } = await import('../../apps/web/lib/platform-api/dashboard');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ organizations: [], users: [], pages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useDashboardSearch({ query: 'ana' }, { enabled: true }), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect((result.current as { data?: unknown }).data).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://csharp.test/platform/dashboard/search?query=ana');
  });
});

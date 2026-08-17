import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * dashboard-fe-hook-path-off.test.tsx — the FLAG-OFF half of the runtime hook-path pair.
 *
 * The tier-3 panel found that no test EXECUTED any wrapper hook: the coercion test imports
 * mappers, the wiring test is a source-text scan, and every queryFn/`enabled` composition was
 * covered by neither test nor compiler. This pair closes that at runtime for a representative
 * hook plus the one input-bearing hook.
 *
 * TWO FILES, not one with vi.resetModules(): the flag is a module-level const, so switching it
 * requires re-evaluating the wrapper module — but resetModules would also hand the wrapper a
 * FRESH react/@tanstack/react-query instance while @testing-library keeps the old one, and two
 * React instances break hooks outright. Instead each file sets the env BEFORE its dynamic
 * import of the wrapper and vitest's per-file isolation keeps the two states apart.
 */

// Env must be decided before the wrapper module is first evaluated (both consts are read at
// module scope). Base URL SET but flag UNSET: the base URL alone must not route to C#.
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.invalid';
delete process.env.NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP;

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

const fetchMock = vi.fn();
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

describe('flag OFF — every hook must return the tRPC branch and fire zero platform-api requests', () => {
  it('useDashboardKpis returns the tRPC query object and enables it', async () => {
    const { useDashboardKpis } = await import('../../apps/web/lib/platform-api/dashboard');
    const { result } = renderHook(() => useDashboardKpis(), { wrapper: makeWrapper() });

    // The returned object IS the tRPC branch — not a react-query result wrapping it.
    expect(result.current).toBe(trpcSentinel);
    // And the tRPC branch is the ENABLED one (the complement of the C# branch).
    expect(trpcUseQuery).toHaveBeenCalledWith(undefined, { enabled: true });
    // The C# branch must not have fired a single request: `enabled: false` on the useQuery AND
    // the platformGetRaw disabled-throw both sit between us and the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("useDashboardSearch forwards the caller's enabled gate to the tRPC branch", async () => {
    const { useDashboardSearch } = await import('../../apps/web/lib/platform-api/dashboard');

    renderHook(() => useDashboardSearch({ query: 'ana' }, { enabled: false }), { wrapper: makeWrapper() });
    expect(trpcUseQuery).toHaveBeenLastCalledWith({ query: 'ana' }, { enabled: false });

    renderHook(() => useDashboardSearch({ query: 'ana' }, { enabled: true }), { wrapper: makeWrapper() });
    expect(trpcUseQuery).toHaveBeenLastCalledWith({ query: 'ana' }, { enabled: true });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
delete process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP;

type LegacyResult = {
  data:
    | { users: Array<{ id: string; firstName: string; lastName: string; email: string; avatar: string | null }> }
    | undefined;
  isLoading: boolean;
  isError: boolean;
  error: { data: { code: string } } | null;
  refetch: () => void;
};
const legacyState = vi.hoisted(() => ({ value: null as unknown }));
const legacyUseQuery = vi.hoisted(() => vi.fn((_input: unknown, _opts: { enabled?: boolean }) => legacyState.value));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { user: { list: { useQuery: legacyUseQuery } } } }));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function legacy(result: Partial<LegacyResult>): LegacyResult {
  return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...result };
}

beforeEach(() => {
  legacyUseQuery.mockClear();
  fetchMock.mockReset();
  legacyState.value = legacy({
    data: { users: [{ id: 'u1', firstName: 'Ada', lastName: 'Admin', email: 'ada@acme.test', avatar: null }] },
  });
});

describe('assignable people — legacy tRPC fallback (flag off)', () => {
  it('keeps using tRPC user.list and never calls the C# service', async () => {
    const { useAssignablePeople } = await import('../../apps/web/lib/platform-api/assignable-people');
    const { result } = renderHook(() => useAssignablePeople({ purpose: 'offer_approver', search: 'ada' }), { wrapper });
    expect(result.current.people.map((p) => p.firstName)).toEqual(['Ada']);
    expect(legacyUseQuery).toHaveBeenCalledWith(
      { limit: 50, search: 'ada', isActive: true },
      expect.objectContaining({ enabled: true, retry: false }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a tRPC FORBIDDEN (recruiter without user:read) as the forbidden state', async () => {
    legacyState.value = legacy({ isError: true, error: { data: { code: 'FORBIDDEN' } } });
    const { useAssignablePeople } = await import('../../apps/web/lib/platform-api/assignable-people');
    const { result } = renderHook(() => useAssignablePeople({ purpose: 'interview_evaluator' }), { wrapper });
    expect(result.current.failure).toBe('forbidden');
  });

  it('offer approval select shows a translated permission error, not a raw message', async () => {
    legacyState.value = legacy({ isError: true, error: { data: { code: 'FORBIDDEN' } } });
    vi.doMock('../../apps/web/lib/trpc', () => ({
      trpc: {
        user: { list: { useQuery: legacyUseQuery }, me: { useQuery: () => ({ data: undefined }) } },
        offer: {
          submitForApproval: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
          approve: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
          reject: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
        },
      },
    }));
    vi.resetModules();
    const { OfferApprovalActions } =
      await import('../../apps/web/app/(admin)/recruitment/offers/_components/offer-approval-actions');
    render(<OfferApprovalActions offerId="o1" status="draft" approvals={[]} onUpdated={() => {}} />, { wrapper });
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso para ver las personas disponibles');
    vi.doUnmock('../../apps/web/lib/trpc');
  });
});

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;

const listCompanies = vi.hoisted(() =>
  vi.fn(() => ({
    data: [{ id: 'c1', name: 'Acme', businessUnits: [] }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
);
const idle = () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ organization: { listUnitMembers: { invalidate: vi.fn() } } }),
    organization: {
      listCompanies: { useQuery: listCompanies },
      listBusinessUnits: { useQuery: idle },
      listUnitMembers: { useQuery: idle },
      unassignUserFromUnit: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
  },
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('business units settings — flag off', () => {
  it("keeps today's tRPC viewer, says management needs the feature, and never calls C#", async () => {
    const { default: Page } = await import('../../apps/web/app/(admin)/settings/business-units/page');
    render(<Page />, { wrapper });
    expect(screen.getByText(/aún no está habilitada/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva unidad' })).not.toBeInTheDocument();
    expect(listCompanies).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('org-structure writes refuse to run instead of silently falling back to tRPC', async () => {
    const { useOrgStructureMutation, useOrgStructure } = await import('../../apps/web/lib/platform-api/org-structure');
    const { result } = renderHook(() => ({ read: useOrgStructure(), write: useOrgStructureMutation('createTeam') }), {
      wrapper,
    });
    await act(async () => {
      await expect(result.current.write.mutateAsync({ businessUnitId: 'b', name: 'x' })).rejects.toThrow(/not enabled/);
    });
    expect(result.current.read.fetchStatus).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

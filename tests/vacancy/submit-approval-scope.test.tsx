import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP = 'true';

const VACANCY = '77777777-7777-4777-8777-777777777777';
const SERVER_400 = 'Uno o mas aprobadores no tienen esta vacante dentro de su alcance';
const submitMutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  error: null as unknown,
}));
const idleMutation = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null });
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ vacancy: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    user: {
      list: { useQuery: () => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() }) },
    },
    vacancy: {
      submitForApproval: { useMutation: () => submitMutation },
      approve: { useMutation: idleMutation },
      reject: { useMutation: idleMutation },
    },
  },
}));
vi.mock('../../apps/web/lib/permissions', () => ({ usePermissions: () => ({ can: () => true, userId: 'me' }) }));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ people: [] }), { status: 200 }));
  submitMutation.error = null;
  submitMutation.reset.mockClear();
});

async function openSubmitModal() {
  const { ApprovalChain } = await import('../../apps/web/app/(admin)/recruitment/vacancies/[id]/approval-chain');
  render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="draft" approvals={[]} />, { wrapper });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprobación' }));
}

describe('vacancy submit-for-approval — scoped approvers + visible errors', () => {
  it('asks the directory only for approvers in scope of THIS vacancy', async () => {
    await openSubmitModal();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/api/platform/tenant/people/assignable?');
    expect(url).toContain('purpose=vacancy_approver');
    expect(url).toContain(`vacancyId=${VACANCY}`);
    expect(submitMutation.reset).toHaveBeenCalled();
  });

  it('explains what to do when nobody can approve the vacancy', async () => {
    await openSubmitModal();
    expect(await screen.findByText(/Nadie tiene esta vacante dentro de su alcance/)).toBeInTheDocument();
  });

  it('shows the server 400 inside the modal instead of failing silently', async () => {
    submitMutation.error = { message: SERVER_400 };
    await openSubmitModal();
    expect(screen.getByRole('alert')).toHaveTextContent(SERVER_400);
  });
});

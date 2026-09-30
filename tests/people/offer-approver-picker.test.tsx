import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Codex PR #304 [P2]: the offer approver select read ONE capped page (50) of the directory with no
// search, so an approver beyond that page was unreachable. The picker must search server-side.
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP = 'true';

const submitMutateAsync = vi.hoisted(() => vi.fn());
const idleQuery = vi.hoisted(() => () => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
}));
const mutation = vi.hoisted(() => (mutateAsync: () => Promise<unknown>) => ({ mutateAsync, isPending: false }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    user: { list: { useQuery: idleQuery }, me: { useQuery: idleQuery } },
    offer: {
      submitForApproval: { useMutation: () => mutation(submitMutateAsync) },
      approve: { useMutation: () => mutation(vi.fn()) },
      reject: { useMutation: () => mutation(vi.fn()) },
    },
  },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const OFFER_ID = '99999999-9999-4999-8999-999999999999';
const ZOE = {
  id: '77777777-7777-4777-8777-777777777777',
  firstName: 'Zoe',
  lastName: 'Zamora',
  email: 'zoe@acme.test',
  avatarUrl: null,
};

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  fetchMock.mockReset();
  submitMutateAsync.mockReset().mockResolvedValue({});
  fetchMock.mockImplementation(async (input) => {
    const people = String(input).includes('search=zoe') ? [ZOE] : [];
    return new Response(JSON.stringify({ people }), { status: 200 });
  });
});

describe('offer approval actions — approver picker', () => {
  it('searches the directory server-side so an approver outside the first page is reachable and submittable', async () => {
    const { OfferApprovalActions } =
      await import('../../apps/web/app/(admin)/recruitment/offers/_components/offer-approval-actions');
    const onUpdated = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OfferApprovalActions offerId={OFFER_ID} status="draft" approvals={[]} onUpdated={onUpdated} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zoe' } });

    await waitFor(() =>
      expect(requestedUrls()).toContain(
        '/api/platform/tenant/people/assignable?purpose=offer_approver&search=zoe&limit=25',
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Zoe Zamora/ }));

    // No I18nProvider: the default context language applies (es or en), so accept either label.
    fireEvent.click(screen.getByRole('button', { name: /^(Solicitar aprobación|Request approval)$/ }));
    await waitFor(() => expect(submitMutateAsync).toHaveBeenCalledWith({ id: OFFER_ID, approverIds: [ZOE.id] }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it('shows the server scope rejection when the picked approver cannot act on this offer', async () => {
    // Codex #304 round 2: the directory is permission-based, not scope-aware, so an unrelated-team leader
    // can be listed; submitForApproval rejects them and the panel must say why instead of failing silently.
    const scopeError = 'Uno o mas aprobadores no tienen esta oferta dentro de su alcance';
    // Real tRPC shape (approvals.ts throws BAD_REQUEST): describeOfferActionError (#306) shows a plain-text
    // BAD_REQUEST verbatim, but maps a code-less error to the generic label — so the code must be present.
    submitMutateAsync.mockRejectedValue(Object.assign(new Error(scopeError), { data: { code: 'BAD_REQUEST' } }));
    const { OfferApprovalActions } =
      await import('../../apps/web/app/(admin)/recruitment/offers/_components/offer-approval-actions');
    const onUpdated = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OfferApprovalActions offerId={OFFER_ID} status="draft" approvals={[]} onUpdated={onUpdated} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zoe' } });
    fireEvent.click(await screen.findByRole('button', { name: /Zoe Zamora/ }));
    fireEvent.click(screen.getByRole('button', { name: /^(Solicitar aprobación|Request approval)$/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(scopeError);
    expect(onUpdated).not.toHaveBeenCalled();
  });
});

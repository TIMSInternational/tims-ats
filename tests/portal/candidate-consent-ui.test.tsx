import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

// #312/#313 UI over the C# consent surface: the staff card (status, evidence, record a withdrawal) and the
// candidate's "Revocar autorización". The flag is read at module load, so it is set before any import.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
  process.env.NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP = 'true';
});

vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/toast', () => ({ toast: toastMock }));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

import { CandidateConsentCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/consent-card';
import { DashboardPrivacy } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-privacy';

const CANDIDATE = '11111111-1111-4111-8111-111111111111';
const APP = '22222222-2222-4222-8222-222222222222';
const m = es.candidateConsent;
const p = es.portalConsentWithdrawal;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const grantedView = {
  candidateId: CANDIDATE,
  consent: {
    status: 'granted',
    textVersion: 'portal-apply-2026-09-29',
    agreedAt: '2026-09-30T10:00:00.000Z',
    withdrawnAt: null,
    withdrawalChannel: null,
    withdrawalReason: null,
    withdrawnBy: null,
  },
  evidence: [
    {
      applicationId: APP,
      textVersion: 'portal-apply-2026-09-29',
      textSha256: 'a'.repeat(64),
      locale: 'es',
      agreedAt: '2026-09-30T10:00:00.000Z',
      captchaVerified: true,
      hasRequestMetadata: true,
      isBackfilled: false,
    },
  ],
  deletionRequest: null,
};

const withdrawnView = {
  ...grantedView,
  consent: {
    ...grantedView.consent,
    status: 'withdrawn',
    withdrawnAt: '2026-10-01T10:00:00.000Z',
    withdrawalChannel: 'email',
    withdrawalReason: 'Pidió no ser contactado',
    withdrawnBy: 'staff',
  },
  deletionRequest: {
    id: '33333333-3333-4333-8333-333333333333',
    status: 'pending',
    source: 'staff',
    createdAt: '2026-10-01T10:00:00.000Z',
  },
};

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CandidateConsentCard candidateId={CANDIDATE} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  toastMock.mockReset();
});

describe('staff consent card', () => {
  it('shows the status and the per-application evidence from the C# read', async () => {
    fetchMock.mockResolvedValueOnce(json(grantedView));
    renderCard();

    expect(await screen.findByText(m.statusGranted)).toBeInTheDocument();
    expect(screen.getByText(m.evidenceTitle)).toBeInTheDocument();
    expect(screen.getByText(`${m.evidenceMetadata} · ${m.evidenceCaptcha}`)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/platform/tenant/candidates/${CANDIDATE}/consent`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  });

  it('records a withdrawal with channel, reason and deletion request, then shows the new status', async () => {
    fetchMock.mockResolvedValueOnce(json(grantedView)).mockResolvedValueOnce(json(withdrawnView));
    renderCard();

    fireEvent.click(await screen.findByText(m.recordWithdrawal));
    // Channel is required: nothing is sent without it.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: m.submit }));
    expect(await screen.findByText(m.channelRequired)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(m.channelLabel), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: '  Pidió no ser contactado ' } });
    fireEvent.click(screen.getByLabelText(m.requestDeletionLabel));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: m.submit }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe(`/api/platform/tenant/candidates/${CANDIDATE}/consent/withdrawal`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      channel: 'email',
      reason: 'Pidió no ser contactado',
      requestDeletion: true,
    });
    expect(await screen.findByText(m.statusWithdrawn)).toBeInTheDocument();
    expect(screen.getByText(`${m.reasonLabel}: Pidió no ser contactado`)).toBeInTheDocument();
    expect(screen.queryByText(m.recordWithdrawal)).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(m.success, { type: 'success' });
  });

  it('renders nothing for a caller without org-wide candidate access (403)', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 403));
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows an error state with retry for any other failure', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    renderCard();
    expect(await screen.findByText(m.loadError)).toBeInTheDocument();
  });
});

describe('candidate self-service withdrawal', () => {
  it('asks for confirmation, posts only the organization slug and shows the confirmation', async () => {
    fetchMock.mockResolvedValueOnce(json({ received: true }, 202));
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme S.A.S." />);

    expect(screen.getByText(p.desc.replace('{org}', 'Acme S.A.S.'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: p.revokeButton }));
    expect(screen.getByText(p.confirmBody.replace('{org}', 'Acme S.A.S.'))).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: p.confirmButton }));
    expect(await screen.findByText(p.doneTitle)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/platform/portal/consent/withdrawal');
    // The identity is the verified session — never an email or a candidate id in the body.
    expect(JSON.parse(String(init?.body))).toEqual({ organizationSlug: 'acme' });
  });

  it('explains an unverified email instead of a generic failure', async () => {
    fetchMock.mockResolvedValueOnce(json({ code: 'email_not_verified' }, 403));
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: p.revokeButton }));
    fireEvent.click(screen.getByRole('button', { name: p.confirmButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(p.errorNotVerified);
    expect(screen.queryByText(p.doneTitle)).not.toBeInTheDocument();
  });
});

describe('flag combinations and persisted state', () => {
  it('web flag ON but C# route unmapped (404 without a handler body): the card renders nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('web flag ON but C# route unmapped: self-service says to contact the organization, not "try again"', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme" />);
    fireEvent.click(screen.getByRole('button', { name: p.revokeButton }));
    fireEvent.click(screen.getByRole('button', { name: p.confirmButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(p.errorUnavailable);
  });

  it('shows the server-persisted withdrawal instead of the revoke button', () => {
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme" withdrawnAt="2026-10-01T10:00:00.000Z" />);
    expect(screen.getByText(p.doneTitle)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: p.revokeButton })).not.toBeInTheDocument();
  });

  it('a withdrawn consent states how re-opening is handled', async () => {
    fetchMock.mockResolvedValueOnce(json(withdrawnView));
    renderCard();
    expect(await screen.findByText(m.reopenHint)).toBeInTheDocument();
  });
});

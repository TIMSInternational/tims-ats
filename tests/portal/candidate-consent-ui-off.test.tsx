import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

// Dark by default: without NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP neither consent surface calls C#. The staff card
// renders nothing; the candidate's privacy panel still renders (audit C-33) — without the revoke button, but with
// how to ask the organization for a copy, a correction or the deletion of their data.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
  delete process.env.NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP;
});

vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth: { getSession: vi.fn() } }) }));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

import { CandidateConsentCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/consent-card';
import { DashboardPrivacy } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-privacy';

const pd = es.portalDashboard;
const m = es.portalConsentWithdrawal;

describe('candidate consent UI with the flag off', () => {
  it('the staff card renders nothing and nothing calls C#', () => {
    const card = render(
      <QueryClientProvider client={new QueryClient()}>
        <CandidateConsentCard candidateId="11111111-1111-4111-8111-111111111111" />
      </QueryClientProvider>,
    );
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme" />);
    expect(card.container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the candidate privacy panel stays visible, names the organization contact and links the notice', () => {
    render(<DashboardPrivacy orgSlug="acme" orgName="Acme" contactEmail="seleccion@acme.test" />);
    expect(screen.getByRole('heading', { name: pd.privacyTitle })).toBeTruthy();
    const mail = screen.getByRole('link', { name: 'seleccion@acme.test' });
    expect(mail.getAttribute('href')).toBe('mailto:seleccion@acme.test');
    expect(mail.parentElement?.textContent).toBe(pd.privacyRequests.replace('{email}', 'seleccion@acme.test'));
    expect(screen.getByRole('link', { name: pd.privacyNoticeLink }).getAttribute('href')).toBe('/careers/acme/privacy');
    // No self-service revocation while the C# surface is dark.
    expect(screen.queryByRole('button', { name: m.revokeButton })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without a configured contact it points to the organization, never to another mailbox', () => {
    const { container } = render(<DashboardPrivacy orgSlug="acme" orgName="Acme" />);
    expect(container.textContent).toContain(pd.privacyRequestsNoContact.replace('{org}', 'Acme'));
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toMatch(/timsinternational|timssuite/i);
  });
});

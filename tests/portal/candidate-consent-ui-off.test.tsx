import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Dark by default: without NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP neither consent surface renders or calls C#.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
  delete process.env.NEXT_PUBLIC_CANDIDATE_CONSENT_VIA_CSHARP;
});

vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth: { getSession: vi.fn() } }) }));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

import { CandidateConsentCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/consent-card';
import { DashboardPrivacy } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-privacy';

describe('candidate consent UI with the flag off', () => {
  it('renders nothing and calls nothing', () => {
    const card = render(
      <QueryClientProvider client={new QueryClient()}>
        <CandidateConsentCard candidateId="11111111-1111-4111-8111-111111111111" />
      </QueryClientProvider>,
    );
    const privacy = render(<DashboardPrivacy orgSlug="acme" orgName="Acme" />);
    expect(card.container).toBeEmptyDOMElement();
    expect(privacy.container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

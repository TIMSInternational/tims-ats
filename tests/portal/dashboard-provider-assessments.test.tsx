import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// D16 candidate portal: the provider assessments section over the C# portal routes (fetch stubbed at the relay).
// The flags are read at module load, so they are set before any import.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
  process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP = 'true';
  process.env.NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN = 'https://player.test';
});

vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const openTopLevel = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/assessment-player-launch', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/assessment-player-launch')>()),
  openTopLevel,
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);
const VACANCY = '44444444-4444-4444-8444-444444444444';
// "My applications" (tRPC): the consent notice names each assessment's vacancy from it.
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidatePortal: {
      myApplications: {
        useQuery: () => ({
          data: [{ vacancy: { id: '44444444-4444-4444-8444-444444444444', title: 'Data Analyst' } }],
        }),
      },
    },
  },
}));

import { DashboardProviderAssessments } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-provider-assessments';

const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const m = en.portalDashboard;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const attempt = (status: string, extra: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT,
  instrument: 'lia',
  status,
  missingConsents: [],
  expiresAt: '2026-11-20T15:00:00Z',
  delivery: 'native',
  vacancyId: VACANCY,
  ...extra,
});

const template = {
  purpose: 'assessment',
  textVersion: 'assessment-v2026-11',
  locale: 'en',
  title: 'Assessment consent',
  blocks: [
    { type: 'paragraph', text: '<b>Plain</b> text only.' },
    { type: 'list', text: null, ordered: false, items: ['Who sees it'] },
  ],
  disclosures: ['purpose'],
};

function respond(routes: Record<string, (init?: RequestInit) => Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`);
    return routes[key]!(init);
  });
}

function renderSection(locale: 'EN' | 'ES' = 'EN') {
  localStorage.setItem('tims-locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <DashboardProviderAssessments orgSlug="acme" orgName="Acme Corp" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

// A sitting not started yet shows the organization's notice first (Codex atsux run 1): Start opens it, the notice is
// marked read, and only then does Start launch.
async function startReady() {
  fireEvent.click(await screen.findByRole('button', { name: m.providerStart }));
  const notice = await screen.findByTestId('assessment-consent-notice');
  expect(notice).toHaveTextContent('Data Analyst');
  const start = screen.getByRole('button', { name: m.providerStart });
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByLabelText(en.assessmentConsentNotice.readAck));
  fireEvent.click(start);
}

describe('DashboardProviderAssessments', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    openTopLevel.mockReset();
    localStorage.clear();
  });

  it.each([
    ['ready', m.providerStatusReady, m.providerHintReady, m.providerStart],
    ['in_progress', m.providerStatusInProgress, m.providerHintInProgress, m.providerContinue],
    ['consent_needed', m.providerStatusConsentNeeded, m.providerHintConsentNeeded, m.providerReviewConsent],
    ['completed', m.providerStatusCompleted, m.providerHintCompleted, null],
    ['expired', m.providerStatusExpired, m.providerHintExpired, null],
    ['needs_review', m.providerStatusNeedsReview, m.providerHintNeedsReview, null],
  ])(
    'shows the %s state with its label, its hint and only the action it allows',
    async (status, label, hint, action) => {
      respond({ '/portal/assessment-attempts?organizationSlug=acme': () => json({ attempts: [attempt(status)] }) });
      renderSection();

      const item = (await screen.findByText(label)).closest('li')!;
      expect(within(item).getByText(m.providerInstrumentLia)).toBeInTheDocument();
      expect(within(item).getByText(hint)).toBeInTheDocument();
      const buttons = within(item)
        .queryAllByRole('button')
        .map((b) => b.textContent);
      expect(buttons).toEqual(action ? [action] : []);
    },
  );

  it('is in Spanish by default', async () => {
    respond({ '/portal/assessment-attempts': () => json({ attempts: [attempt('needs_review')] }) });
    renderSection('ES');
    expect(await screen.findByText(es.portalDashboard.providerStatusNeedsReview)).toBeInTheDocument();
    expect(screen.getByText(es.portalDashboard.providerAssessments)).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    respond({ '/portal/assessment-attempts': () => json({ attempts: [] }) });
    renderSection();
    expect(await screen.findByText(m.providerEmpty)).toBeInTheDocument();
  });

  // Codex release round A3 [P2]: an embedded launch asks for no return URL, so when the launch turns out not to be
  // framable, the portal launches again top-level (revoking the unused first code) to keep the return to the dashboard.
  it('links out with a fresh top-level launch when this site is not a registered frame ancestor', async () => {
    const launchBodies: unknown[] = [];
    respond({
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: `https://player.test/launch/code-${launchBodies.length}`,
          frameAncestors: ['https://someone-else.test'],
        });
      },
      '/portal/assessment-attempts': () => json({ attempts: [attempt('ready')] }),
    });
    renderSection();

    await startReady();

    await waitFor(() => expect(openTopLevel).toHaveBeenCalledWith('https://player.test/launch/code-2'));
    expect(openTopLevel).toHaveBeenCalledTimes(1);
    expect(launchBodies).toEqual([{ embedded: true }, { embedded: false }]);
    expect(screen.queryByTitle(m.providerFrameTitle)).not.toBeInTheDocument();
  });

  it('never asks a link-out instrument for an embedded launch', async () => {
    const launchBodies: unknown[] = [];
    respond({
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'link_out',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://pca.test/sit/1',
          frameAncestors: [],
        });
      },
      '/portal/assessment-attempts': () =>
        json({ attempts: [attempt('ready', { instrument: 'pca', delivery: 'link_out' })] }),
    });
    renderSection();

    await startReady();

    await waitFor(() => expect(openTopLevel).toHaveBeenCalledWith('https://pca.test/sit/1'));
    expect(launchBodies).toEqual([{ embedded: false }]);
  });

  it('frames the hosted player when this site is a registered ancestor, and refreshes on close', async () => {
    let lists = 0;
    respond({
      '/launch': () =>
        json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/launch/code-2',
          frameAncestors: [window.location.origin],
        }),
      '/portal/assessment-attempts': () => {
        lists++;
        return json({ attempts: [attempt('in_progress')] });
      },
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: m.providerContinue }));

    const frame = await screen.findByTitle(m.providerFrameTitle);
    expect(frame.getAttribute('src')).toBe('https://player.test/launch/code-2');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(openTopLevel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: m.providerFrameClose }));
    await waitFor(() => expect(screen.queryByTitle(m.providerFrameTitle)).not.toBeInTheDocument());
    await waitFor(() => expect(lists).toBe(2));
  });

  it('shows each consent text as plain text and launches only once every one is accepted, with its text version', async () => {
    const launchBodies: unknown[] = [];
    respond({
      '/consent-templates?locale=en': () => json({ templates: [template] }),
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/l/3',
          frameAncestors: [],
        });
      },
      '/portal/assessment-attempts': () =>
        json({ attempts: [attempt('consent_needed', { missingConsents: ['assessment'] })] }),
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: m.providerReviewConsent }));
    expect(await screen.findByText('<b>Plain</b> text only.')).toBeInTheDocument(); // never parsed as HTML
    expect(screen.getByText('Who sees it')).toBeInTheDocument();
    // Design §6.3: the organization's own notice comes first: TIMS Assessments named, the purpose "selection for
    // vacancy X", marked as a draft pending counsel (D22).
    const notice = screen.getByTestId('assessment-consent-notice');
    expect(notice).toHaveTextContent('TIMS Assessments');
    expect(notice).toHaveTextContent('Acme Corp');
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.purpose.replace('{vacancy}', 'Data Analyst'));
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.draftBanner);
    const accept = screen.getByRole('button', { name: m.providerAcceptAndStart });
    expect(accept).toBeDisabled();

    fireEvent.click(screen.getByLabelText(m.providerConsentAccept));
    expect(accept).toBeDisabled(); // the notice is not read yet
    fireEvent.click(screen.getByLabelText(en.assessmentConsentNotice.readAck));
    expect(accept).toBeEnabled();
    fireEvent.click(accept);

    await waitFor(() => expect(openTopLevel).toHaveBeenCalledWith('https://player.test/l/3'));
    // The consents travel with the first launch only; the top-level relaunch (not framable here) records none again.
    expect(launchBodies).toEqual([
      { consents: [{ purpose: 'assessment', textVersion: 'assessment-v2026-11', locale: 'en' }], embedded: true },
      { embedded: false },
    ]);
  });

  it.each([
    [409, { error: 'consent_withdrawn', code: 'consent_withdrawn' }, m.providerLaunchWithdrawn],
    [410, { error: 'attempt_expired', code: 'attempt_expired' }, m.providerLaunchExpired],
    [
      409,
      { error: 'consent_required', code: 'consent_required', missingConsents: ['voice'] },
      m.providerLaunchConsentRequired,
    ],
    [503, { error: 'provider_unavailable' }, m.providerLaunchError],
  ])('explains a failed launch (%i) and opens nothing', async (status, body, message) => {
    respond({
      '/launch': () => json(body, status),
      '/portal/assessment-attempts': () => json({ attempts: [attempt('ready')] }),
    });
    renderSection();

    await startReady();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(openTopLevel).not.toHaveBeenCalled();
  });

  it('never opens an off-contract launch URL', async () => {
    respond({
      '/launch': () =>
        json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'http://player.test/l',
          frameAncestors: [],
        }),
      '/portal/assessment-attempts': () => json({ attempts: [attempt('ready')] }),
    });
    renderSection();

    await startReady();

    expect(await screen.findByRole('alert')).toHaveTextContent(m.providerLaunchError);
    expect(openTopLevel).not.toHaveBeenCalled();
  });
});

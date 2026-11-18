import React from 'react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { portalInstrumentName } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-item';

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
  optionalConsents: [],
  locale: 'en',
  ...extra,
});

// The provider serves its approved texts, versioned '2026-11-09-<purpose>-v1' (the suite registers them; the ATS renders
// them as served and sends that exact version back).
const approved = (purpose: string) => `2026-11-09-${purpose}-v1`;
// The ATS notice acknowledgment every launch of a sitting not started carries (round 12), here in English.
const NOTICE = { textVersion: '2026-11-09-ats-notice-v1', locale: 'en' };

const template = {
  purpose: 'assessment',
  textVersion: approved('assessment'),
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

// A sitting not started yet shows the organization's notice first (Codex atsux run 1): Start opens its one-step guide,
// whose full text names the vacancy; the notice is marked read, and only then does Start launch.
async function startReady() {
  fireEvent.click(await screen.findByRole('button', { name: m.providerStart }));
  fireEvent.click(await screen.findByRole('button', { name: m.providerGuideReadFull }));
  expect(within(screen.getByRole('dialog')).getByTestId('assessment-consent-notice')).toHaveTextContent('Data Analyst');
  fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: en.common.close })[0]!);
  const start = screen.getByRole('button', { name: m.providerStart });
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByLabelText(en.assessmentConsentNotice.readAck));
  fireEvent.click(start);
}

// The consent guide: tick the step's box (when asked) and go on.
function nextStep(tick = true) {
  if (tick) fireEvent.click(within(screen.getByTestId('consent-step')).getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: m.providerGuideContinue }));
}

/** Opens the current step's full text, returns the sheet's text, and closes it. */
function readFullText(): string {
  fireEvent.click(within(screen.getByTestId('consent-step')).getByRole('button', { name: m.providerGuideReadFull }));
  const sheet = screen.getByRole('dialog');
  const text = sheet.textContent ?? '';
  fireEvent.click(within(sheet).getAllByRole('button', { name: en.common.close })[0]!);
  return text;
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
    // The notice acknowledged before the start travels with both launches (the relaunch is of a sitting not started).
    expect(launchBodies).toEqual([
      { notice: NOTICE, embedded: true },
      { notice: NOTICE, embedded: false },
    ]);
    expect(document.querySelector('iframe')).toBeNull();
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
    expect(launchBodies).toEqual([{ notice: NOTICE, embedded: false }]);
  });

  it('frames PCA on timshr.com by default, in the same frame and bar as the other tests', async () => {
    // happy-dom would load the framed page for real: this test must never reach TIMS's site.
    const browser = (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM
      .settings;
    browser.disableIframePageLoading = true;
    onTestFinished(() => {
      browser.disableIframePageLoading = false;
    });
    const launchBodies: unknown[] = [];
    respond({
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'link_out',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://timshr.com/surveys/?SCId=7',
          frameAncestors: [],
        });
      },
      '/portal/assessment-attempts': () =>
        json({ attempts: [attempt('ready', { instrument: 'pca', delivery: 'link_out' })] }),
    });
    renderSection();

    await startReady();

    const pcaName = portalInstrumentName(m, 'pca');
    const frame = await screen.findByTitle(pcaName);
    expect(frame.getAttribute('src')).toBe('https://timshr.com/surveys/?SCId=7');
    expect(frame.getAttribute('sandbox')).toBe('allow-forms allow-scripts allow-same-origin');
    expect(openTopLevel).not.toHaveBeenCalled();
    // A link-out instrument never asks for an embedded launch.
    expect(launchBodies).toEqual([{ notice: NOTICE, embedded: false }]);
    const dialog = screen.getByRole('dialog', { name: pcaName });
    expect(within(dialog).getByRole('link', { name: m.providerFrameNewTab })).toHaveAttribute(
      'href',
      'https://timshr.com/surveys/?SCId=7',
    );
    // Leaving asks first, as for every test; back on the list the result may still be on its way.
    fireEvent.click(within(dialog).getByRole('button', { name: m.providerFrameLeave }));
    fireEvent.click(screen.getByRole('button', { name: m.providerLeaveConfirm }));
    await waitFor(() => expect(screen.queryByTitle(pcaName)).not.toBeInTheDocument());
    expect(await screen.findByText(m.providerStatusAwaitingResult)).toBeInTheDocument();
  });

  it('frames the hosted player when this site is a registered ancestor, and refreshes on close', async () => {
    let lists = 0;
    const launchBodies: unknown[] = [];
    respond({
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/launch/code-2',
          frameAncestors: [window.location.origin],
        });
      },
      '/portal/assessment-attempts': () => {
        lists++;
        return json({ attempts: [attempt('in_progress')] });
      },
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: m.providerContinue }));

    const liaName = portalInstrumentName(m, 'lia');
    const frame = await screen.findByTitle(liaName);
    expect(frame.getAttribute('src')).toBe('https://player.test/launch/code-2');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    // The player needs the camera (identity checks), the microphone (English speaking) and fullscreen (lockdown).
    expect(frame.getAttribute('allow')).toBe('camera; microphone; fullscreen; autoplay');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(openTopLevel).not.toHaveBeenCalled();
    // Leaving asks first; staying keeps the test open.
    fireEvent.click(screen.getByRole('button', { name: m.providerFrameLeave }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(m.providerLeaveTitle);
    fireEvent.click(screen.getByRole('button', { name: m.providerLeaveStay }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByTitle(liaName)).toBeInTheDocument();
    // Escape asks too (it never closes a test on its own).
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: m.providerLeaveConfirm }));
    await waitFor(() => expect(screen.queryByTitle(liaName)).not.toBeInTheDocument());
    await waitFor(() => expect(lists).toBe(2));
    // A sitting in progress resumes: its notice was acknowledged when it was first launched.
    expect(launchBodies).toEqual([{ embedded: true }]);
  });

  it('refuses a list whose attempt carries no test language (strict contract)', async () => {
    const { locale: _omitted, ...withoutLocale } = attempt('ready');
    respond({ '/portal/assessment-attempts': () => json({ attempts: [withoutLocale] }) });
    renderSection();

    expect(await screen.findByText(m.providerError)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.providerStart })).not.toBeInTheDocument();
  });

  it('speaks the TEST language in the frame bar, not the portal language', async () => {
    // The portal is read in English, the test is administered in Spanish: the bar, its way out and the leave question
    // are the test's (as on timssuite.com), so the candidate never sees two languages around one test.
    respond({
      '/launch': () =>
        json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/launch/code-es',
          frameAncestors: [window.location.origin],
        }),
      '/portal/assessment-attempts': () => json({ attempts: [attempt('in_progress', { locale: 'es' })] }),
    });
    renderSection('EN');

    fireEvent.click(await screen.findByRole('button', { name: m.providerContinue }));

    const esName = portalInstrumentName(es.portalDashboard, 'lia');
    expect(esName).not.toBe(portalInstrumentName(m, 'lia'));
    expect(await screen.findByTitle(esName)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: esName })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.providerFrameLeave })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: es.portalDashboard.providerFrameLeave }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(es.portalDashboard.providerLeaveTitle);
    expect(screen.getByRole('button', { name: es.portalDashboard.providerLeaveStay })).toBeInTheDocument();
  });

  it('keeps the receipt on screen when the player says the sitting ended (trusting only the player origin), then re-reads until the result arrives', async () => {
    let lists = 0;
    respond({
      '/launch': () =>
        json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/launch/code-9',
          frameAncestors: [window.location.origin],
        }),
      '/portal/assessment-attempts': () => {
        lists++;
        // The result reaches the ATS after the end message: in progress on the first re-read, completed later.
        return json({ attempts: [attempt(lists <= 2 ? 'in_progress' : 'completed')] });
      },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: m.providerContinue }));
    const liaName = portalInstrumentName(m, 'lia');
    await screen.findByTitle(liaName);
    const ended = { source: 'tims-hosted-player', v: 1, type: 'sitting_ended', reason: 'finished' };
    // The frame appeared after an async launch: let React attach its listeners first.
    await act(async () => {});
    // Any other origin (or another message) is ignored.
    window.dispatchEvent(new MessageEvent('message', { data: ended, origin: 'https://evil.test' }));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'sitting_ended' }, origin: 'https://player.test' }),
    );
    expect(screen.getByTitle(liaName)).toBeInTheDocument();
    window.dispatchEvent(new MessageEvent('message', { data: ended, origin: 'https://player.test' }));
    // The suite's receipt stays visible; the way out becomes one clear button that does not ask.
    const done = await screen.findByRole('button', { name: m.providerFrameDone });
    expect(screen.getByTitle(liaName)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.providerFrameLeave })).not.toBeInTheDocument();
    // Re-read until the attempt has left "in progress" (the webhook lands after the end message).
    await waitFor(() => expect(lists).toBeGreaterThanOrEqual(3), { timeout: 6000 });
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByTitle(liaName)).not.toBeInTheDocument());
    expect(await screen.findByText(m.providerStatusCompleted)).toBeInTheDocument();
  });

  it('keeps a running test mounted when a background refresh of the list fails (Codex r13)', async () => {
    let lists = 0;
    respond({
      '/launch': () =>
        json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/launch/code-11',
          frameAncestors: [window.location.origin],
        }),
      '/portal/assessment-attempts': () => {
        lists++;
        // The first read works; every refresh after the launch fails.
        return lists === 1 ? json({ attempts: [attempt('in_progress')] }) : json({ code: 'unavailable' }, 503);
      },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: m.providerContinue }));
    const liaName = portalInstrumentName(m, 'lia');
    await screen.findByTitle(liaName);
    await act(async () => {});
    // The end message triggers a refresh, which fails: the frame (and its receipt) must stay, the error shows apart.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'tims-hosted-player', v: 1, type: 'sitting_ended', reason: 'finished' },
        origin: 'https://player.test',
      }),
    );
    await waitFor(() => expect(lists).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(m.providerError)).toBeInTheDocument();
    expect(screen.getByTitle(liaName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: m.providerFrameDone })).toBeInTheDocument();
  });

  it('lists the tests in the same order as everywhere else: LIA, English, Personality, PCA', async () => {
    const at = (id: string, instrument: string) => ({ ...attempt('ready', { instrument }), attemptId: id });
    respond({
      '/portal/assessment-attempts': () =>
        json({
          attempts: [
            { ...at('33333333-3333-4333-8333-333333333301', 'pca'), delivery: 'link_out' },
            at('33333333-3333-4333-8333-333333333302', 'personality'),
            at('33333333-3333-4333-8333-333333333303', 'lia'),
            at('33333333-3333-4333-8333-333333333304', 'english'),
          ],
        }),
    });
    renderSection();
    await screen.findByText(portalInstrumentName(m, 'lia'));
    const names = ['lia', 'english', 'personality', 'pca'].map((i) => portalInstrumentName(m, i));
    const text = document.body.textContent ?? '';
    const positions = names.map((n) => text.indexOf(n));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows each consent text as plain text and launches only once every one is accepted, with its text version', async () => {
    const launchBodies: unknown[] = [];
    respond({
      '/consent-templates?locale=en': () => json({ templates: [template], optionalPurposes: [] }),
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
    // Step 1, design §6.3: the ATS's own short notice comes first. Its full text names TIMS Assessments as processor for
    // the organization, the purpose "selection for vacancy X", that a person decides, how to withdraw; with its version
    // and no draft marker.
    await screen.findByTestId('consent-step');
    fireEvent.click(screen.getByRole('button', { name: m.providerGuideReadFull }));
    const notice = within(screen.getByRole('dialog')).getByTestId('assessment-consent-notice');
    expect(notice).toHaveTextContent('TIMS Assessments');
    expect(notice).toHaveTextContent('Acme Corp');
    expect(notice).toHaveTextContent(
      en.assessmentConsentNotice.purpose.replace('{vacancy}', 'Data Analyst').replaceAll('{org}', 'Acme Corp'),
    );
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.decision.replaceAll('{org}', 'Acme Corp'));
    expect(notice).toHaveTextContent('2026-11-09-ats-notice-v1');
    expect(notice).not.toHaveTextContent(/draft|counsel|D22/i);
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: en.common.close })[0]!);
    const next = screen.getByRole('button', { name: m.providerGuideContinue });
    expect(next).toBeDisabled(); // the notice is not read yet
    nextStep();

    // Step 2: the provider's text, in full in its sheet, as plain text (never parsed as HTML).
    const full = readFullText();
    expect(full).toContain('<b>Plain</b> text only.');
    expect(full).toContain('Who sees it');
    expect(screen.getByRole('button', { name: m.providerGuideContinue })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(m.providerConsentAccept));
    fireEvent.click(screen.getByRole('button', { name: m.providerGuideContinue }));

    // Step 3, "Start": the choices, then the launch.
    const accept = screen.getByRole('button', { name: m.providerAcceptAndStart });
    expect(accept).toBeEnabled();
    fireEvent.click(accept);

    await waitFor(() => expect(openTopLevel).toHaveBeenCalledWith('https://player.test/l/3'));
    // The consents travel with the first launch only; the top-level relaunch (not framable here) records none again.
    expect(launchBodies).toEqual([
      {
        consents: [{ purpose: 'assessment', textVersion: approved('assessment'), locale: 'en' }],
        notice: NOTICE,
        embedded: true,
      },
      { notice: NOTICE, embedded: false },
    ]);
  });

  // Mismatch 4: English speaking is administered only with the optional voice and ai_scoring consents. They are shown
  // apart, unticked, never required to start; what the candidate left unticked travels as declinedConsents.
  it('offers the optional English speaking consents apart and sends what was declined', async () => {
    const launchBodies: unknown[] = [];
    const optional = (purpose: string, title: string) => ({
      ...template,
      purpose,
      textVersion: approved(purpose),
      title,
      blocks: [{ type: 'paragraph', text: `${title} text.` }],
    });
    respond({
      '/consent-templates?locale=en': () =>
        json({
          templates: [optional('voice', 'Voice recording'), optional('ai_scoring', 'AI scoring')],
          optionalPurposes: ['voice', 'ai_scoring'],
        }),
      '/launch': (init) => {
        launchBodies.push(JSON.parse(String(init?.body)));
        return json({
          delivery: 'native',
          expiresAt: '2026-11-09T14:05:00Z',
          hostedUrl: 'https://player.test/l/4',
          frameAncestors: [window.location.origin],
        });
      },
      '/portal/assessment-attempts': () =>
        json({
          attempts: [attempt('consent_needed', { instrument: 'english', optionalConsents: ['voice', 'ai_scoring'] })],
        }),
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: m.providerReviewConsent }));
    await screen.findByTestId('consent-step');
    nextStep(); // the notice
    // Each optional text is its own step, marked optional, unticked, and never required to go on. The provider's own
    // approved text opens in full, as served: no draft marker of the ATS's.
    for (const title of ['Voice recording', 'AI scoring']) {
      const current = screen.getByTestId('consent-step');
      expect(current).toHaveAttribute('data-optional', 'true');
      expect(within(current).getByRole('heading', { level: 3 })).toHaveTextContent(title);
      expect(within(current).getByText(m.providerGuideOptional)).toBeInTheDocument();
      const box = within(current).getByLabelText(m.providerOptionalAccept);
      expect(box).not.toBeChecked(); // optional: never pre-ticked
      const full = readFullText();
      expect(full).toContain(`${title} text.`);
      expect(full).not.toMatch(/draft|counsel|D22/i);
      expect(screen.getByRole('button', { name: m.providerGuideContinue })).toBeEnabled();
      nextStep(title === 'AI scoring'); // ai_scoring yes, voice left unticked
    }
    const review = screen.getByTestId('consent-review');
    expect(review).toHaveTextContent(m.providerOptionalTitle);
    const accept = screen.getByRole('button', { name: m.providerAcceptAndStart });
    expect(accept).toBeEnabled(); // nothing optional is required to start
    fireEvent.click(accept);

    await screen.findByTitle(portalInstrumentName(m, 'english'));
    expect(launchBodies).toEqual([
      {
        consents: [{ purpose: 'ai_scoring', textVersion: approved('ai_scoring'), locale: 'en' }],
        declinedConsents: ['voice'],
        notice: NOTICE,
        embedded: true,
      },
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

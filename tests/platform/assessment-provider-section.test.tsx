import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// Round 12: the platform owner's TIMS Assessments tools on the organization page (bind, state, safe unbind, DSAR),
// over the C# routes (fetch stubbed at the relay). The flags are read at module load, so they are set first.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
  process.env.NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP = 'true';
});
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/lib/toast', () => ({ toast }));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

import { AssessmentProviderSection } from '../../apps/web/app/(admin)/platform/organizations/[id]/sections/assessment-provider-section';

const ORG = '11111111-1111-4111-8111-111111111111';
const CANDIDATE = '22222222-2222-4222-8222-222222222222';
const pa = en.providerAdmin;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const work = (extra: Record<string, number> = {}) => ({
  cancellable: 0,
  awaitingResult: 0,
  pendingWithdrawals: 0,
  cancelPending: 0,
  createsInFlight: 0,
  ...extra,
});
const state = (extra: Record<string, unknown> = {}) => ({
  bound: true,
  active: true,
  providerTenantId: '33333333-3333-4333-8333-333333333333',
  enabledInstruments: ['lia', 'english'],
  defaultLocale: 'es',
  updatedAt: '2026-11-09T15:00:00Z',
  openWork: work({ cancellable: 2 }),
  ...extra,
});

type Route = (init?: RequestInit) => Response;
const calls: Array<{ method: string; url: string; body: unknown }> = [];
function respond(routes: Record<string, Route>) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!key) throw new Error(`unexpected fetch ${method} ${url}`);
    return routes[key]!(init);
  });
}

function renderSection(locale: 'EN' | 'ES' = 'EN') {
  localStorage.setItem('tims-locale', locale);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <AssessmentProviderSection organizationId={ORG} organizationName="Acme Corp" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('AssessmentProviderSection', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    toast.mockReset();
    calls.length = 0;
    localStorage.clear();
  });

  it('shows the binding state and the open work an unbind would strand', async () => {
    respond({
      [`/organizations/${ORG}/binding`]: () => json(state()),
    });
    renderSection();

    const panel = await screen.findByTestId('provider-binding-state');
    expect(panel).toHaveTextContent(pa.stateActive);
    expect(panel).toHaveTextContent('LIA, English');
    expect(screen.getAllByTestId('provider-open-work')[0]).toHaveTextContent(
      pa.openWork.cancellable.replace('{n}', '2'),
    );
  });

  it('binds with the chosen tests and default language', async () => {
    respond({
      '/binding': () => json(state({ bound: false, active: false, enabledInstruments: [], openWork: work() })),
      'POST https://csharp.test/platform/assessment-providers/bindings': () =>
        json({
          organizationId: ORG,
          providerTenantId: '3'.repeat(8),
          enabledInstruments: ['lia'],
          defaultLocale: 'en',
        }),
    });
    renderSection();

    fireEvent.click(await screen.findByLabelText(pa.instrument.lia));
    fireEvent.change(screen.getByLabelText(pa.localeLabel), { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: pa.bindSubmit }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(pa.bound, { type: 'success' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      organizationId: ORG,
      instruments: ['lia'],
      defaultLocale: 'en',
    });
  });

  it('unbinds only after the acknowledgment, cancelling the open tests when chosen, and shows what blocks it', async () => {
    let unbinds = 0;
    respond({
      '/binding/unbind': () =>
        ++unbinds === 1
          ? json(
              { error: 'binding_has_open_work', openWork: work({ awaitingResult: 1 }), cancelled: 2, cancelFailed: 0 },
              409,
            )
          : json({ unbound: true, openWork: work(), cancelled: 0, cancelFailed: 0 }),
      '/binding': () => json(state()),
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: pa.unbindButton }));
    const dialog = screen.getByTestId('provider-unbind-dialog');
    const submit = within(dialog).getByRole('button', { name: pa.unbindSubmit });
    expect(submit).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText(pa.unbindCancelChoice.replace('{n}', '2')));
    fireEvent.click(within(dialog).getByLabelText(pa.unbindAcknowledge));
    fireEvent.click(submit);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      pa.unbindBlocked.replace('{cancelled}', '2').replace('{failed}', '0'),
    );
    expect(within(dialog).getByTestId('provider-open-work')).toHaveTextContent(
      pa.openWork.awaitingResult.replace('{n}', '1'),
    );
    expect(calls.filter((c) => c.url.endsWith('/unbind')).map((c) => c.body)).toEqual([{ cancelOpenAttempts: true }]);

    fireEvent.click(within(dialog).getByRole('button', { name: pa.unbindSubmit }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(pa.unbound.replace('{n}', '0'), { type: 'success' }));
    expect(screen.queryByTestId('provider-unbind-dialog')).not.toBeInTheDocument();
  });

  it('refuses a candidate id that is not a UUID and sends nothing', async () => {
    respond({ '/binding': () => json(state()) });
    renderSection();

    fireEvent.change(await screen.findByLabelText(pa.candidateLabel), { target: { value: 'not-an-id' } });
    fireEvent.click(screen.getByRole('button', { name: pa.exportButton }));

    expect(await screen.findByText(pa.candidateInvalid)).toBeInTheDocument();
    expect(calls.filter((c) => c.url.includes('/candidates/'))).toEqual([]);
  });

  it('downloads the DSAR export and erases only after the confirmation', async () => {
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    respond({
      '/export': () => json({ attempts: [], results: [], providerExports: [] }),
      '/erasure': () => json({ subjects: 2, requested: 1 }, 503),
      '/binding': () => json(state()),
    });
    renderSection();

    fireEvent.change(await screen.findByLabelText(pa.candidateLabel), { target: { value: CANDIDATE } });
    fireEvent.click(screen.getByRole('button', { name: pa.exportButton }));
    expect(await screen.findByText(pa.exported)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.endsWith(`/organizations/${ORG}/candidates/${CANDIDATE}/export`))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: pa.eraseButton }));
    expect(calls.some((c) => c.url.endsWith('/erasure'))).toBe(false); // nothing before the confirmation
    fireEvent.click(await screen.findByRole('button', { name: pa.eraseSubmit }));
    expect(
      await screen.findByText(pa.eraseIncomplete.replace('{requested}', '1').replace('{subjects}', '2')),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith('/erasure')).map((c) => c.method)).toEqual(['POST']);
  });

  it('is in Spanish', async () => {
    respond({ '/binding': () => json(state()) });
    renderSection('ES');

    expect(await screen.findByText(es.providerAdmin.dsarTitle)).toBeInTheDocument();
    expect(await screen.findByTestId('provider-binding-state')).toHaveTextContent(es.providerAdmin.stateActive);
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// AS-14 / AS-7 in apps/web: the vacancy assessments[] editor (catalog instruments, use, minimum, required reason, the
// version it was read at, the conflict path) and, on the candidate page, the provider attempts (status chips, the HR
// result view with D6 for a team leader and D3/D20 notes) and assigning a vacancy's tests with the consent step.

const mocks = vi.hoisted(() => ({
  v2: true,
  provider: true,
  canUpdateVacancy: true,
  canCreateAssessment: true,
  stored: null as unknown,
  catalog: null as unknown,
  catalogError: false,
  attempts: null as unknown,
  saveMutate: vi.fn(),
  savePending: false,
  assignMutate: vi.fn(),
  cancelMutate: vi.fn(),
  toast: vi.fn(),
  orgName: 'Acme Corp' as string | null,
  locale: 'en' as 'en' | 'es',
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  const { default: es } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t: mocks.locale === 'en' ? en : es, locale: mocks.locale === 'en' ? 'EN' : 'ES' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan: () => (module: string, action?: string) =>
    module === 'vacancy'
      ? mocks.canUpdateVacancy
      : module === 'assessment' && (action !== 'create' || mocks.canCreateAssessment),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    organization: {
      getCurrent: { useQuery: () => ({ data: mocks.orgName ? { name: mocks.orgName } : undefined }) },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/fit-engine', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/fit-engine')>()),
  isFitEngineV2Enabled: () => mocks.v2,
}));
vi.mock('../../apps/web/lib/platform-api/vacancy-assessments', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/vacancy-assessments')>()),
  useVacancyAssessments: () => ({ data: mocks.stored, isLoading: false, isError: false }),
  useSaveVacancyAssessments: () => ({ mutate: mocks.saveMutate, isPending: mocks.savePending }),
}));
vi.mock('../../apps/web/lib/platform-api/assessment-providers-staff', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-providers-staff')>()),
  isProviderAssessmentsStaffEnabled: () => mocks.provider,
  useProviderCatalog: () =>
    mocks.catalogError
      ? { data: undefined, isError: true, isLoading: false }
      : { data: mocks.catalog, isError: false, isLoading: false },
  useCandidateProviderAttempts: () => ({ data: mocks.attempts, isLoading: false, isError: false }),
  useCancelProviderAttempt: () => ({ mutate: mocks.cancelMutate, isPending: false, variables: undefined }),
  useAssignProviderAssessments: () => ({ mutate: mocks.assignMutate, isPending: false }),
}));

import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { VacancyAssessmentsConflict } from '../../apps/web/lib/platform-api/vacancy-assessments';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';
import { assignErrorCode } from '../../apps/web/lib/platform-api/assessment-providers-staff';
import { VacancyAssessmentsCard } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/vacancy-assessments-card';
import { ProviderAssessmentsCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/provider-assessments-card';

const VERSION = '0123456789abcdef0123456789abcdef';
const VACANCY = '11111111-1111-4111-8111-111111111111';
const va = en.vacancyAssessments;
const pa = en.providerAssessments;
const ap = en.assignProviderAssessments;

const catalogEntry = (instrument: string, pinnedVersion: string | null = null) => ({
  instrument,
  delivery: 'native',
  locales: ['es', 'en'],
  requiredConsents: ['assessment'],
  versions: [{ instrumentVersion: '1.1', status: 'ga' }],
  pinnedVersion,
});

const lia = {
  instrument: 'lia',
  use: 'scored',
  min: { globalPercentile: 40, cefr: null, level: null, score: null },
  weight: null,
  reason: 'Análisis de datos',
};

beforeEach(() => {
  Object.assign(mocks, {
    v2: true,
    provider: true,
    canUpdateVacancy: true,
    canCreateAssessment: true,
    stored: { assessments: [lia], version: VERSION, issues: [] },
    catalog: {
      connected: true,
      instruments: [catalogEntry('lia', '1.0'), catalogEntry('english'), catalogEntry('personality')],
    },
    catalogError: false,
    attempts: { consentWithdrawn: false, attempts: [] },
    savePending: false,
    orgName: 'Acme Corp',
    locale: 'en',
  });
  vi.clearAllMocks();
});

// ── the vacancy assessments editor ──────────────────────────────────────────────────────────

describe('VacancyAssessmentsCard', () => {
  it('is hidden without FIT v2', () => {
    mocks.v2 = false;
    const { container } = render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each configured test with its pinned version and the LIA threshold note (D20)', () => {
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    const row = screen.getByText(en.candidates.fitInstrumentNames.lia).closest('li')!;
    expect(within(row).getByText(va.versionPinned.replace('{version}', '1.0'))).toBeInTheDocument();
    expect(within(row).getByText(va.noteLia)).toBeInTheDocument();
    expect(within(row).getByLabelText(va.reasonLabel)).toHaveValue('Análisis de datos');
    expect(within(row).getByLabelText(new RegExp(va.minimumGlobalPercentile.replace(/[()]/g, '.')))).toHaveValue(40);
  });

  it('adds a catalog test, needs its minimum and reason, and saves the whole array at the version read', async () => {
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    // Only catalog tests not listed yet are offered.
    const picker = screen.getByLabelText(va.addLabel);
    expect(
      within(picker).queryByRole('option', { name: en.candidates.fitInstrumentNames.lia }),
    ).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'english' } });
    fireEvent.click(screen.getByRole('button', { name: va.addButton }));

    const english = screen.getByText(en.candidates.fitInstrumentNames.english).closest('li')!;
    expect(within(english).getByText(va.noteEnglish)).toBeInTheDocument(); // D3
    fireEvent.click(screen.getByRole('button', { name: va.save }));
    expect(await within(english).findByText(va.errorReasonRequired)).toBeInTheDocument();
    expect(within(english).getByText(va.errorMinimumInvalid)).toBeInTheDocument();
    expect(mocks.saveMutate).not.toHaveBeenCalled();

    fireEvent.change(within(english).getByLabelText(va.minimumCefr), { target: { value: 'B2' } });
    fireEvent.change(within(english).getByLabelText(va.reasonLabel), {
      target: { value: '  Atención a clientes en inglés ' },
    });
    fireEvent.click(screen.getByRole('button', { name: va.save }));

    await waitFor(() => expect(mocks.saveMutate).toHaveBeenCalledTimes(1));
    expect(mocks.saveMutate.mock.calls[0]![0]).toEqual({
      version: VERSION,
      assessments: [
        { instrument: 'lia', use: 'scored', min: { globalPercentile: 40 }, reason: 'Análisis de datos' },
        { instrument: 'english', use: 'gate', min: { cefr: 'B2' }, reason: 'Atención a clientes en inglés' },
      ],
    });
  });

  it('offers only the advisory use for personality', () => {
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    fireEvent.change(screen.getByLabelText(va.addLabel), { target: { value: 'personality' } });
    fireEvent.click(screen.getByRole('button', { name: va.addButton }));
    const row = screen.getByText(en.candidates.fitInstrumentNames.personality).closest('li')!;
    const use = within(row).getByLabelText(va.useLabel);
    expect(use).toBeDisabled();
    expect(
      within(use)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['advisory']);
    expect(within(row).getByText(va.noteAdvisoryOnly)).toBeInTheDocument();
  });

  it('tells the editor when someone else changed the array', async () => {
    mocks.saveMutate.mockImplementation((_vars, options: { onError: (e: Error) => void }) =>
      options.onError(new VacancyAssessmentsConflict({ assessments: [], version: VERSION, issues: [] })),
    );
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    fireEvent.click(screen.getByRole('button', { name: va.removeAria.replace('{instrument}', 'LIA') }));
    fireEvent.click(screen.getByRole('button', { name: va.save }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(va.conflict, { type: 'error' }));
  });

  it('is read-only without vacancy:update', () => {
    mocks.canUpdateVacancy = false;
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    expect(screen.queryByRole('button', { name: va.save })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(va.addLabel)).not.toBeInTheDocument();
    expect(screen.getByLabelText(va.reasonLabel)).toBeDisabled();
  });

  it('says when the organization is not connected to TIMS Assessments', () => {
    mocks.catalog = { connected: false, instruments: [] };
    render(<VacancyAssessmentsCard vacancyId={VACANCY} />);
    expect(screen.getByText(va.notConnected)).toBeInTheDocument();
  });
});

// ── the candidate page ──────────────────────────────────────────────────────────────────────

const attempt = (instrument: string, status: string, result: unknown = null, extra: Record<string, unknown> = {}) => ({
  attemptId: crypto.randomUUID(),
  vacancyId: VACANCY,
  instrument,
  status,
  instrumentVersion: '1.0',
  missingConsents: [],
  expiresAt: '2026-11-20T15:00:00Z',
  createdAt: '2026-11-09T13:00:00Z',
  completedAt: null,
  lastErrorCode: null,
  timeMultiplier: 1,
  aids: [],
  countsIn: instrument === 'english' ? 'languages' : 'gate',
  result,
  ...extra,
});

const result = (extra: Record<string, unknown> = {}) => ({
  validity: 'valid',
  validityReasons: [],
  requiresHumanReview: false,
  reviewPending: false,
  minimum: 'not_met',
  globalPercentile: 30,
  cefr: null,
  level: null,
  instrumentVersion: '1.0',
  normVersion: 'n-1',
  completedAt: '2026-11-09T14:00:00Z',
  ...extra,
});

const applications = [{ status: 'active', vacancy: { id: VACANCY, title: 'Data Analyst' } }];
const renderCard = () => render(<ProviderAssessmentsCard candidateId="c1" applications={applications} />);

describe('ProviderAssessmentsCard', () => {
  it('shows a status chip per test, grouped under its vacancy', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('lia', 'consent_needed', null, { missingConsents: ['assessment'] }),
        attempt('english', 'in_progress'),
      ],
    };
    renderCard();
    expect(screen.getByText(`${pa.vacancyLabel}: Data Analyst`)).toBeInTheDocument();
    const chips = screen.getAllByTestId('provider-status-chip');
    expect(chips.map((c) => c.getAttribute('data-status'))).toEqual(['consent_needed', 'in_progress']);
    expect(screen.getByText(pa.status.consent_needed)).toBeInTheDocument();
    expect(screen.getByText(pa.awaitingConsent.replace('{purposes}', pa.purpose.assessment))).toBeInTheDocument();
    expect(screen.getByText(pa.countsIn.languages)).toBeInTheDocument(); // D3
  });

  it('shows HR the level and whether the minimum is met', () => {
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('lia', 'result_ready', result())] };
    renderCard();
    expect(screen.getByTestId('provider-result-level')).toHaveTextContent(pa.levelPercentile.replace('{value}', '30'));
    expect(screen.getByTestId('provider-result-minimum')).toHaveTextContent(pa.minimumNotMet);
  });

  // Owner default D6: the C# read gives a team leader no level; the view shows only "below minimum".
  it('shows a team leader only "below minimum", never a level', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('lia', 'result_ready', result({ globalPercentile: null, validityReasons: null }), {
          timeMultiplier: null,
          aids: null,
        }),
      ],
    };
    renderCard();
    expect(screen.queryByTestId('provider-result-level')).not.toBeInTheDocument();
    expect(screen.getByTestId('provider-result-minimum')).toHaveTextContent(pa.minimumNotMet);
    expect(screen.queryByText(/30/)).not.toBeInTheDocument();
  });

  // Mismatch 4: a candidate who declined the optional voice consent sits English without speaking; HR is told why.
  it('tells HR that speaking was not assessed because the candidate declined the voice consent', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('english', 'in_progress', null, { speakingNotAssessed: 'no_voice_consent' }),
        attempt('lia', 'in_progress', null, { speakingNotAssessed: null }),
      ],
    };
    renderCard();
    expect(screen.getByTestId('speaking-not-assessed')).toHaveTextContent(pa.speakingNotAssessed.no_voice_consent);
    expect(screen.getAllByTestId('speaking-not-assessed')).toHaveLength(1);
  });

  it('never shows a result awaiting review as a score', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('lia', 'needs_review', result({ validity: 'needs_review', reviewPending: true, minimum: 'unknown' })),
      ],
    };
    renderCard();
    expect(screen.queryByTestId('provider-result-level')).not.toBeInTheDocument();
    expect(screen.getByTestId('provider-result-review')).toHaveTextContent(pa.reviewPending);
    expect(screen.getByText(pa.validity.needs_review)).toBeInTheDocument();
  });

  it('shows nothing for a candidate who withdrew consent, and offers no assignment', () => {
    mocks.attempts = { consentWithdrawn: true, attempts: [] };
    renderCard();
    expect(screen.getByText(pa.withdrawn)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: pa.assign })).not.toBeInTheDocument();
  });

  it('offers no assignment without assessment:create', () => {
    mocks.canCreateAssessment = false;
    renderCard();
    expect(screen.queryByRole('button', { name: pa.assign })).not.toBeInTheDocument();
  });

  it('assigns every offered test of the vacancy after the age band and the consent notice', async () => {
    mocks.stored = {
      assessments: [
        lia,
        {
          instrument: 'english',
          use: 'gate',
          min: { globalPercentile: null, cefr: 'B2', level: null, score: null },
          weight: null,
          reason: 'Clientes',
        },
        { instrument: 'itcia', use: 'advisory', min: null, weight: null, reason: 'IA' }, // not offered to this org
        { instrument: 'native_quiz', use: 'scored', min: null, weight: null, reason: 'Quiz' }, // an ATS quiz, not a provider test
      ],
      version: VERSION,
      issues: [],
    };
    mocks.assignMutate.mockImplementation((_vars, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ complete: true, items: [] }),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: pa.assign }));

    const dialog = await screen.findByRole('dialog');
    const tests = within(dialog).getByTestId('assign-instruments');
    expect(
      within(tests)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['LIA', 'English']);
    expect(within(dialog).getByText(ap.notOffered.replace('{count}', '1'))).toBeInTheDocument();

    // The age band is required before the notice.
    fireEvent.click(within(dialog).getByRole('button', { name: ap.next }));
    await waitFor(() => expect(within(dialog).queryByTestId('assessment-consent-notice')).not.toBeInTheDocument());
    fireEvent.click(within(dialog).getByLabelText(ap.ageAdult));
    fireEvent.change(within(dialog).getByLabelText(ap.timeLabel), { target: { value: '1.5' } });
    fireEvent.click(within(dialog).getByLabelText(ap.aid.extended_breaks));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: ap.next }));
    });

    const notice = await within(dialog).findByTestId('assessment-consent-notice');
    expect(notice).toHaveTextContent('TIMS Assessments');
    expect(notice).toHaveTextContent('Acme Corp');
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.purpose.replace('{vacancy}', 'Data Analyst'));
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.recipientsTitle);
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.retentionTitle);
    expect(notice).toHaveTextContent(en.assessmentConsentNotice.rightsTitle);
    expect(within(notice).getByRole('note')).toHaveTextContent(en.assessmentConsentNotice.draftBanner); // D22
    const submit = within(dialog).getByRole('button', { name: ap.submit });
    expect(submit).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText(ap.consentAck));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.assignMutate).toHaveBeenCalledTimes(1));
    expect(mocks.assignMutate.mock.calls[0]![0]).toEqual({
      candidateId: 'c1',
      vacancyId: VACANCY,
      instruments: ['lia', 'english'],
      ageBand: '18_plus',
      timeMultiplier: 1.5,
      aids: ['extended_breaks'],
    });
    expect(mocks.toast).toHaveBeenCalledWith(ap.assigned, { type: 'success' });
  });

  it('explains a refused assignment by its code', async () => {
    mocks.assignMutate.mockImplementation((_vars, options: { onError: (e: unknown) => void }) =>
      options.onError(new PlatformApiError(409, 'Conflict', { error: 'open_attempt_terms_differ' })),
    );
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: pa.assign }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText(ap.ageAdult));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: ap.next }));
    });
    fireEvent.click(await within(dialog).findByLabelText(ap.consentAck));
    fireEvent.click(within(dialog).getByRole('button', { name: ap.submit }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(ap.errors.open_attempt_terms_differ);
  });

  it('says so when the vacancy lists no provider test', async () => {
    mocks.stored = { assessments: [], version: VERSION, issues: [] };
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: pa.assign }));
    expect(await within(await screen.findByRole('dialog')).findByText(ap.noInstruments)).toBeInTheDocument();
  });

  it('is in Spanish', () => {
    mocks.locale = 'es';
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('lia', 'result_ready', result())] };
    renderCard();
    expect(screen.getByText(es.providerAssessments.status.result_ready)).toBeInTheDocument();
    expect(screen.getByText(es.providerAssessments.minimumNotMet)).toBeInTheDocument();
  });
});

describe('assignErrorCode', () => {
  it('reads the route code, else the status', () => {
    expect(assignErrorCode(new PlatformApiError(422, 'x', { error: 'instrument_not_enabled' }))).toBe(
      'instrument_not_enabled',
    );
    expect(assignErrorCode(new PlatformApiError(404, 'x', { message: 'Vacante no encontrada' }))).toBe('not_found');
    expect(assignErrorCode(new Error('boom'))).toBe('unknown');
  });
});

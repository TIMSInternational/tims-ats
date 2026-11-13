import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The HR results board (Assessments tab): each TIMS result drawn from its profile (C# ProviderResultProfile), values
// always printed as text, the vacancy's minimum marked, nothing drawn for a result under review or a narrow reader.

const mocks = vi.hoisted(() => ({
  attempts: null as unknown,
  stored: null as unknown,
  locale: 'en' as 'en' | 'es',
  reports: { data: undefined, error: null, isPending: true, isError: false } as Record<string, unknown>,
  reportsEnabled: [] as boolean[],
  download: vi.fn(async () => undefined),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  const { default: es } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t: mocks.locale === 'en' ? en : es, locale: mocks.locale === 'en' ? 'EN' : 'ES' }) };
});
vi.mock('../../apps/web/lib/platform-api/fit-engine', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/fit-engine')>()),
  isFitEngineV2Enabled: () => true,
}));
vi.mock('../../apps/web/lib/platform-api/vacancy-assessments', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/vacancy-assessments')>()),
  useVacancyAssessments: () => ({ data: mocks.stored, isLoading: false, isError: false }),
}));
vi.mock('../../apps/web/lib/platform-api/assessment-providers-staff', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-providers-staff')>()),
  isProviderAssessmentsStaffEnabled: () => true,
  useCandidateProviderAttempts: () => ({ data: mocks.attempts }),
}));

vi.mock('../../apps/web/lib/platform-api/assessment-provider-reports', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/assessment-provider-reports')>()),
  useProviderReports: (_attemptId: string, enabled: boolean) => {
    mocks.reportsEnabled.push(enabled);
    return mocks.reports;
  },
  downloadProviderReport: mocks.download,
}));

import { PlatformApiError } from '../../apps/web/lib/platform-api/client';
import { ProviderResultsBoard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/provider-results/provider-results-board';

const VACANCY = '11111111-1111-4111-8111-111111111111';
const base = {
  validity: 'valid',
  validityReasons: [],
  requiresHumanReview: false,
  reviewPending: false,
  minimum: null,
  globalPercentile: null,
  cefr: null,
  level: null,
  instrumentVersion: '1.0',
  normVersion: null,
  completedAt: '2026-11-10T15:00:00.000Z',
};
const attempt = (instrument: string, n: number, result: Record<string, unknown> | null, status = 'result_ready') => ({
  attemptId: `0000000${n}-0000-4000-8000-000000000000`,
  vacancyId: VACANCY,
  instrument,
  status,
  instrumentVersion: '1.0',
  missingConsents: [],
  expiresAt: null,
  createdAt: '2026-11-10T14:00:00.000Z',
  completedAt: result ? '2026-11-10T15:00:00.000Z' : null,
  lastErrorCode: null,
  timeMultiplier: 1,
  aids: [],
  countsIn: instrument === 'english' ? 'languages' : instrument === 'lia' ? 'gate' : 'advisory',
  result: result ? { ...base, ...result } : null,
});

const lia = {
  globalPercentile: 62.4,
  globalLevel: 'high',
  normStatus: 'provisional',
  subtests: [
    { subtest: 'pattern_recognition', percentile: 70, level: 'high', completion: 'finished' },
    { subtest: 'working_memory', percentile: null, level: null, completion: 'timed_out' },
  ],
};
const english = {
  overallCefr: 'B2',
  overallScorePct: 71.5,
  skills: [
    { skill: 'grammar', assessed: true, cefr: 'B2', scorePct: 80, notAssessedReason: null },
    { skill: 'speaking', assessed: false, cefr: null, scorePct: null, notAssessedReason: 'consent_not_given' },
  ],
};
const personality = {
  variant: 'laboral',
  dimensions: [
    {
      dimension: 'ei',
      firstPole: 'E',
      secondPole: 'I',
      firstCount: 7,
      secondCount: 3,
      preferredPole: 'E',
      clarityPct: 40,
      balanced: false,
    },
    {
      dimension: 'sn',
      firstPole: 'S',
      secondPole: 'N',
      firstCount: 5,
      secondCount: 5,
      preferredPole: null,
      clarityPct: 0,
      balanced: true,
    },
  ],
};
const pca = {
  primaryGraph: 'under_pressure',
  graphs: [
    { graph: 'work_adaptation', d: 62, i: 48, s: 35, c: 55 },
    { graph: 'under_pressure', d: 70, i: 40, s: 30, c: 52 },
    { graph: 'self_image', d: 55, i: 50, s: 42, c: 49 },
  ],
  competencies: [{ code: 'tims-pca:trabajo_en_equipo', name: 'Trabajo en equipo', level: 3, scaleMax: 4 }],
};

// The contract's ITC-IA and MI shapes as the C# profile carries them (2026-11-13: these two had no detail at all).
const itcia = {
  globalLevel: 3,
  globalLevelCode: 'autonomo',
  coreScore: 1.92,
  completion: 'partial',
  categories: [
    { category: 'C1', score: 2.1, coverage: 'complete', provisional: false },
    { category: 'C4', score: 1.7, coverage: 'partial', provisional: true },
    { category: 'C6', score: null, coverage: 'partial', provisional: true },
  ],
  riskFlags: ['R2'],
  recommendedAutonomyLevel: 2,
};
const mi = {
  allComplete: false,
  intelligences: [
    { intelligence: 'linguistica', sumScore: 21, band: 3, bandCode: 'fortaleza', answered: 5 },
    { intelligence: 'musical', sumScore: 9, band: 1, bandCode: 'por_desarrollar', answered: 5 },
    { intelligence: 'emocional', sumScore: null, band: null, bandCode: null, answered: 3 },
  ],
  dominant: ['linguistica', 'interpersonal'],
  tied: true,
  noDifferentiation: false,
};

function all() {
  mocks.attempts = {
    consentWithdrawn: false,
    attempts: [
      attempt('pca', 4, { profile: { pca } }),
      attempt('personality', 3, { profile: { personality } }),
      attempt('english', 2, { cefr: 'B2', profile: { english } }),
      attempt('lia', 1, { globalPercentile: 62.4, profile: { lia } }),
    ],
  };
}

beforeEach(() => {
  mocks.locale = 'en';
  mocks.stored = {
    version: 1,
    assessments: [
      {
        instrument: 'lia',
        use: 'gate',
        min: { globalPercentile: 40, cefr: null, level: null, score: null },
        reason: 'r',
        weight: null,
      },
      {
        instrument: 'english',
        use: 'gate',
        min: { globalPercentile: null, cefr: 'C1', level: null, score: null },
        reason: 'r',
        weight: null,
      },
    ],
  };
  all();
});

const section = (name: RegExp) => screen.getByRole('region', { name });

describe('ProviderResultsBoard', () => {
  it('orders the tests LIA, English, Personality, PCA', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'LIA · Applied work intelligence',
      'English',
      'Personality',
      'PCA · Behavioral profile (DISC)',
    ]);
  });

  it('LIA: the global percentile, its level, the vacancy minimum, each subtest as text, provisional norms', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/LIA/);
    expect(within(card).getByText('62.4')).toBeTruthy();
    expect(within(card).getByText('High')).toBeTruthy();
    expect(within(card).getByText('Vacancy minimum: 40')).toBeTruthy();
    expect(within(card).getByLabelText('Pattern recognition: percentile 70')).toBeTruthy();
    expect(within(card).getByText('Not finished')).toBeTruthy();
    expect(within(card).getByText(/Provisional norms/)).toBeTruthy();
  });

  it('English: the overall level, the minimum on the overall ladder, a skill not assessed says why', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/^English/);
    expect(within(card).getByText('71.5% correct')).toBeTruthy();
    expect(within(card).getByText('Vacancy minimum: C1')).toBeTruthy();
    expect(within(card).getByLabelText('Grammar: B2')).toBeTruthy();
    expect(within(card).getByText('Not assessed: the candidate gave no voice consent')).toBeTruthy();
  });

  it('Personality: the four-letter profile reads x for a balanced dimension; each lean is text; advisory note', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/Personality/);
    expect(within(card).getByText('Ex')).toBeTruthy();
    expect(within(card).getByLabelText('Energy: Extroverted, clarity 40%')).toBeTruthy();
    expect(within(card).getByLabelText('Perception: Balanced')).toBeTruthy();
    expect(within(card).getByText(/never a reason to reject/)).toBeTruthy();
  });

  it('PCA: three graphs with the primary one marked, every value labelled, competencies as levels', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/PCA/);
    expect(within(card).getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(within(card).getByText('Primary')).toBeTruthy();
    expect(
      within(card).getByLabelText(
        'Behavior Under Pressure: Dominance 70, Influence 40, Steadiness 30, Compliance 52, out of 100',
      ),
    ).toBeTruthy();
    expect(within(card).getByLabelText('Trabajo en equipo: Level 3 of 4')).toBeTruthy();
  });

  // TIMS 2026-11-12: a PCA assigned with the vacancy's TIMS position code carries TIMS's own fit to that position.
  it("PCA: TIMS's fit to the position comes first, with the code, the percentage and the position's JCA profile", () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('pca', 4, {
          profile: {
            pca: {
              ...pca,
              jobFit: { jobCode: '194225', status: 'computed', fit: 78.5, jobProfile: { d: 62, i: 40, s: 55, c: 70 } },
            },
          },
        }),
      ],
    };
    render(<ProviderResultsBoard candidateId="c" />);
    const fit = within(section(/PCA/)).getByRole('region', { name: 'Fit to the position (TIMS)' });
    expect(within(fit).getByText('Position code 194225')).toBeTruthy();
    expect(within(fit).getByLabelText('Fit to the position: 78.5 percent').textContent).toBe('78.5%');
    expect(
      within(fit).getByLabelText('Position profile: Dominance 62, Influence 40, Steadiness 55, Compliance 70, out of 100'),
    ).toBeTruthy();
    expect(within(fit).getByText(/Computed by TIMS/)).toBeTruthy();
  });

  it('PCA: a position TIMS cannot compare, or a fit TIMS did not return, says so and shows no number', () => {
    for (const [status, text] of [
      ['job_not_found', /no completed JCA for this position code/],
      ['unavailable', /did not return the fit for this position. It is not a low score/],
    ] as const) {
      mocks.attempts = {
        consentWithdrawn: false,
        attempts: [
          attempt('pca', 4, { profile: { pca: { ...pca, jobFit: { jobCode: 'X1', status, fit: null, jobProfile: null } } } }),
        ],
      };
      const { unmount } = render(<ProviderResultsBoard candidateId="c" />);
      const fit = within(section(/PCA/)).getByRole('region', { name: 'Fit to the position (TIMS)' });
      expect(within(fit).getByText(text)).toBeTruthy();
      expect(within(fit).queryByText(/%$/)).toBeNull();
      unmount();
    }
  });

  it('PCA without a position code shows no fit block, and keeps the advisory note', () => {
    render(<ProviderResultsBoard candidateId="c" />);
    expect(within(section(/PCA/)).queryByRole('region', { name: 'Fit to the position (TIMS)' })).toBeNull();
  });

  it('speaks Spanish with the suite labels', () => {
    mocks.locale = 'es';
    render(<ProviderResultsBoard candidateId="c" />);
    expect(screen.getByText('Mínimo de la vacante: 40')).toBeTruthy();
    expect(screen.getByLabelText(/Conducta Bajo Presión: Dominancia 70/)).toBeTruthy();
    expect(screen.getByLabelText('Energía: Extrovertido, claridad 40%')).toBeTruthy();
  });

  it('draws nothing for a result under review, and says so', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [attempt('lia', 1, { reviewPending: true, validity: 'needs_review', profile: null }, 'needs_review')],
    };
    render(<ProviderResultsBoard candidateId="c" />);
    expect(screen.getByText(/TIMS is reviewing this result/)).toBeTruthy();
    expect(screen.queryByText('Vacancy minimum: 40')).toBeNull();
  });

  it('shows no detail to a narrow reader (no profile in the read, D6)', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [attempt('english', 2, { minimum: 'not_met', profile: null })],
    };
    render(<ProviderResultsBoard candidateId="c" />);
    expect(screen.getByText('This result has no detail to show.')).toBeTruthy();
    expect(screen.queryByText('B2')).toBeNull();
  });

  it('says results are not ready before the candidate finishes', () => {
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('pca', 4, null, 'sent')] };
    render(<ProviderResultsBoard candidateId="c" />);
    expect(screen.getByText(/Results appear here once the candidate finishes/)).toBeTruthy();
  });

  it('PDF reports: a company-scope card offers them, loads the list only when opened, and saves the one chosen', async () => {
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('pca', 4, { profile: { pca } })] };
    mocks.reports = {
      data: [
        { variant: 'pca', title: 'Informe PCA' },
        { variant: 'gd', title: null },
      ],
      error: null,
      isPending: false,
      isError: false,
    };
    mocks.reportsEnabled = [];
    mocks.download.mockClear();
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/PCA/);
    const button = within(card).getByRole('button', { name: 'PDF reports' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(mocks.reportsEnabled.every((enabled) => !enabled)).toBe(true); // nothing is read until it opens
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(card).getByRole('button', { name: 'Informe PCA' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'gd' })); // no title: the variant id
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('00000004-0000-4000-8000-000000000000', 'pca', 'gd'));
    await waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false')); // closes once saved
  });

  it('PDF reports: the native report is the results report; a narrow reader, a voided result and a 403 get no menu', () => {
    mocks.reports = { data: [{ variant: null, title: null }], error: null, isPending: false, isError: false };
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('lia', 1, { profile: { lia } })] };
    const { unmount } = render(<ProviderResultsBoard candidateId="c" />);
    fireEvent.click(within(section(/LIA/)).getByRole('button', { name: 'PDF reports' }));
    expect(within(section(/LIA/)).getByRole('button', { name: 'Results report' })).toBeTruthy();
    unmount();

    for (const result of [{ profile: null }, { profile: { lia }, validity: 'voided' }]) {
      mocks.attempts = { consentWithdrawn: false, attempts: [attempt('lia', 1, result)] };
      const view = render(<ProviderResultsBoard candidateId="c" />);
      expect(screen.queryByRole('button', { name: 'PDF reports' })).toBeNull();
      view.unmount();
    }

    mocks.reports = { data: undefined, error: new PlatformApiError(403, 'Forbidden'), isPending: false, isError: true };
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('lia', 1, { profile: { lia } })] };
    render(<ProviderResultsBoard candidateId="c" />);
    expect(screen.queryByRole('button', { name: 'PDF reports' })).toBeNull();
  });

  it('ITC-IA: the level by name and as n of 5, the minimum, the evidence per category, flags and autonomy', () => {
    mocks.stored = {
      version: 1,
      assessments: [
        { instrument: 'itcia', use: 'scored', min: { level: 3 }, reason: 'r', weight: null },
      ],
    };
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('itcia', 5, { level: 3, profile: { itcia } })] };
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/^ITC-IA/);
    expect(within(card).getByText('Autonomous')).toBeTruthy();
    expect(within(card).getByText('Level 3 of 5')).toBeTruthy();
    expect(within(card).getByText('Vacancy minimum: level 3')).toBeTruthy();
    expect(within(card).getByText('Core evidence: 1.92 of 3')).toBeTruthy();
    expect(within(card).getByLabelText('Problem framing: evidence 2.10 of 3')).toBeTruthy();
    expect(within(card).getAllByText('Provisional (few observations) · Partially covered')).toHaveLength(2);
    // A category without evidence prints a dash, not 0.
    expect(within(card).getByLabelText('Workflow integration and orchestration')).toBeTruthy();
    expect(within(card).getByText('R2 · High-impact decision')).toBeTruthy();
    expect(within(card).getByText('Recommended autonomy: Functional')).toBeTruthy();
    expect(within(card).getByText(/closed before every category was covered/)).toBeTruthy();
    expect(within(card).getByText(/provisional until TIMS recalibrates/)).toBeTruthy();
  });

  it('ITC-IA: no level says why; no flag says so', () => {
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [attempt('itcia', 5, { profile: { itcia: { ...itcia, globalLevel: null, riskFlags: [] } } })],
    };
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/^ITC-IA/);
    expect(within(card).getByText(/No global level/)).toBeTruthy();
    expect(within(card).getByText('No critical flag was raised.')).toBeTruthy();
    expect(within(card).queryByText(/Level \d of 5/)).toBeNull();
  });

  it('MI: the dominant intelligences, each sum of 25 with its band, an unanswered one has neither; advisory note', () => {
    mocks.attempts = { consentWithdrawn: false, attempts: [attempt('mi', 6, { profile: { mi } })] };
    render(<ProviderResultsBoard candidateId="c" />);
    const card = section(/^Multiple intelligences/);
    expect(within(card).getByText('Linguistic · Interpersonal')).toBeTruthy();
    expect(within(card).getByText(/share the top score/)).toBeTruthy();
    expect(within(card).getByLabelText('Linguistic: 21 of 25, Strength')).toBeTruthy();
    expect(within(card).getByLabelText('Musical: 9 of 25, To develop')).toBeTruthy();
    expect(within(card).getByLabelText('Emotional: Not answered')).toBeTruthy();
    expect(within(card).getByText(/Not every intelligence was answered/)).toBeTruthy();
    expect(within(card).getByText(/it never decides/)).toBeTruthy();
  });

  it('ITC-IA and MI speak Spanish with the suite labels, after PCA, and each offers its PDF report', () => {
    mocks.locale = 'es';
    mocks.reports = { data: [{ variant: null, title: null }], error: null, isPending: false, isError: false };
    mocks.attempts = {
      consentWithdrawn: false,
      attempts: [
        attempt('mi', 6, { profile: { mi } }),
        attempt('itcia', 5, { profile: { itcia } }),
        attempt('pca', 4, { profile: { pca } }),
      ],
    };
    render(<ProviderResultsBoard candidateId="c" />);
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.slice(1)).toEqual(['ITC-IA · Pensamiento crítico con IA', 'Inteligencias múltiples']);
    expect(within(section(/^ITC-IA/)).getByText('Autónomo')).toBeTruthy();
    expect(within(section(/^ITC-IA/)).getByLabelText('Planteamiento del problema: evidencia 2.10 de 3')).toBeTruthy();
    expect(within(section(/^Inteligencias/)).getByLabelText('Lingüística: 21 de 25, Fortaleza')).toBeTruthy();
    for (const name of [/^ITC-IA/, /^Inteligencias/]) {
      expect(within(section(name)).getByRole('button', { name: 'Informes PDF' })).toBeTruthy();
    }
  });

  it('the attempts read accepts the ITC-IA and MI profiles and refuses one off their scales', async () => {
    const { parseCandidateProviderAttempts } = await import(
      '../../apps/web/lib/platform-api/assessment-providers-staff'
    );
    const read = (profile: unknown) => ({
      consentWithdrawn: false,
      attempts: [attempt('itcia', 5, { profile: profile as Record<string, unknown> })],
    });
    expect(() => parseCandidateProviderAttempts(read({ itcia }))).not.toThrow();
    expect(() => parseCandidateProviderAttempts(read({ mi }))).not.toThrow();
    expect(() => parseCandidateProviderAttempts(read({ itcia: { ...itcia, coreScore: 3.5 } }))).toThrow();
    expect(() => parseCandidateProviderAttempts(read({ itcia: { ...itcia, riskFlags: ['R9'] } }))).toThrow();
    expect(() =>
      parseCandidateProviderAttempts(
        read({ mi: { ...mi, intelligences: [{ ...mi.intelligences[0], sumScore: 30 }] } }),
      ),
    ).toThrow();
  });

  it('renders nothing for a withdrawn candidate or without attempts', () => {
    mocks.attempts = { consentWithdrawn: true, attempts: [] };
    const { container } = render(<ProviderResultsBoard candidateId="c" />);
    expect(container.textContent).toBe('');
  });
});

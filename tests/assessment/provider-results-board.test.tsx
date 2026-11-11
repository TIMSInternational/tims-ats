import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// The HR results board (Assessments tab): each TIMS result drawn from its profile (C# ProviderResultProfile), values
// always printed as text, the vacancy's minimum marked, nothing drawn for a result under review or a narrow reader.

const mocks = vi.hoisted(() => ({
  attempts: null as unknown,
  stored: null as unknown,
  locale: 'en' as 'en' | 'es',
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

  it('renders nothing for a withdrawn candidate or without attempts', () => {
    mocks.attempts = { consentWithdrawn: true, attempts: [] };
    const { container } = render(<ProviderResultsBoard candidateId="c" />);
    expect(container.textContent).toBe('');
  });
});

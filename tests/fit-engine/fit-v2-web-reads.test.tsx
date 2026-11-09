import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// FIT v2 in apps/web, the reads: under NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP the vacancy ranking, the what-if, the compute
// and the candidate page's fit scores come from C# (which applies owner default D6 for a team leader), never from the
// TS payload; and the candidate page's breakdown and assessment panels mark what awaits review and what is below the
// minimum, in words, never as a number.

const mocks = vi.hoisted(() => ({
  v2: true,
  platformGet: vi.fn(),
  platformPost: vi.fn(),
  trpcRanking: vi.fn(),
  trpcCompute: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t, locale: 'en' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  isPlatformApiEnabled: () => true,
  platformGet: mocks.platformGet,
  platformPost: mocks.platformPost,
  platformGetRaw: vi.fn(),
  platformSendRaw: vi.fn(),
}));
vi.mock('../../apps/web/lib/platform-api/fit-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/lib/platform-api/fit-engine')>();
  return { ...actual, isFitEngineV2Enabled: () => mocks.v2 };
});
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ fitEngine: { getRankingForVacancy: { invalidate: vi.fn() } } }),
    fitEngine: {
      getRankingForVacancy: {
        useQuery: (input: unknown, opts?: { enabled?: boolean }) => {
          mocks.trpcRanking(input, opts);
          return opts?.enabled === false
            ? { data: undefined, isLoading: false, isError: false }
            : {
                data: [
                  { candidateId: 'ts-row', firstName: 'Tess', lastName: 'TS', overallScore: 61, isPartial: false },
                ],
                isLoading: false,
                isError: false,
              };
        },
      },
      computeForVacancy: { useMutation: () => ({ mutate: mocks.trpcCompute, isPending: false }) },
      simulateWeights: { useQuery: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }) },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/vacancies/[id]/candidate-fit-panel', () => ({
  CandidateFitPanel: () => null,
}));
vi.mock('../../apps/web/components/ai-suggestion-notice', () => ({ AiSuggestionNotice: () => null }));

import en from '../../apps/web/lib/i18n/en.json';
import { assignmentsAwaitingReview, fitV2Entries } from '../../apps/web/lib/fit-v2-breakdown';
import { withCandidatePageFitScores } from '../../apps/web/lib/platform-api/fit-engine-reads';
import { FitBreakdown } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/fit-breakdown';
import { AssessmentResults } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results';
import { FitRanking } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/fit-ranking';

const VACANCY = '7ac00000-0000-4000-8000-000000000001';
const CAND = 'ca000000-0000-4000-8000-000000000001';
const FS = 'f5000000-0000-4000-8000-000000000001';

const entry = (over: Record<string, unknown>) => ({
  instrument: 'lia',
  use: 'scored',
  status: 'completed',
  score: 100,
  gate: null,
  weight: null,
  assessmentShare: 1,
  effectiveWeight: 0.4,
  min: { globalPercentile: 40 },
  reason: null,
  resultId: 'r1',
  source: 'provider',
  contentVersion: null,
  normVersion: null,
  languagesEvidence: null,
  ...over,
});
const v2 = (over: Record<string, unknown>, entries: unknown[]) => ({
  assessment: 80,
  interview: 70,
  experience: 100,
  education: null,
  languages: 100,
  llmJudgment: null,
  fitVersion: 2,
  reviewPending: false,
  assessments: entries,
  ...over,
});

function withClient(node: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.v2 = true;
  vi.clearAllMocks();
});

describe('candidate page breakdown panel', () => {
  it('marks a provisional score and each instrument that needs review, in words', () => {
    const breakdown = v2({ reviewPending: true, assessment: null }, [
      entry({ status: 'needs_review', score: null }),
      entry({ instrument: 'english', use: 'gate', gate: 'met', score: null, min: { cefr: 'B2' } }),
    ]);
    render(<FitBreakdown fitScores={[{ id: FS, overallScore: 70, breakdown, calculatedAt: new Date() }]} />);
    expect(screen.getByTestId('fit-review-pending')).toBeTruthy();
    expect(screen.getByTestId('fit-instrument-needs-review').textContent).toBe(en.candidates.fitInstrumentNeedsReview);
    expect(screen.getByText(en.candidates.fitInstrumentGateMet)).toBeTruthy();
  });

  it('a redacted entry (D6) reads "below minimum", and so does the assessment dimension it fed', () => {
    const breakdown = v2({ assessment: null }, [entry({ score: null, belowMinimum: true })]);
    render(<FitBreakdown fitScores={[{ id: FS, overallScore: 92, breakdown, calculatedAt: new Date() }]} />);
    expect(screen.getByTestId('fit-instrument-below-minimum')).toBeTruthy();
    expect(screen.getAllByText(en.candidates.fitInstrumentBelowMinimum)).toHaveLength(2);
    expect(screen.queryByTestId('fit-review-pending')).toBeNull();
    expect(screen.queryByText(/\/100$/, { selector: '[data-testid="fit-instruments"] span' })).toBeNull();
  });

  it('a v1 breakdown renders exactly as before: no instruments block, no marker', () => {
    render(
      <FitBreakdown
        fitScores={[
          {
            id: FS,
            overallScore: 70,
            breakdown: {
              assessment: 70,
              interview: null,
              experience: 50,
              education: null,
              languages: 100,
              llmJudgment: null,
            },
            calculatedAt: new Date(),
          },
        ]}
      />,
    );
    expect(screen.queryByTestId('fit-instruments')).toBeNull();
    expect(screen.queryByTestId('fit-review-pending')).toBeNull();
    expect(screen.getByText('70/100')).toBeTruthy();
  });
});

describe('candidate page assessment panel', () => {
  const assignment = (id: string) => ({
    id,
    status: 'completed',
    assignedAt: new Date(),
    completedAt: new Date(),
    assessmentType: { id: `t-${id}`, name: `Quiz ${id}`, code: `quiz-${id}` },
    result: { id: `r-${id}`, normalizedScore: 90 },
  });

  it('marks only the assignments a stored score holds as needs review (several quizzes included)', () => {
    mocks.v2 = false; // keeps the essay panel (and its query client) out of this render
    const fit = {
      id: FS,
      overallScore: 70,
      calculatedAt: new Date(),
      breakdown: v2({}, [
        entry({
          instrument: 'native_quiz',
          source: 'ats',
          status: 'needs_review',
          score: null,
          resultId: 'a1',
          resultIds: ['a1', 'a2'],
          min: null,
        }),
      ]),
    };
    render(
      <AssessmentResults assignments={[assignment('a1'), assignment('a2'), assignment('a3')]} fitScores={[fit]} />,
    );
    expect(screen.getAllByTestId('assessment-review-pending')).toHaveLength(2);
    expect(assignmentsAwaitingReview([fit])).toEqual(new Set(['a1', 'a2']));
  });

  it('a provider result id, a completed entry or a v1 row marks nothing', () => {
    expect(
      assignmentsAwaitingReview([
        { breakdown: v2({}, [entry({ status: 'needs_review', source: 'provider', resultId: 'a1' })]) },
        { breakdown: v2({}, [entry({ instrument: 'native_quiz', source: 'ats', resultId: 'a2' })]) },
        { breakdown: { assessment: 50 } },
      ]).size,
    ).toBe(0);
    expect(fitV2Entries(v2({}, [{ instrument: 'unknown', use: 'scored', status: 'completed' }, 'junk']))).toEqual([]);
  });
});

describe('the candidate page fit scores', () => {
  const tsRow = { id: 'ts', overallScore: 73, breakdown: { assessment: 50 }, calculatedAt: new Date() };
  const csharpRow = { id: FS, overallScore: 92, breakdown: { assessment: null }, calculatedAt: new Date() };

  it('flag on: only the C# rows, and nothing (never the TS payload) while they load or after a failure', () => {
    expect(withCandidatePageFitScores({ id: CAND, fitScores: [tsRow] }, { data: [csharpRow] }).fitScores).toEqual([
      csharpRow,
    ]);
    expect(withCandidatePageFitScores({ id: CAND, fitScores: [tsRow] }, { data: undefined }).fitScores).toEqual([]);
  });

  it('flag off: the candidate.getById rows, unchanged', () => {
    mocks.v2 = false;
    const candidate = { id: CAND, fitScores: [tsRow] };
    expect(withCandidatePageFitScores(candidate, { data: [csharpRow] })).toBe(candidate);
  });
});

describe('vacancy FIT ranking', () => {
  const csharpRow = {
    fitScoreId: FS,
    candidateId: CAND,
    firstName: 'Cora',
    lastName: 'Sharp',
    overallScore: 92,
    breakdown: v2({ assessment: null }, [entry({ score: null, belowMinimum: true })]),
    isPartial: true,
    calculatedAt: '2026-11-08T00:00:00.000Z',
  };

  it('flag on: the C# ranking (the tRPC query never runs), and Compute calls the C# compute', async () => {
    mocks.platformGet.mockResolvedValue([csharpRow]);
    mocks.platformPost.mockResolvedValue({ computed: 4 });
    render(withClient(<FitRanking vacancyId={VACANCY} />));

    expect(await screen.findByText('Cora Sharp')).toBeTruthy();
    expect(screen.queryByText('Tess TS')).toBeNull();
    expect(mocks.trpcRanking).toHaveBeenCalledWith({ vacancyId: VACANCY }, { enabled: false });
    expect(mocks.platformGet).toHaveBeenCalledWith('/fit-engine/vacancies/{vacancyId}/ranking', undefined, {
      vacancyId: VACANCY,
    });

    fireEvent.click(screen.getByText(en.fitRanking.computeButton));
    await waitFor(() =>
      expect(mocks.platformPost).toHaveBeenCalledWith('/fit-engine/vacancies/{vacancyId}/compute', undefined, {
        vacancyId: VACANCY,
      }),
    );
    expect(mocks.trpcCompute).not.toHaveBeenCalled();
  });

  it('flag off: the tRPC ranking and compute, and no C# call', () => {
    mocks.v2 = false;
    render(withClient(<FitRanking vacancyId={VACANCY} />));
    expect(screen.getByText('Tess TS')).toBeTruthy();
    fireEvent.click(screen.getByText(en.fitRanking.computeButton));
    expect(mocks.trpcCompute).toHaveBeenCalledWith({ vacancyId: VACANCY });
    expect(mocks.platformGet).not.toHaveBeenCalled();
    expect(mocks.platformPost).not.toHaveBeenCalled();
  });

  it('a malformed C# ranking is an error, never rendered', async () => {
    mocks.platformGet.mockResolvedValue([{ ...csharpRow, extra: 'x' }]);
    render(withClient(<FitRanking vacancyId={VACANCY} />));
    await waitFor(() => expect(mocks.platformGet).toHaveBeenCalled());
    expect(screen.queryByText('Cora Sharp')).toBeNull();
  });
});

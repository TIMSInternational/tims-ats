import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewDetail } from '../../apps/web/lib/trpc-types';

// The vacancy's "Competencias del puesto" end to end in the interview room: the scorecard rates them (with
// their description and target on its own scale), the evaluator comparison breaks each visible card down by
// the same competencies, and the AI guide shows a question set per competency.

type Opts = { onSuccess: (d: unknown) => void; onError: (e: unknown) => void };
const h = vi.hoisted(() => ({ guideOpts: null as null | Opts }));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      interview: {
        getScorecard: { invalidate: () => undefined },
        getById: { invalidate: () => undefined },
        getPendingScorecards: { invalidate: () => undefined },
      },
    }),
    interview: {
      getScorecard: { useQuery: () => ({ isLoading: false, isError: false, data: null, refetch: () => undefined }) },
      submitScorecard: { useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }) },
      generateGuide: {
        useMutation: (opts: Opts) => {
          h.guideOpts = opts;
          return { mutate: vi.fn(), isPending: false };
        },
      },
      generateSummary: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      detectBias: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/components', () => ({ Skeleton: () => <div data-testid="skeleton" /> }));

import { ScorecardForm } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-form';
import { InterviewAiPanel } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-ai-panel';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PROFILE = [
  { name: 'Negociación', level: 3, scaleMax: 4, code: 'x:negotiation', description: 'Cierra acuerdos sostenibles' },
  { name: 'SQL', level: 5, scaleMax: 5 },
];

function interview(scorecards: unknown[]): InterviewDetail {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    type: 'video',
    scheduledAt: new Date('2026-11-10T15:00:00Z'),
    duration: 45,
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: 'a@x.co', phone: null, avatar: null },
    vacancy: { id: 'v1', title: 'Ejecutivo' },
    evaluators: [
      {
        id: 'e1',
        userId: ME,
        role: 'evaluator',
        status: 'done',
        user: { id: ME, firstName: 'Yo', lastName: 'Mismo', avatar: null },
      },
      {
        id: 'e2',
        userId: OTHER,
        role: 'evaluator',
        status: 'done',
        user: { id: OTHER, firstName: 'Otra', lastName: 'Persona', avatar: null },
      },
    ],
    scorecards,
    scorecardCompetencies: PROFILE,
  } as unknown as InterviewDetail;
}

const wrap = (ui: React.ReactNode) => {
  localStorage.setItem('tims-locale', 'EN');
  return render(<I18nProvider>{ui}</I18nProvider>);
};

beforeEach(() => {
  h.guideOpts = null;
});

describe('interview room — vacancy competencies', () => {
  it('rates the job profile competencies, showing description and the target on its own scale', () => {
    wrap(<ScorecardForm interview={interview([])} currentUserId={ME} />);
    expect(screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'))).toEqual(['Negociación', 'SQL']);
    expect(screen.getByText('Cierra acuerdos sostenibles')).toBeInTheDocument();
    expect(
      screen.getByText(en.interviewRoom.targetLevel.replace('{n}', '3').replace('{max}', '4')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(en.interviewRoom.targetLevel.replace('{n}', '5').replace('{max}', '5')),
    ).toBeInTheDocument();
    expect(screen.getByTestId('competency-source')).toHaveTextContent(en.interviewRoom.competenciesSourceVacancy);
  });

  it('breaks a visible card down by the same competencies, and never a withheld one', () => {
    const visible = {
      id: 's1',
      evaluatorId: OTHER,
      ratings: { Negociación: 2 },
      recommendation: 'yes',
      submittedAt: new Date(),
      isWithheld: false,
    };
    const mine = {
      id: 's2',
      evaluatorId: ME,
      ratings: { SQL: 4, Negociación: 3 },
      recommendation: 'yes',
      submittedAt: new Date(),
      isWithheld: false,
    };
    wrap(<ScorecardForm interview={interview([visible, mine])} currentUserId={ME} />);
    const comparison = screen.getByRole('region', { name: en.interviews.evaluatorComparison });
    const details = within(comparison).getAllByText(en.interviewRoom.comparisonDetails);
    expect(details).toHaveLength(2);
    const otherRow = within(comparison)
      .getByText(/Otra Persona/)
      .closest('li')!;
    expect(within(otherRow).getByText(en.interviewRoom.comparisonRating.replace('{n}', '2'))).toBeInTheDocument();
    // SQL was not rated on that card: said so, never shown as a score.
    expect(within(otherRow).getByText(en.interviewRoom.comparisonNotRated)).toBeInTheDocument();
  });

  it('shows no breakdown for a withheld stub', () => {
    const stub = {
      id: 's1',
      evaluatorId: OTHER,
      ratings: {},
      recommendation: '',
      submittedAt: new Date(),
      isWithheld: true,
    };
    wrap(<ScorecardForm interview={interview([stub])} currentUserId={ME} />);
    expect(screen.queryByText(en.interviewRoom.comparisonDetails)).toBeNull();
  });

  it('lists the guide questions per competency with the vacancy target', () => {
    wrap(<InterviewAiPanel interviewId="33333333-3333-4333-8333-333333333333" />);
    act(() => {
      h.guideOpts!.onSuccess({
        interviewId: 'x',
        model: 'haiku',
        sections: [{ title: 'Apertura', duration: 5, questions: ['Cuéntame de ti'] }],
        competencyQuestions: [
          { competency: 'Negociación', targetLevel: 3, targetScaleMax: 4, questions: ['Una negociación difícil'] },
        ],
      });
    });
    expect(screen.getByText(en.interviews.guideCompetencyHeading)).toBeInTheDocument();
    expect(screen.getByText('Una negociación difícil')).toBeInTheDocument();
    expect(
      screen.getByText(en.interviews.guideTargetLevel.replace('{n}', '3').replace('{max}', '4')),
    ).toBeInTheDocument();
  });

  it('renders the guide as before when there are no competency questions', () => {
    wrap(<InterviewAiPanel interviewId="33333333-3333-4333-8333-333333333333" />);
    act(() => {
      h.guideOpts!.onSuccess({
        interviewId: 'x',
        model: 'haiku',
        sections: [{ title: 'Apertura', duration: 5, questions: ['q'] }],
        competencyQuestions: [],
      });
    });
    expect(screen.getByText('Apertura')).toBeInTheDocument();
    expect(screen.queryByText(en.interviews.guideCompetencyHeading)).toBeNull();
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// FIT v2 in apps/web: the reviewPending marker on the candidate header + high-fit banner (from the stored breakdown)
// and on the candidate and talent-pool tables (from the C# review-state read); the requirements card saving through
// the C# writer under the flag (never sending `assessments`, so the stored array is kept); and the D5 essay grading
// control on the assessment results view.

const mocks = vi.hoisted(() => ({
  v2: true,
  pending: new Set<string>(),
  reviewError: false,
  trpcMutate: vi.fn(),
  v2Mutate: vi.fn(),
  gradeMutate: vi.fn(),
  essays: [] as unknown[],
  canGrade: true,
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t, locale: 'en' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan: () => (module: string, action?: string) => module === 'assessment' && (action !== 'update' || mocks.canGrade),
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ vacancy: { getById: { invalidate: vi.fn() } } }),
    vacancy: { updateFitRequirements: { useMutation: () => ({ mutate: mocks.trpcMutate, isPending: false }) } },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-stage-modal', () => ({ CandidateStageModal: () => null }));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-button', () => ({ CreateOfferButton: () => null }));
vi.mock('../../apps/web/app/(admin)/recruitment/pipeline/reject-candidate-modal', () => ({ RejectCandidateModal: () => null }));
vi.mock('../../apps/web/lib/platform-api/fit-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/web/lib/platform-api/fit-engine')>();
  return {
    ...actual,
    isFitEngineV2Enabled: () => mocks.v2,
    useReviewPendingFitScores: () =>
      mocks.reviewError ? { data: undefined, isError: true } : { data: mocks.pending, isError: false },
    useUpdateFitRequirementsViaCsharp: () => ({ mutate: mocks.v2Mutate, isPending: false }),
    usePendingEssays: (_id: string, enabled: boolean) => ({ data: enabled ? mocks.essays : undefined }),
    useGradeEssay: () => ({ mutate: mocks.gradeMutate, isPending: false }),
  };
});

import en from '../../apps/web/lib/i18n/en.json';
import { isReviewPending } from '../../apps/web/lib/platform-api/fit-engine';
import { CandidateHeader } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-header';
import { CandidateTable } from '../../apps/web/app/(admin)/recruitment/candidates/candidate-table';
import { TalentPoolTable } from '../../apps/web/app/(admin)/recruitment/talent-pools/talent-pool-table';
import { FitRequirementsCard } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/fit-requirements-card';
import { EssayGradingPanel } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/essay-grading-panel';

const FS1 = '11111111-1111-4111-8111-111111111111';
const FS2 = '22222222-2222-4222-8222-222222222222';

const listCandidate = (id: string, fitScoreId: string, score: number) => ({
  id,
  firstName: `F${id}`,
  lastName: 'L',
  email: `${id}@t.test`,
  phone: null,
  source: 'manual',
  poolType: 'applicant',
  avatar: null,
  location: null,
  currentTitle: null,
  currentCompany: null,
  skills: [],
  yearsExperience: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [],
  fitScores: [{ id: fitScoreId, overallScore: score, calculatedAt: new Date() }],
  applications: [],
  _count: { applications: 0 },
});

beforeEach(() => {
  mocks.v2 = true;
  mocks.pending = new Set();
  mocks.reviewError = false;
  mocks.essays = [];
  mocks.canGrade = true;
  vi.clearAllMocks();
});

describe('isReviewPending', () => {
  it('is true only for a breakdown with reviewPending exactly true', () => {
    expect(isReviewPending({ reviewPending: true })).toBe(true);
    expect(isReviewPending({ reviewPending: false })).toBe(false);
    expect(isReviewPending({ reviewPending: 'true' })).toBe(false);
    expect(isReviewPending({ assessment: 80 })).toBe(false);
    expect(isReviewPending(null)).toBe(false);
    expect(isReviewPending([{ reviewPending: true }])).toBe(false);
  });
});

describe('candidate header', () => {
  const header = (breakdown: unknown) =>
    ({
      id: 'c1',
      firstName: 'Ana',
      lastName: 'Ruiz',
      email: 'a@t.test',
      phone: null,
      avatar: null,
      source: 'manual',
      poolType: 'applicant',
      location: null,
      currentTitle: null,
      currentCompany: null,
      applications: [],
      tags: [],
      fitScores: [{ id: FS1, overallScore: 90, breakdown, calculatedAt: new Date() }],
    }) as never;

  it('marks a provisional score at the circle and in the high-fit banner', () => {
    render(<CandidateHeader candidate={header({ fitVersion: 2, reviewPending: true })} />);
    expect(screen.getAllByTestId('fit-review-pending')).toHaveLength(2);
    expect(screen.getByText(en.candidates.fitReviewPending)).toBeTruthy();
  });

  it('shows no marker for a final score', () => {
    render(<CandidateHeader candidate={header({ fitVersion: 2, reviewPending: false })} />);
    expect(screen.queryByTestId('fit-review-pending')).toBeNull();
  });
});

describe('list tables', () => {
  it('candidate table marks only the provisional score', () => {
    mocks.pending = new Set([FS2]);
    render(
      <CandidateTable
        candidates={[listCandidate('a', FS1, 70), listCandidate('b', FS2, 85)] as never}
        isLoading={false}
      />,
    );
    const badges = screen.getAllByTestId('fit-review-pending');
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('tr')?.textContent).toContain('Fb');
  });

  it('a failed review-state read marks every score "unknown", never final (both tables)', () => {
    mocks.reviewError = true;
    const rows = [listCandidate('a', FS1, 70), listCandidate('b', FS2, 85)] as never;
    const { unmount } = render(<CandidateTable candidates={rows} isLoading={false} />);
    expect(screen.getAllByTestId('fit-review-unknown')).toHaveLength(2);
    unmount();
    render(<TalentPoolTable candidates={rows} isLoading={false} onNextPage={() => undefined} onPrevPage={() => undefined} />);
    expect(screen.getAllByTestId('fit-review-unknown')).toHaveLength(2);
  });

  it('talent-pool table marks only the provisional score', () => {
    mocks.pending = new Set([FS1]);
    render(
      <TalentPoolTable
        candidates={[listCandidate('a', FS1, 70), listCandidate('b', FS2, 85)] as never}
        isLoading={false}
        onNextPage={() => undefined}
        onPrevPage={() => undefined}
      />,
    );
    expect(screen.getAllByTestId('fit-review-pending')).toHaveLength(1);
  });
});

describe('requirements card', () => {
  const requirements = { minYearsExperience: 2, assessments: [{ instrument: 'lia' }, { instrument: 'mi' }] };

  it('flag on: saves through the C# writer without an assessments key, and says the assessments are kept', () => {
    render(<FitRequirementsCard vacancyId="v1" fitRequirements={requirements} />);
    expect(screen.getByText(en.fitRequirements.assessmentsKept.replace('{count}', '2'))).toBeTruthy();

    fireEvent.click(screen.getByText(en.fitRequirements.saveButton));

    expect(mocks.trpcMutate).not.toHaveBeenCalled();
    expect(mocks.v2Mutate).toHaveBeenCalledTimes(1);
    const input = mocks.v2Mutate.mock.calls[0][0] as Record<string, unknown>;
    expect(input.vacancyId).toBe('v1');
    expect(input.minYearsExperience).toBe(2);
    expect('assessments' in input).toBe(false);
  });

  it('flag off: the TS mutation, unchanged', () => {
    mocks.v2 = false;
    render(<FitRequirementsCard vacancyId="v1" fitRequirements={requirements} />);
    fireEvent.click(screen.getByText(en.fitRequirements.saveButton));
    expect(mocks.v2Mutate).not.toHaveBeenCalled();
    expect(mocks.trpcMutate).toHaveBeenCalledTimes(1);
  });
});

describe('essay grading (D5)', () => {
  const essay = { questionId: '33333333-3333-4333-8333-333333333333', prompt: 'Explain A', answer: '<b>Answer</b>', maxPoints: 2 };

  it('shows the pending essays as text and grades one within bounds', () => {
    mocks.essays = [essay];
    render(<EssayGradingPanel assignmentId="asg-1" />);
    expect(screen.getByText('<b>Answer</b>')).toBeTruthy(); // rendered as text, never as HTML

    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.click(screen.getByText(en.candidates.essayGradeButton));
    expect(mocks.gradeMutate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.click(screen.getByText(en.candidates.essayGradeButton));
    expect(mocks.gradeMutate).toHaveBeenCalledWith({ questionId: essay.questionId, points: 1.5 }, expect.anything());
  });

  it('without assessment:update shows the essays but no grade control', () => {
    mocks.essays = [essay];
    mocks.canGrade = false;
    render(<EssayGradingPanel assignmentId="asg-1" />);
    expect(screen.getByText('Explain A')).toBeTruthy();
    expect(screen.queryByText(en.candidates.essayGradeButton)).toBeNull();
  });

  it('renders nothing with the flag off or nothing pending', () => {
    mocks.v2 = false;
    mocks.essays = [essay];
    const { container } = render(<EssayGradingPanel assignmentId="asg-1" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('assessment results with the flag off', () => {
  it('mounts no essay panel, so it needs no query client or permissions provider', async () => {
    mocks.v2 = false;
    mocks.essays = [{ questionId: '33333333-3333-4333-8333-333333333333', prompt: 'Explain A', answer: 'x', maxPoints: 2 }];
    const { AssessmentResults } = await import(
      '../../apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results'
    );
    render(
      <AssessmentResults
        assignments={[
          {
            id: 'a1',
            status: 'completed',
            assignedAt: new Date(),
            completedAt: new Date(),
            assessmentType: { id: 't1', name: 'Quiz', code: 'quiz' },
            result: { id: 'r1', normalizedScore: 80 },
          },
        ]}
        fitScores={[]}
      />,
    );
    expect(screen.queryByTestId('essay-grading-panel')).toBeNull();
    mocks.v2 = true;
  });
});

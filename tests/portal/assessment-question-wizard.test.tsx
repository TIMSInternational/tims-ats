import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { writeDraft } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage';

const mutateSubmit = vi.fn();
const invalidate = vi.fn();
let submitOnSuccess: (() => void) | undefined;
let submitOnError: ((error: { message: string }) => void) | undefined;

const defaultQuestions = [
  {
    id: 'q1',
    order: 0,
    type: 'single_choice',
    prompt: 'Q1?',
    points: 1,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  },
  { id: 'q2', order: 1, type: 'free_text', prompt: 'Q2?', points: 5, options: [] },
];
let questionsQueryData: unknown[] = defaultQuestions;

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidatePortal: { getMyAssessments: { invalidate } } }),
    candidatePortal: {
      getAssessmentQuestions: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: questionsQueryData,
        }),
      },
      submitAssessment: {
        useMutation: (opts: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => {
          submitOnSuccess = opts.onSuccess;
          submitOnError = opts.onError;
          return { mutate: mutateSubmit, isPending: false };
        },
      },
    },
  },
}));

import { AssessmentQuestionWizard } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-wizard';

function renderWizard(overrides: Partial<React.ComponentProps<typeof AssessmentQuestionWizard>> = {}) {
  // Set locale to EN for this test (matches the pattern used by every sibling
  // component test in this directory — I18nProvider defaults to ES otherwise).
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentQuestionWizard
        orgSlug="tims"
        assignmentId="a1"
        startedAt={new Date()}
        expiresAt={null}
        durationMinutes={null}
        onSubmitted={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe('AssessmentQuestionWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mutateSubmit.mockClear();
    invalidate.mockClear();
    questionsQueryData = defaultQuestions;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('renders a friendly message instead of crashing when getAssessmentQuestions returns []', () => {
    questionsQueryData = [];
    expect(() => renderWizard()).not.toThrow();
    expect(screen.getByText(en.assessmentPlayer.loadError)).toBeInTheDocument();
  });

  it('drops a stale draft answer for a question no longer in the fetched set before submitting', () => {
    // Seed a draft with an extra answer for a questionId that isn't part of the
    // currently-fetched question set (e.g. deactivated between draft-write and submit).
    writeDraft('a1', {
      q1: { selectedOptionIds: ['a'] },
      q2: { freeText: 'my answer' },
      stale_q: { freeText: 'orphaned answer' },
    });
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    const payload = mutateSubmit.mock.calls[0][0];
    expect(payload.answers.map((a: { questionId: string }) => a.questionId).sort()).toEqual(['q1', 'q2']);
    expect(payload.answers.some((a: { questionId: string }) => a.questionId === 'stale_q')).toBe(false);
  });

  it('Back/Next navigate between questions without ever calling the server', () => {
    renderWizard();
    expect(screen.getByText('Q1?')).toBeInTheDocument();
    fireEvent.click(
      screen.queryByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit, hidden: true }) ??
        screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }),
    );
    expect(screen.getByText('Q2?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardBack }));
    expect(screen.getByText('Q1?')).toBeInTheDocument();
    expect(mutateSubmit).not.toHaveBeenCalled();
  });

  it('persists a draft to localStorage on answer change and it survives a remount', () => {
    const { unmount } = renderWizard();
    fireEvent.click(screen.getByText('A'));
    unmount();
    renderWizard();
    const optionA = screen.getByText('A').previousElementSibling as HTMLInputElement;
    expect(optionA.checked).toBe(true);
  });

  it('auto-submits with no confirmation step when the timer reaches 0:00', () => {
    renderWizard({ durationMinutes: 1 });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(mutateSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(en.assessmentPlayer.submitConfirmTitle)).not.toBeInTheDocument();
  });

  it('never includes a client-computed score/isCorrect in the submitAssessment payload', () => {
    renderWizard();
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.change(screen.getByPlaceholderText(en.assessmentPlayer.questionCardFreeTextPlaceholder), {
      target: { value: 'my answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    const payload = mutateSubmit.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(['orgSlug', 'assignmentId', 'answers']);
    for (const answer of payload.answers) {
      expect(Object.keys(answer).sort()).toEqual(['freeText', 'questionId', 'selectedOptionIds'].sort());
    }
  });

  it('renders a translated error message from a mutation failure', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    act(() => submitOnError?.({ message: 'assignment_expired' }));
    expect(screen.getByText(en.assessmentPlayer.errorAssignmentExpired)).toBeInTheDocument();
  });

  it('re-fetches and calls onSubmitted (not an error) on assignment_already_completed', () => {
    const onSubmitted = vi.fn();
    renderWizard({ onSubmitted });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardNext }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.wizardReviewSubmit }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    act(() => submitOnError?.({ message: 'assignment_already_completed' }));
    expect(invalidate).toHaveBeenCalled();
    expect(onSubmitted).toHaveBeenCalled();
    expect(screen.queryByText(en.assessmentPlayer.errorGeneric)).not.toBeInTheDocument();
  });
});

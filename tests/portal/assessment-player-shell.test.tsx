import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

let assessmentsQueryData: unknown[] = [];
const invalidate = vi.fn();
const mutateStart = vi.fn();

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ candidatePortal: { getMyAssessments: { invalidate } } }),
    candidatePortal: {
      getMyAssessments: {
        useQuery: () => ({ isLoading: false, isError: false, data: assessmentsQueryData }),
      },
      startAssessment: {
        useMutation: (_opts: unknown) => ({ mutate: mutateStart, isPending: false }),
      },
    },
  },
}));
vi.mock(
  '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-question-wizard',
  () => ({ AssessmentQuestionWizard: () => <div>wizard-stub</div> }),
);

import { AssessmentPlayerShell } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-player-shell';

function renderShell() {
  // Set locale to EN for this test (matches the pattern used by every sibling
  // component test in this directory — I18nProvider defaults to ES otherwise).
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentPlayerShell orgSlug="tims" assignmentId="a1" />
    </I18nProvider>,
  );
}

describe('AssessmentPlayerShell', () => {
  beforeEach(() => {
    mutateStart.mockClear();
    invalidate.mockClear();
  });

  it('renders a not-found message when assignmentId matches nothing in the list', () => {
    assessmentsQueryData = [{ id: 'other', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notFound)).toBeInTheDocument();
  });

  it('renders the consent gate for status=assigned', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'assigned', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.consentTitle)).toBeInTheDocument();
  });

  it('renders the question wizard for status=in_progress', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'in_progress',
        startedAt: new Date(),
        expiresAt: null,
        assessmentType: { duration: null },
        result: null,
      },
    ];
    renderShell();
    expect(screen.getByText('wizard-stub')).toBeInTheDocument();
  });

  it('renders the result screen for status=completed, using the list item result directly (no extra fetch)', () => {
    assessmentsQueryData = [
      { id: 'a1', status: 'completed', result: { normalizedScore: 90, percentile: 80, hasPending: false } },
    ];
    renderShell();
    expect(screen.getByText(/90%/)).toBeInTheDocument();
  });

  it('renders a plain cancelled message for status=cancelled', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'cancelled', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.cancelled)).toBeInTheDocument();
  });

  it('renders a fallback message (not the consent gate) for an unrecognized status like pending', () => {
    assessmentsQueryData = [{ id: 'a1', status: 'pending', result: null }];
    renderShell();
    expect(screen.getByText(en.assessmentPlayer.notStartable)).toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.consentTitle)).not.toBeInTheDocument();
  });
});

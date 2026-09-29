import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewDetail } from '../../apps/web/lib/trpc-types';

// ---------------------------------------------------------------------------
// F4 — the room's "Submit scorecard" button had no onClick, competencies were a
// hardcoded list, stars were non-focusable SVGs and the evaluator comparison
// was fabricated. These tests pin the real wiring to interview.submitScorecard.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  jobProfile: { isLoading: false, isError: false, data: null as unknown },
  existing: { isLoading: false, isError: false, data: null as unknown, refetch: () => undefined },
  mutation: { mutate: (_: unknown) => undefined, isPending: false, isError: false, error: null as unknown },
  mutationOpts: null as null | { onSuccess: () => void; onError: (err: unknown) => void },
  invalidate: {
    getScorecard: (_?: unknown) => undefined,
    getById: (_?: unknown) => undefined,
    getPending: () => undefined,
  },
  toast: (_m: string, _o?: unknown) => undefined,
}));

const mutate = vi.fn();
const toastSpy = vi.fn();
const invScorecard = vi.fn();
const invById = vi.fn();
const invPending = vi.fn();

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      interview: {
        getScorecard: { invalidate: (a: unknown) => h.invalidate.getScorecard(a) },
        getById: { invalidate: (a: unknown) => h.invalidate.getById(a) },
        getPendingScorecards: { invalidate: () => h.invalidate.getPending() },
      },
    }),
    vacancy: { getJobProfile: { useQuery: () => h.jobProfile } },
    interview: {
      getScorecard: { useQuery: () => h.existing },
      submitScorecard: {
        useMutation: (opts: { onSuccess: () => void; onError: (err: unknown) => void }) => {
          h.mutationOpts = opts;
          return h.mutation;
        },
      },
    },
  },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (m: string, o?: unknown) => h.toast(m, o) }));
vi.mock('../../apps/web/components', () => ({ Skeleton: () => <div data-testid="skeleton" /> }));
vi.mock('../../apps/web/lib/permissions', () => ({ usePermissions: () => ({ userId: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-ai-panel', () => ({
  InterviewAiPanel: () => <div>ai-stub</div>,
}));

import { ScorecardForm } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-form';
import { ScorecardPanel } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-panel';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INTERVIEW_ID = '33333333-3333-4333-8333-333333333333';

function interview(overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: INTERVIEW_ID,
    type: 'video',
    scheduledAt: new Date('2026-09-30T15:00:00Z'),
    duration: 45,
    candidate: { id: 'c1', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: null, avatar: null },
    vacancy: { id: 'v1', title: 'Analista' },
    evaluators: [
      {
        id: 'e1',
        userId: ME,
        role: 'evaluator',
        status: 'pending',
        user: { id: ME, firstName: 'Yo', lastName: 'Mismo', avatar: null },
      },
      {
        id: 'e2',
        userId: OTHER,
        role: 'evaluator',
        status: 'pending',
        user: { id: OTHER, firstName: 'Otra', lastName: 'Persona', avatar: null },
      },
    ],
    scorecards: [],
    ...overrides,
  } as unknown as InterviewDetail;
}

function renderForm(props: { interview?: InterviewDetail; currentUserId?: string | null } = {}) {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <ScorecardForm
        interview={props.interview ?? interview()}
        currentUserId={props.currentUserId === undefined ? ME : props.currentUserId}
      />
    </I18nProvider>,
  );
}

const submitButton = () =>
  screen.getByRole('button', {
    name: new RegExp(`^(${en.interviewRoom.submit}|${en.interviewRoom.update}|${en.interviewRoom.submitting})$`),
  });

beforeEach(() => {
  mutate.mockReset();
  toastSpy.mockReset();
  invScorecard.mockReset();
  invById.mockReset();
  invPending.mockReset();
  h.jobProfile = {
    isLoading: false,
    isError: false,
    data: {
      competencies: [
        { name: 'SQL', level: 4 },
        { name: 'Storytelling', level: 3 },
      ],
    },
  };
  h.existing = { isLoading: false, isError: false, data: null, refetch: () => undefined };
  h.mutation = { mutate, isPending: false, isError: false, error: null };
  h.mutationOpts = null;
  h.invalidate = { getScorecard: invScorecard, getById: invById, getPending: invPending };
  h.toast = toastSpy;
});

describe('interview room scorecard', () => {
  it("uses the vacancy job profile's competencies and labels their source", () => {
    renderForm();
    expect(screen.getByRole('radiogroup', { name: 'SQL' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Storytelling' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: en.interviewRoom.defaultCompetencyLeadership })).toBeNull();
    expect(screen.getByTestId('competency-source')).toHaveTextContent(en.interviewRoom.competenciesSourceVacancy);
    expect(screen.getByText(en.interviewRoom.targetLevel.replace('{n}', '4'))).toBeInTheDocument();
  });

  it('falls back to the generic list only when the profile has none, and says so', () => {
    h.jobProfile = { isLoading: false, isError: false, data: { competencies: {} } };
    renderForm();
    expect(screen.getAllByRole('radiogroup')).toHaveLength(4);
    expect(screen.getByRole('radiogroup', { name: en.interviewRoom.defaultCompetencyLeadership })).toBeInTheDocument();
    expect(screen.getByTestId('competency-source')).toHaveTextContent(en.interviewRoom.competenciesSourceDefault);
  });

  it('labels the fallback differently when the job profile could not be read', () => {
    h.jobProfile = { isLoading: false, isError: true, data: undefined };
    renderForm();
    expect(screen.getByTestId('competency-source')).toHaveTextContent(en.interviewRoom.competenciesSourceUnavailable);
  });

  it('keeps submit disabled until every competency is rated and a recommendation is chosen, then submits the real payload', () => {
    renderForm();
    const button = submitButton();
    expect(button).toBeDisabled();
    expect(screen.getByText(en.interviewRoom.hintIncomplete)).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'SQL' })).getByRole('radio', { name: '4 of 5' }));
    expect(button).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Storytelling' })).getByRole('radio', { name: '2 of 5' }),
    );
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: en.interviewRoom.recYes }));
    fireEvent.change(screen.getByPlaceholderText(en.interviewRoom.overallNotesPlaceholder), {
      target: { value: '  Solid SQL  ' },
    });

    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      ratings: { SQL: 4, Storytelling: 2 },
      recommendation: 'yes',
      overallNotes: 'Solid SQL',
    });
  });

  it('rates with the keyboard: stars are focusable radios with a roving tab stop', () => {
    renderForm();
    const group = screen.getByRole('radiogroup', { name: 'SQL' });
    const stars = within(group).getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(stars.map((s) => s.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    stars[0].focus();
    fireEvent.keyDown(stars[0], { key: 'ArrowRight' });
    expect(stars[1]).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(stars[1]);
    fireEvent.keyDown(stars[1], { key: 'End' });
    expect(stars[4]).toHaveAttribute('aria-checked', 'true');
    expect(stars.map((s) => s.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
    fireEvent.keyDown(stars[4], { key: 'ArrowLeft' });
    expect(stars[3]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(stars[3], { key: 'Home' });
    expect(stars[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('re-opening shows the submitted scorecard and offers an update', () => {
    h.existing = {
      isLoading: false,
      isError: false,
      refetch: () => undefined,
      data: {
        id: 'sc1',
        ratings: { SQL: 5, Storytelling: 3 },
        recommendation: 'strong_yes',
        overallNotes: 'Great',
        submittedAt: new Date('2026-09-29T10:00:00Z'),
      },
    };
    renderForm();
    expect(
      within(screen.getByRole('radiogroup', { name: 'SQL' })).getByRole('radio', { name: '5 of 5' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: en.interviewRoom.recStrongYes })).toBeChecked();
    expect(screen.getByDisplayValue('Great')).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent(en.interviewRoom.update);
    expect(submitButton()).toBeEnabled();
  });

  it('blocks submission for a viewer who is not an assigned evaluator', () => {
    renderForm({ currentUserId: '99999999-9999-4999-8999-999999999999' });
    expect(screen.getByText(en.interviewRoom.notEvaluator)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('shows the pending state while the mutation runs', () => {
    h.mutation = { mutate, isPending: true, isError: false, error: null };
    renderForm();
    expect(submitButton()).toHaveTextContent(en.interviewRoom.submitting);
    expect(submitButton()).toBeDisabled();
  });

  it('on success toasts and invalidates the scorecard, interview and pending-scorecard queries', () => {
    renderForm();
    h.mutationOpts?.onSuccess();
    expect(toastSpy).toHaveBeenCalledWith(en.interviewRoom.submitSuccess, { type: 'success' });
    expect(invScorecard).toHaveBeenCalledWith({ interviewId: INTERVIEW_ID });
    expect(invById).toHaveBeenCalledWith({ id: INTERVIEW_ID });
    expect(invPending).toHaveBeenCalled();
  });

  it('on error toasts a category message and renders an inline alert', () => {
    h.mutation = { mutate, isPending: false, isError: true, error: { data: { code: 'FORBIDDEN' } } };
    renderForm();
    h.mutationOpts?.onError({ data: { code: 'FORBIDDEN' } });
    expect(toastSpy).toHaveBeenCalledWith(en.interviewRoom.submitForbidden, { type: 'error' });
    h.mutationOpts?.onError({ data: { code: 'INTERNAL_SERVER_ERROR' } });
    expect(toastSpy).toHaveBeenLastCalledWith(en.interviewRoom.submitError, { type: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent(en.interviewRoom.submitForbidden);
  });

  it("hides other evaluators' scores until the viewer has submitted, and never shows invented evaluators", () => {
    const scorecards = [
      { id: 'x', evaluatorId: OTHER, ratings: { SQL: 2 }, recommendation: 'no', submittedAt: new Date() },
    ];
    renderForm({ interview: interview({ scorecards } as unknown as Partial<InterviewDetail>) });
    const section = screen.getByRole('region', { name: en.interviews.evaluatorComparison });
    expect(section).toHaveTextContent('Otra Persona');
    expect(section).toHaveTextContent(en.interviewRoom.comparisonSubmitted);
    expect(section).not.toHaveTextContent('2.0');
    expect(section).not.toHaveTextContent('Evaluador 1');
    expect(section).not.toHaveTextContent('4.2');
  });

  it('the room panel submit button is wired end to end (it used to have no onClick)', () => {
    localStorage.setItem('tims-locale', 'EN');
    const props = { interview: interview(), candidateInitials: 'AR', candidateName: 'Ana Ruiz', interviewId: INTERVIEW_ID, vacancyTitle: 'Analista' };
    render(
      <I18nProvider>
        <ScorecardPanel {...props} />
      </I18nProvider>,
    );
    for (const name of ['SQL', 'Storytelling']) {
      fireEvent.click(within(screen.getByRole('radiogroup', { name })).getByRole('radio', { name: '3 of 5' }));
    }
    fireEvent.click(screen.getByRole('radio', { name: en.interviewRoom.recNeutral }));
    fireEvent.click(screen.getByRole('button', { name: /submit scorecard|enviar scorecard/i }));
    expect(mutate).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      ratings: { SQL: 3, Storytelling: 3 },
      recommendation: 'neutral',
      overallNotes: undefined,
    });
    expect(screen.queryByRole('tab', { name: /notas|notes/i })).toBeNull();
  });
});

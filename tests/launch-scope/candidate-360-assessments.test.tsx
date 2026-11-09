import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { TABS, visibleCandidateTabs } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-tabs';

// Codex P2 on #398: under the pilot launch scope, Candidate 360 must not offer assessment assignment (the
// candidate portal no longer lists assessments, so an assignment would be unreachable for the candidate).

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({ [name]: () => null }),
}));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidate: {
      getById: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: {
            id: 'c1',
            firstName: 'Ana',
            lastName: 'Mora',
            applications: [{ id: 'a1', status: 'active', vacancy: { id: 'v1', title: 'Analista' } }],
            assessmentAssignments: [{ id: 'as1' }],
            fitScores: [],
          },
        }),
      },
      getTimeline: { useQuery: () => ({ isLoading: false, isError: false, data: [] }) },
    },
  },
}));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-header', () => stub('CandidateHeader'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/profile-tab', () => ({
  ...stub('ApplicationsCard'),
  ...stub('PersonalInfoCard'),
  ...stub('ProfileTab'),
}));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results', async () => {
  const { createElement } = await import('react');
  return { AssessmentResults: () => createElement('div', { 'data-testid': 'AssessmentResults' }) };
});
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/fit-breakdown', () => stub('FitBreakdown'));
// FIT v2's C# fit-scores read (a react-query hook) is off with the flag off: the page keeps candidate.getById's rows.
vi.mock('../../apps/web/lib/platform-api/fit-engine-reads', () => ({
  useCandidateFitScoresViaCsharp: () => ({ data: undefined }),
  withCandidatePageFitScores: <T,>(candidate: T) => candidate,
}));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/stage-timeline', () => stub('StageTimeline'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/documents-card', () => stub('DocumentsCard'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/tags-card', () => stub('TagsCard'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-timeline', () => stub('CandidateTimeline'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/risk-flags', () => stub('RiskFlags'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/cv-parse-card', () => stub('CvParseCard'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/screen-candidate-card', () =>
  stub('ScreenCandidateCard'),
);
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/assign-assessment-modal', () =>
  stub('AssignAssessmentModal'),
);
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/consent-card', () => stub('CandidateConsentCard'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-offers-card', () => stub('CandidateOffersCard'));
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-interviews-tab', () =>
  stub('CandidateInterviewsTab'),
);
vi.mock('../../apps/web/app/(admin)/recruitment/candidates/[id]/notes-panel', () => stub('CandidateNotesPanel'));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderPage() {
  const { default: Page } = await import('../../apps/web/app/(admin)/recruitment/candidates/[id]/page');
  await act(async () => {
    render(<Page params={Promise.resolve({ id: 'c1' })} />);
  });
}

describe('Candidate 360 assessments under the pilot scope', () => {
  it('visibleCandidateTabs drops the assessments tab under pilot (and the always-empty Validaciones everywhere)', () => {
    // journeys-27: "Validaciones" has no content yet, so it is not offered as a tab that always opens empty.
    expect(visibleCandidateTabs(true)).toEqual(TABS.filter((tab) => tab !== 'tabAssessments' && tab !== 'tabValidations'));
    expect(visibleCandidateTabs(false)).toEqual(TABS.filter((tab) => tab !== 'tabValidations'));
  });

  it('pilot: no assign button, no assessments tab, no results block', async () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    await renderPage();
    expect(screen.queryByText(en.assessments.assignAssessment)).toBeNull();
    expect(screen.queryByText(en.candidates.tabAssessments)).toBeNull();
    expect(screen.queryByTestId('AssessmentResults')).toBeNull();
  });

  it('full scope: the assign button and assessments tab are still there', async () => {
    await renderPage();
    expect(screen.getByText(en.assessments.assignAssessment)).toBeTruthy();
    expect(screen.getByText(en.candidates.tabAssessments)).toBeTruthy();
    expect(screen.getByTestId('AssessmentResults')).toBeTruthy();
  });
});

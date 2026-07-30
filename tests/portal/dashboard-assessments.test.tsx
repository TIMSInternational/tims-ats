import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

let assessmentsQueryData: unknown[] = [];
let queryState = { isLoading: false, isError: false };

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidatePortal: {
      getMyAssessments: {
        useQuery: () => ({ ...queryState, data: assessmentsQueryData }),
      },
    },
  },
}));

import { DashboardAssessments } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-assessments';

function renderSection() {
  // Matches the pattern used by every sibling component test — I18nProvider
  // defaults to ES otherwise.
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <DashboardAssessments orgSlug="tims" />
    </I18nProvider>,
  );
}

describe('DashboardAssessments', () => {
  beforeEach(() => {
    assessmentsQueryData = [];
    queryState = { isLoading: false, isError: false };
  });

  it('shows the loading message', () => {
    queryState = { isLoading: true, isError: false };
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessLoading)).toBeInTheDocument();
  });

  it('shows the error message', () => {
    queryState = { isLoading: false, isError: true };
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessError)).toBeInTheDocument();
  });

  it('shows the empty message when there are no assignments', () => {
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessEmpty)).toBeInTheDocument();
  });

  it('shows a Start link into the player for an assigned, unexpired assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'assigned',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    const link = screen.getByRole('link', { name: en.portalDashboard.assessStart });
    expect(link).toHaveAttribute('href', '/careers/tims/dashboard/assessments/a1');
  });

  it('shows a Continue link for an in_progress, unexpired assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'in_progress',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByRole('link', { name: en.portalDashboard.assessContinue })).toBeInTheDocument();
  });

  it('shows an Expired badge and no action link for an assigned assignment past its expiresAt', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'assigned',
        expiresAt: new Date(Date.now() - 1000),
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessStatusExpired)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the score for a completed assignment with no pending review', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'completed',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: { normalizedScore: 85, percentile: null, hasPending: false },
      },
    ];
    renderSection();
    expect(screen.getByText(`${en.portalDashboard.assessScoreLabel}: 85`)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the pending-review notice for a completed assignment with essays still unscored', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'completed',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: { normalizedScore: 40, percentile: null, hasPending: true },
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessPendingNotice)).toBeInTheDocument();
  });

  it('shows the Cancelled badge and no action link for a cancelled assignment', () => {
    assessmentsQueryData = [
      {
        id: 'a1',
        status: 'cancelled',
        expiresAt: null,
        assessmentType: { name: 'Logic Test', duration: 30 },
        result: null,
      },
    ];
    renderSection();
    expect(screen.getByText(en.portalDashboard.assessStatusCancelled)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

const fetchNextPage = vi.fn();
let queryResult: {
  isLoading: boolean;
  isError: boolean;
  data?: unknown;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: typeof fetchNextPage;
};
let capabilityEnabled = true;
let canRead = true;

vi.mock('../../apps/web/lib/proctoring/staff-access', () => ({
  useProctoringStaffAccess: () => ({ canRead, canWrite: false, isLoading: false }),
}));

vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useProctoringCapability: () => ({ isLoading: false, data: { enabled: capabilityEnabled } }),
}));

vi.mock('../../apps/web/lib/platform-api/proctoring-staff', () => ({
  useProctoringReviewQueue: () => queryResult,
}));

import ProctoringReviewQueuePage from '../../apps/web/app/(admin)/recruitment/assessments/proctoring/page';

function renderQueue() {
  localStorage.setItem('tims-locale', 'EN');
  return render(<I18nProvider><ProctoringReviewQueuePage /></I18nProvider>);
}

describe('proctoring review queue', () => {
  beforeEach(() => {
    fetchNextPage.mockClear();
    capabilityEnabled = true;
    canRead = true;
    queryResult = { isLoading: false, isError: false };
  });

  it('shows an empty state when no completed sessions need review', () => {
    renderQueue();
    expect(screen.getByText(en.proctoring.queue.empty)).toBeInTheDocument();
  });

  it('links staff to a candidate record without declaring misconduct', () => {
    queryResult = {
      isLoading: false,
      isError: false,
      data: { pages: [{ items: [{
        sessionId: 'session-1',
        assignmentId: 'assignment-1',
        candidate: { id: 'candidate-1', firstName: 'Ada', lastName: 'Lovelace' },
        assessmentType: { name: 'Reasoning' },
        flagCount: 2,
        reviewStatus: 'unreviewed',
        status: 'completed',
        endedAt: '2026-09-24T12:00:00.000Z',
      }] }] },
    };
    renderQueue();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(`${en.proctoring.queue.status}: ${en.proctoring.review.status.unreviewed}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.proctoring.queue.openCandidate })).toHaveAttribute(
      'href', '/recruitment/candidates/candidate-1',
    );
  });

  it('loads another bounded page when the API has more sessions', () => {
    queryResult = { isLoading: false, isError: false, data: { pages: [{ items: [] }] },
      hasNextPage: true, isFetchingNextPage: false, fetchNextPage };
    renderQueue();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.queue.loadMore }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('does not show the review queue when the C# feature is disabled', () => {
    capabilityEnabled = false;
    renderQueue();
    expect(screen.getByText(en.proctoring.queue.serviceUnavailable)).toBeInTheDocument();
    expect(screen.queryByText(en.proctoring.queue.empty)).not.toBeInTheDocument();
  });

  it('marks an interrupted but resumable assessment for attention', () => {
    queryResult = { isLoading: false, isError: false, data: { pages: [{ items: [{
      sessionId: 'session-2', assignmentId: 'assignment-2',
      candidate: { id: 'candidate-2', firstName: 'Alan', lastName: 'Turing' },
      assessmentType: { name: 'Reasoning' }, flagCount: 0,
      reviewStatus: 'unreviewed', status: 'needs_attention', endedAt: null,
    }] }] } };
    renderQueue();
    expect(screen.getByText(en.proctoring.queue.needsAttention)).toBeInTheDocument();
  });

  it('does not expose the queue to an unauthorized role', () => {
    canRead = false;
    renderQueue();
    expect(screen.getByRole('alert')).toHaveTextContent(en.accessDenied.message);
    expect(screen.queryByText(en.proctoring.queue.empty)).not.toBeInTheDocument();
  });
});

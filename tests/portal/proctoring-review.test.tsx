import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';

const mutateReview = vi.fn();
const fetchNextPage = vi.fn();
let queryResult: {
  isLoading: boolean;
  isError: boolean;
  error?: Error;
  data?: unknown;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: typeof fetchNextPage;
};
let capabilityEnabled = true;
let canRead = true;
let canWrite = true;

vi.mock('../../apps/web/lib/proctoring/staff-access', () => ({
  useProctoringStaffAccess: () => ({ canRead, canWrite, isLoading: false }),
}));

vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useProctoringCapability: () => ({ isLoading: false, data: { enabled: capabilityEnabled } }),
}));

vi.mock('../../apps/web/lib/platform-api/proctoring-staff', () => ({
  useProctoringEvidence: () => queryResult,
  useReviewProctoring: () => ({ mutate: mutateReview, isPending: false, isError: false }),
}));

import { ProctoringReview } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/proctoring-review';

function renderPanel() {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <ProctoringReview assignmentId="11111111-1111-4111-8111-111111111111" />
    </I18nProvider>,
  );
}

describe('staff proctoring review', () => {
  beforeEach(() => {
    mutateReview.mockClear();
    fetchNextPage.mockClear();
    capabilityEnabled = true;
    canRead = true;
    canWrite = true;
    queryResult = { isLoading: false, isError: false };
  });

  it('does not load session details before the reviewer opens the panel', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: en.proctoring.review.title })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(en.proctoring.review.signalsOnly)).not.toBeInTheDocument();
  });

  it('shows observations as review cues and requires an explicit human decision', () => {
    queryResult = {
      isLoading: false,
      isError: false,
      data: {
        pages: [
          {
            flagCount: 1,
            startedAt: '2026-09-24T11:50:00.000Z',
            endedAt: '2026-09-24T12:10:00.000Z',
            review: { status: 'unreviewed', notes: null, reviewedAt: null },
            events: [
              {
                id: 'event-1',
                type: 'multiple_faces',
                occurredAt: '2026-09-24T12:00:00.000Z',
              },
            ],
          },
        ],
      },
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    expect(screen.getByText(en.proctoring.review.signalsOnly)).toBeInTheDocument();
    expect(screen.getByText(en.proctoring.review.eventType.multiple_faces)).toBeInTheDocument();
    expect(mutateReview).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: en.proctoring.review.title }), {
      target: { value: 'concern' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: en.proctoring.review.notes }), {
      target: { value: 'Please review the session context.' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.save }));
    expect(mutateReview).toHaveBeenCalledWith({
      assignmentId: '11111111-1111-4111-8111-111111111111',
      status: 'concern',
      notes: 'Please review the session context.',
    });
  });

  it('distinguishes no proctoring session from an unexpected load failure', () => {
    queryResult = { isLoading: false, isError: true, error: new PlatformApiError(404, 'Not Found') };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    expect(screen.getByRole('status')).toHaveTextContent(en.proctoring.review.noSession);
  });

  it('lets reviewers load older signals instead of silently truncating the timeline', () => {
    queryResult = {
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
      data: { pages: [{ flagCount: 101, startedAt: '2026-09-24T11:50:00Z', endedAt: null,
        review: { status: 'unreviewed', notes: null, reviewedAt: null }, events: [] }] },
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.loadMore }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('prevents a decision while the assessment session is active', () => {
    queryResult = {
      isLoading: false,
      isError: false,
      data: { pages: [{ status: 'active', flagCount: 0, startedAt: '2026-09-24T11:50:00Z',
        endedAt: null, review: { status: 'unreviewed', notes: null, reviewedAt: null }, events: [] }] },
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    expect(screen.getByText(en.proctoring.review.activeSession)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.proctoring.review.save })).not.toBeInTheDocument();
  });

  it('shows disabled service status instead of requesting evidence', () => {
    capabilityEnabled = false;
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    expect(screen.getByText(en.proctoring.review.serviceUnavailable)).toBeInTheDocument();
  });

  it('shows evidence without review controls to read-only HR staff', () => {
    canWrite = false;
    queryResult = { isLoading: false, isError: false, data: { pages: [{ status: 'completed',
      flagCount: 0, startedAt: '2026-09-24T11:50:00Z', endedAt: '2026-09-24T12:00:00Z',
      review: { status: 'unreviewed', notes: null, reviewedAt: null }, events: [] }] } };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.title }));
    expect(screen.getByText(en.proctoring.review.signalsOnly)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.proctoring.review.save })).not.toBeInTheDocument();
  });

  it('hides sensitive evidence controls from an unauthorized role', () => {
    canRead = false;
    renderPanel();
    expect(screen.queryByRole('button', { name: en.proctoring.review.title })).not.toBeInTheDocument();
  });
});

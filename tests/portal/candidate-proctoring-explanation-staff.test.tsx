import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

const useExplanation = vi.fn();
vi.mock('../../apps/web/lib/platform-api/proctoring-staff', () => ({
  useStaffCandidateExplanation: () => useExplanation(),
}));

import { CandidateProctoringExplanation } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/candidate-proctoring-explanation';

function renderPanel() {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <CandidateProctoringExplanation assignmentId="00000000-0000-4000-8000-000000000001" />
    </I18nProvider>,
  );
}

describe('candidate statement in staff proctoring review', () => {
  beforeEach(() => useExplanation.mockReset());

  it('labels a submitted statement as the candidate account and renders it as plain text', () => {
    useExplanation.mockReturnValue({
      isLoading: false, isError: false, isSuccess: true,
      data: {
        id: '00000000-0000-4000-8000-000000000002',
        text: '<img src=x onerror=alert(1)>\nThe camera disconnected.',
        submittedAt: '2026-09-24T10:00:00Z',
        expiresAt: '2026-10-01T10:00:00Z',
      },
    });
    renderPanel();
    expect(screen.getByText(en.proctoring.review.candidateExplanation.context)).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert/)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('distinguishes no statement from an unavailable read', () => {
    useExplanation.mockReturnValue({ isLoading: false, isError: false, isSuccess: true, data: null });
    const view = renderPanel();
    expect(screen.getByText(en.proctoring.review.candidateExplanation.none)).toBeInTheDocument();
    view.unmount();
    useExplanation.mockReturnValue({ isLoading: false, isError: true, isSuccess: false, data: undefined });
    renderPanel();
    expect(screen.getByText(en.proctoring.review.candidateExplanation.loadError)).toBeInTheDocument();
  });
});

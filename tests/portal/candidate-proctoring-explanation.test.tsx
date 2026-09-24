import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

const mutate = vi.fn();
let explanationState: {
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  data?: { explanation: { id: string; text: string; submittedAt: string; expiresAt: string } | null;
    canSubmit: boolean; closesAt: string | null };
  refetch?: () => void;
};
let submitState: { mutate: typeof mutate; isPending: boolean; isError: boolean; data?: {
  id: string; text: string; submittedAt: string; expiresAt: string;
} };

vi.mock('../../apps/web/lib/platform-api/client', () => ({
  isPlatformApiEnabled: () => true,
  PlatformApiError: class extends Error { status = 409; },
}));
vi.mock('../../apps/web/lib/platform-api/proctoring', () => ({
  useCandidateProctoringExplanation: () => explanationState,
  useSubmitCandidateProctoringExplanation: () => submitState,
}));

import { CandidateProctoringExplanation } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/candidate-proctoring-explanation';

function renderStatement() {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <CandidateProctoringExplanation orgSlug="tims" assignmentId="00000000-0000-4000-8000-000000000001" />
    </I18nProvider>,
  );
}

describe('candidate statement after proctored assessment', () => {
  beforeEach(() => {
    mutate.mockReset();
    explanationState = { isLoading: false, isError: false, isSuccess: true, data: {
      explanation: null, canSubmit: true, closesAt: '2026-10-01T10:00:00Z',
    } };
    submitState = { mutate, isPending: false, isError: false };
  });

  it('reuses the submission UUID on retry and keeps candidate text in the form', () => {
    renderStatement();
    const input = screen.getByRole('textbox', { name: en.proctoring.candidate.explanation.label });
    fireEvent.change(input, { target: { value: '  My camera disconnected.  ' } });
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.explanation.submit }));
    fireEvent.click(screen.getByRole('button', { name: en.proctoring.candidate.explanation.submit }));
    expect(mutate).toHaveBeenCalledTimes(2);
    const first = mutate.mock.calls[0]?.[0];
    const second = mutate.mock.calls[1]?.[0];
    expect(first.submissionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second.submissionId).toBe(first.submissionId);
    expect(first.text).toBe('My camera disconnected.');
    expect(input).toHaveValue('  My camera disconnected.  ');
  });

  it('shows a saved statement as immutable and does not render the form', () => {
    explanationState.data = { explanation: {
      id: '00000000-0000-4000-8000-000000000002', text: 'Screen sharing stopped.',
      submittedAt: '2026-09-24T10:00:00Z', expiresAt: '2026-10-01T10:00:00Z',
    }, canSubmit: false, closesAt: '2026-10-01T10:00:00Z' };
    renderStatement();
    expect(screen.getByText('Screen sharing stopped.')).toBeInTheDocument();
    expect(screen.getByText(en.proctoring.candidate.explanation.submitted)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows an expired or reviewed window without accepting a statement', () => {
    explanationState.data = { explanation: null, canSubmit: false, closesAt: '2026-09-24T10:00:00Z' };
    renderStatement();
    expect(screen.getByRole('status')).toHaveTextContent(en.proctoring.candidate.explanation.closed);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

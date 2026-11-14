import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentSubmitConfirm } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-submit-confirm';

function renderConfirm(props: Partial<React.ComponentProps<typeof AssessmentSubmitConfirm>> = {}) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentSubmitConfirm
        unansweredOrders={[]}
        isSubmitting={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );
}

describe('AssessmentSubmitConfirm', () => {
  // Each unanswered question is named ("Question 3") and, with onJumpTo, is a button back to it.
  it('lists unanswered question numbers when there are any', () => {
    renderConfirm({ unansweredOrders: [3, 7] });
    expect(screen.getByText('Question 3')).toBeInTheDocument();
    expect(screen.getByText('Question 7')).toBeInTheDocument();
  });

  it('jumps to an unanswered question from its link', () => {
    const onJumpTo = vi.fn();
    renderConfirm({ unansweredOrders: [3, 7], onJumpTo });
    fireEvent.click(screen.getByRole('button', { name: 'Question 7' }));
    expect(onJumpTo).toHaveBeenCalledWith(7);
  });

  it('is a labelled modal dialog that Escape cancels', () => {
    const onCancel = vi.fn();
    renderConfirm({ onCancel });
    const dialog = screen.getByRole('dialog', { name: en.assessmentPlayer.submitConfirmTitle });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders no unanswered-question notice when everything is answered', () => {
    renderConfirm({ unansweredOrders: [] });
    expect(screen.queryByText(en.assessmentPlayer.submitConfirmUnansweredPrefix)).not.toBeInTheDocument();
  });

  it('calls onConfirm on the submit button and onCancel on the cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderConfirm({ onConfirm, onCancel });
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmConfirmButton }));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmCancelButton }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and shows the submitting label while isSubmitting', () => {
    renderConfirm({ isSubmitting: true });
    expect(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmSubmitting })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.assessmentPlayer.submitConfirmCancelButton })).toBeDisabled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { CancelInterviewDialog } from '../../apps/web/app/(admin)/recruitment/interviews/cancel-interview-dialog';

// The footer "Keep interview" used to call onClose directly, so it discarded a typed cancel reason while
// X and Escape asked first. It now goes through the real Modal's dirty guard (DialogCancelButton).

describe('cancel-interview dialog — the footer button honours the dirty guard', () => {
  beforeEach(() => localStorage.setItem('tims-locale', 'EN'));

  it('asks before discarding a typed reason, like X and Escape', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <CancelInterviewDialog isPending={false} onConfirm={() => undefined} onClose={onClose} />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByLabelText(en.interviews.cancelReasonLabel), { target: { value: 'Conflict' } });
    fireEvent.click(screen.getByRole('button', { name: en.interviews.cancelDialogKeep }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(en.common.discardTitle)).toBeInTheDocument();
  });

  it('closes at once when nothing was typed', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <CancelInterviewDialog isPending={false} onConfirm={() => undefined} onClose={onClose} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.interviews.cancelDialogKeep }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

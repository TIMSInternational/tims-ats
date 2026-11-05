import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// C-11: the reject modal offers an opt-in (default off) neutral email, says plainly whether one goes out, and
// reports what happened. journeys-26: the same modal rejects a table selection in one go.

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  toast: vi.fn(),
  invalidate: vi.fn(() => Promise.resolve()),
  onSuccess: { current: null as null | ((data: unknown, vars: { applicationId: string }) => Promise<void>) },
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ pipeline: { getBoard: { invalidate: m.invalidate } }, candidate: { invalidate: m.invalidate } }),
    pipeline: {
      rejectCandidate: {
        useMutation: (opts?: { onSuccess?: (data: unknown, vars: { applicationId: string }) => Promise<void> }) => {
          if (opts?.onSuccess) m.onSuccess.current = opts.onSuccess;
          return { mutate: m.mutate, mutateAsync: m.mutateAsync, isPending: false };
        },
      },
    },
  },
}));

import { RejectCandidateModal } from '../../apps/web/app/(admin)/recruitment/pipeline/reject-candidate-modal';

const APP = { id: '11111111-1111-4111-8111-111111111111', vacancyTitle: 'Analista' };
const mm = es.rejectCandidateModal;

function pickReason() {
  fireEvent.change(screen.getByLabelText(new RegExp(mm.reasonLabel)), { target: { value: 'NOT_QUALIFIED' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reject modal — candidate notification (C-11)', () => {
  it('has the email off by default and says so on the confirmation step', async () => {
    render(<RejectCandidateModal candidateName="Ana Mora" applications={[APP]} onClose={vi.fn()} />);
    expect((screen.getByLabelText(mm.notifyLabel) as HTMLInputElement).checked).toBe(false);
    pickReason();
    fireEvent.click(screen.getByRole('button', { name: mm.continue }));
    expect(await screen.findByText(mm.confirmNoEmail)).toBeTruthy();
    // The old copy suggested an undo elsewhere; the new one is honest.
    expect(screen.queryByText(/desde el pipeline/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: mm.confirm }));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledTimes(1));
    expect(m.mutate.mock.calls[0]![0]).not.toHaveProperty('notifyCandidate');
  });

  it('sends notifyCandidate when ticked, and confirms the neutral email', async () => {
    render(<RejectCandidateModal candidateName="Ana Mora" applications={[APP]} onClose={vi.fn()} />);
    pickReason();
    fireEvent.click(screen.getByLabelText(mm.notifyLabel));
    fireEvent.click(screen.getByRole('button', { name: mm.continue }));
    expect(await screen.findByText(mm.confirmWithEmail)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: mm.confirm }));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledTimes(1));
    expect(m.mutate.mock.calls[0]![0]).toMatchObject({ applicationId: APP.id, notifyCandidate: true });
  });

  it.each([
    ['queued', mm.successNotified, 'success'],
    ['consent_withdrawn', mm.notNotifiedConsent, 'warning'],
    ['failed', mm.notNotifiedFailed, 'warning'],
    ['not_requested', mm.success, 'success'],
  ])('reports a %s notification', async (outcome, message, type) => {
    const onClose = vi.fn();
    render(<RejectCandidateModal candidateName="Ana Mora" applications={[APP]} onClose={onClose} />);
    await m.onSuccess.current!({ candidateNotification: outcome }, { applicationId: APP.id });
    expect(m.toast).toHaveBeenCalledWith(message, expect.objectContaining({ type }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('reject modal — bulk (journeys-26)', () => {
  const apps = [
    { id: 'a1', vacancyTitle: 'Ana Mora' },
    { id: 'a2', vacancyTitle: 'Luis Vega' },
    { id: 'a3', vacancyTitle: 'Eva Solís' },
  ];

  it('rejects every selected application with the same reason and reports a partial failure', async () => {
    m.mutateAsync
      .mockResolvedValueOnce({ candidateNotification: 'not_requested' })
      .mockRejectedValueOnce(new Error('conflict'))
      .mockResolvedValueOnce({ candidateNotification: 'not_requested' });
    const onClose = vi.fn();
    render(<RejectCandidateModal bulk candidateName="" applications={apps} onClose={onClose} />);
    expect(screen.getByText(mm.bulkTitle.replace('{n}', '3'))).toBeTruthy();
    pickReason();
    fireEvent.click(screen.getByRole('button', { name: mm.continue }));
    expect(await screen.findByText(mm.bulkConfirmDesc.replace('{n}', '3').replace('{reason}', mm.reasons.NOT_QUALIFIED))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: mm.confirm }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(m.mutateAsync.mock.calls.map((c) => (c[0] as { applicationId: string }).applicationId)).toEqual(['a1', 'a2', 'a3']);
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.toast).toHaveBeenCalledWith(
      mm.bulkPartial.replace('{ok}', '2').replace('{total}', '3').replace('{failed}', '1'),
      expect.objectContaining({ type: 'warning' }),
    );
  });
});

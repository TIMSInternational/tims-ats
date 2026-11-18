import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// .claude/rules/frontend.md: "onError toast on every mutation". Two dialogs that stay open on failure show the
// error inline (role="alert") AND as a toast; the HIG pass had dropped the toast (final check, panel coverage).

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  consentOpts: null as null | { onError?: (e: unknown) => void },
  mutationOpts: [] as Array<{ onError?: (e: { message: string }) => void }>,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/platform-api/candidate-consent', () => ({
  classifyConsentError: () => 'other',
  useWithdrawCandidateConsent: (_id: string, opts: { onError?: (e: unknown) => void }) => {
    mocks.consentOpts = opts;
    return { mutate: vi.fn(), isPending: false };
  },
}));
vi.mock('../../apps/web/lib/trpc', () => {
  const useMutation = (opts: { onError?: (e: { message: string }) => void }) => {
    mocks.mutationOpts.push(opts);
    return { mutate: vi.fn(), isPending: false };
  };
  return { trpc: { assessment: { createQuestion: { useMutation }, updateQuestion: { useMutation } } } };
});

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.consentOpts = null;
  mocks.mutationOpts = [];
});

describe('dialog mutation failures toast and stay inline', () => {
  it('consent withdrawal: the error is a toast and an inline alert', async () => {
    const { ConsentWithdrawModal } =
      await import('../../apps/web/app/(admin)/recruitment/candidates/[id]/consent-withdraw-modal');
    render(<ConsentWithdrawModal candidateId="c1" onClose={vi.fn()} />);
    act(() => mocks.consentOpts?.onError?.(new Error('boom')));
    expect(mocks.toast).toHaveBeenCalledWith(es.candidateConsent.errorGeneric, { type: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent(es.candidateConsent.errorGeneric);
  });

  it('company quiz question: the error is a toast and an inline alert', async () => {
    const { QuestionModal } = await import('../../apps/web/app/(admin)/recruitment/assessments/question-modal');
    render(<QuestionModal assessmentTypeId="a1" onClose={vi.fn()} onSaved={vi.fn()} />);
    act(() => mocks.mutationOpts[0]?.onError?.({ message: 'UNMAPPED_SERVER_CODE' }));
    expect(mocks.toast).toHaveBeenCalledWith('UNMAPPED_SERVER_CODE', { type: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('UNMAPPED_SERVER_CODE');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// C-16: the apply modal holds every field in memory, so a backdrop tap / Escape / X must not throw a
// filled form away without asking, and nothing may close it while the application is being sent.

const mocks = vi.hoisted(() => ({ applyMutateAsync: vi.fn(), onClose: vi.fn() }));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ orgSlug: 'acme' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ portal: { getVacancy: { invalidate: async () => undefined } } }),
    portal: {
      applyToVacancy: { useMutation: () => ({ mutateAsync: mocks.applyMutateAsync }) },
      getCvUploadUrl: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
// The real Modal routes Escape, backdrop and X to its close request, and — when `dirty` — shows its own
// in-dialog "¿Descartar los cambios?" prompt instead of closing (components/modal.tsx). Emulate exactly that
// contract: one dismiss button, plus the prompt's two choices while it is open.
vi.mock('../../apps/web/components', async () => {
  const { useState } = await import('react');
  function Modal({
    title,
    onClose,
    dirty,
    children,
    footer,
  }: {
    title: string;
    onClose: () => void;
    dirty?: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) {
    const [asking, setAsking] = useState(false);
    return (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <button type="button" onClick={() => (dirty ? setAsking(true) : onClose())}>
          modal-dismiss
        </button>
        {asking && (
          <div role="alertdialog" aria-label="discard-prompt">
            <button type="button" onClick={() => setAsking(false)}>
              keep-editing
            </button>
            <button type="button" onClick={onClose}>
              discard
            </button>
          </div>
        )}
        {children}
        {footer}
      </div>
    );
  }
  return { Modal };
});
vi.mock('../../apps/web/components/turnstile-widget', () => ({ TurnstileWidget: () => null }));

import { ApplyModal } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal';

const p = en.portal;

function renderModal() {
  return render(
    <ApplyModal
      vacancyId="11111111-1111-4111-8111-111111111111"
      vacancyTitle="Analista"
      companyName="Acme"
      controllerName="Acme"
      onClose={mocks.onClose}
    />,
  );
}

const dismiss = () => fireEvent.click(screen.getByRole('button', { name: 'modal-dismiss' }));

const prompt = () => screen.queryByRole('alertdialog', { name: 'discard-prompt' });

beforeEach(() => {
  mocks.applyMutateAsync.mockReset();
  mocks.onClose.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apply modal close guard', () => {
  it('closes an untouched form without asking', () => {
    renderModal();
    dismiss();
    expect(prompt()).toBeNull();
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('asks before discarding typed data, and keeps the form when the candidate says no', () => {
    renderModal();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Ana' } });
    dismiss();
    expect(prompt()).not.toBeNull();
    expect(mocks.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'keep-editing' }));
    expect(prompt()).toBeNull();
    expect(mocks.onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Ana');

    dismiss();
    fireEvent.click(screen.getByRole('button', { name: 'discard' }));
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('"Cancelar" on step 1 asks the same question before discarding typed data', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: p.cancel }));
    expect(mocks.onClose).toHaveBeenCalledOnce();

    mocks.onClose.mockReset();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: p.cancel }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(en.common.discardTitle);
    expect(mocks.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.common.keepEditing }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Ana');

    fireEvent.click(screen.getByRole('button', { name: p.cancel }));
    fireEvent.click(screen.getByRole('button', { name: en.common.discard }));
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('ignores every close request while the application is being sent', async () => {
    mocks.applyMutateAsync.mockReturnValue(new Promise(() => undefined)); // never settles
    renderModal();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'Ana' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Gomez' } });
    fireEvent.change(inputs[2]!, { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.nextStep) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.nextStep) }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: p.submitApplication }));
    await waitFor(() => expect(mocks.applyMutateAsync).toHaveBeenCalledOnce());

    dismiss();
    expect(prompt()).toBeNull();
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('after a successful application, points the candidate to the portal and closes without asking', async () => {
    mocks.applyMutateAsync.mockResolvedValue({ received: true });
    renderModal();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: 'Ana' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Gomez' } });
    fireEvent.change(inputs[2]!, { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.nextStep) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(p.nextStep) }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: p.submitApplication }));

    expect(await screen.findByText(p.nextStepsTitle)).toBeInTheDocument();
    expect(screen.getByText(p.nextStepTrack)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: p.trackApplications })).toHaveAttribute('href', '/careers/acme/dashboard');

    dismiss();
    expect(prompt()).toBeNull();
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });
});

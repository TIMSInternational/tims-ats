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
// The real Modal routes Escape, backdrop and X to onClose; expose that path as one button.
vi.mock('../../apps/web/components', () => ({
  Modal: ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={onClose}>
        modal-dismiss
      </button>
      {children}
    </div>
  ),
}));
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

// jsdom here has no window.confirm; install a controllable one per test.
function stubConfirm() {
  const confirm = vi.fn<(message?: string) => boolean>(() => true);
  vi.stubGlobal('confirm', confirm);
  return confirm;
}

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
    const confirm = stubConfirm();
    renderModal();
    dismiss();
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('asks before discarding typed data, and keeps the form when the candidate says no', () => {
    const confirm = stubConfirm().mockReturnValue(false);
    renderModal();
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Ana' } });
    dismiss();
    expect(confirm).toHaveBeenCalledWith(p.discardConfirm);
    expect(mocks.onClose).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    dismiss();
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });

  it('ignores every close request while the application is being sent', async () => {
    stubConfirm().mockReturnValue(true);
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
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it('after a successful application, points the candidate to the portal and closes without asking', async () => {
    const confirm = stubConfirm();
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
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });
});

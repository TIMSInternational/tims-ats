import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot UX audit B-04 / B-12 / B-16 / B-17 / B-31 / B-33 / A-15: the offer form in edit mode, its guidance,
// the candidate-profile button, the approval chain, the withdraw dialog and the hire dialog.

const h = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  withdrawMutate: vi.fn(),
  listData: { items: [] as Array<Record<string, unknown>>, total: 0 },
  listInputs: [] as unknown[],
  push: vi.fn(),
  toast: vi.fn(),
  can: vi.fn((_module: string, _action?: string) => true),
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/i18n/index', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => h.toast(...args) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('../../apps/web/lib/permissions', () => ({ useCan: () => h.can }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      create: { useMutation: () => ({ mutateAsync: h.createMutate, isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: h.updateMutate, isPending: false }) },
      withdraw: { useMutation: () => ({ mutateAsync: h.withdrawMutate, isPending: false }) },
      list: {
        useQuery: (input: unknown) => {
          h.listInputs.push(input);
          return { data: h.listData, isLoading: false };
        },
      },
    },
  },
}));

import { CreateOfferModal } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-modal';
import { CreateOfferButton } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-button';
import { ApprovalChain } from '../../apps/web/app/(admin)/recruitment/offers/_components/approval-chain';
import { WithdrawOfferModal } from '../../apps/web/app/(admin)/recruitment/offers/_components/withdraw-offer-modal';
import { HireConfirmationModal } from '../../apps/web/app/(admin)/recruitment/offers/_components/hire-confirmation-modal';
import { OfferManageActions } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-manage-actions';

const OFFER_ID = 'abcdef01-1111-4222-8333-444455556666';
const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const vacancy = {
  id: 'vac-1',
  title: 'Analista',
  salary: { min: 900_000, max: 1_100_000, currency: 'CRC', period: 'monthly' },
  contractType: 'termino_fijo',
  remotePolicy: 'hybrid',
};
const applications = [{ id: 'app-1', vacancy }];

beforeEach(() => {
  vi.clearAllMocks();
  h.can.mockImplementation(() => true);
  h.listData = { items: [], total: 0 };
});

describe('offer form', () => {
  it('prefills contract type and modality from the vacancy (B-15)', () => {
    render(<CreateOfferModal candidateId="cand-1" applications={applications} onClose={vi.fn()} />);
    expect((screen.getByLabelText(/Tipo Contrato/) as HTMLSelectElement).value).toBe('termino_fijo');
    expect((screen.getByLabelText(new RegExp(`^${es.offers.modality}`)) as HTMLSelectElement).value).toBe('hybrid');
  });

  it('says which required fields are missing, refuses a past start date, and marks required fields (B-33)', () => {
    const { container } = render(
      <CreateOfferModal candidateId="cand-1" applications={applications} onClose={vi.fn()} />,
    );
    const hint = screen.getByTestId('offer-form-hint');
    expect(hint.textContent).toContain(es.offers.salaryAmount);
    expect(hint.textContent).toContain(es.offers.startDate);
    expect(screen.getByText(`${es.offers.salaryAmount} *`)).toBeTruthy();

    fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, {
      target: { value: '1000000' },
    });
    const date = container.querySelector('input[type="date"]') as HTMLInputElement;
    // The browser picker cannot go before today (local date).
    expect(date.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(date, { target: { value: isoDay(-10) } });
    expect(hint.textContent).toBe(es.offers.startDatePast);
    expect((screen.getByRole('button', { name: es.offers.createOffer }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(date, { target: { value: isoDay(30) } });
    expect(hint.textContent).toBe(es.offers.requiredFieldsHint);
    expect((screen.getByRole('button', { name: es.offers.createOffer }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('after creating, confirms and opens the new draft instead of the bare list (B-16)', async () => {
    h.createMutate.mockResolvedValue({ id: OFFER_ID });
    const onClose = vi.fn();
    const { container } = render(
      <CreateOfferModal candidateId="cand-1" applications={applications} onClose={onClose} />,
    );
    fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, {
      target: { value: '1000000' },
    });
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: isoDay(30) },
    });
    fireEvent.change(screen.getByLabelText(es.offers.bonusLabel), { target: { value: 'Bono anual' } });
    fireEvent.click(screen.getByRole('button', { name: es.offers.createOffer }));

    await waitFor(() => expect(h.createMutate).toHaveBeenCalledTimes(1));
    expect(h.createMutate.mock.calls[0]![0]).toMatchObject({
      applicationId: 'app-1',
      salary: 12_000_000,
      currency: 'CRC',
      contractType: 'Plazo fijo',
      terms: { modality: 'Híbrido', bonus: 'Bono anual' },
    });
    expect(h.toast).toHaveBeenCalledWith(es.offers.draftCreated, { type: 'success' });
    expect(h.push).toHaveBeenCalledWith(`/recruitment/offers?offer=${OFFER_ID}`);
    expect(onClose).toHaveBeenCalled();
  });

  it('"Editar borrador" prefills the draft and saves it through offer.update (B-04)', async () => {
    h.updateMutate.mockResolvedValue({ id: OFFER_ID, status: 'draft' });
    const onSaved = vi.fn();
    render(
      <CreateOfferModal
        mode="edit"
        candidateId="cand-1"
        applications={applications}
        source={{
          id: OFFER_ID,
          salary: 12_000_000,
          currency: 'CRC',
          startDate: `${isoDay(20)}T12:00:00`,
          contractType: 'Test',
          terms: { schedule: 'L-V', reportingTo: 'Gerencia' },
          benefits: { '1': 'Seguro médico' },
        }}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText(es.offers.editDraftTitle)).toBeTruthy();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1000000');
    // A legacy free-text contract type stays selectable as itself.
    expect((screen.getByLabelText(/Tipo Contrato/) as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Test');

    fireEvent.change(screen.getByLabelText(/Tipo Contrato/), { target: { value: 'indefinido' } });
    fireEvent.click(screen.getByRole('button', { name: es.offers.saveDraft }));

    await waitFor(() => expect(h.updateMutate).toHaveBeenCalledTimes(1));
    expect(h.updateMutate.mock.calls[0]![0]).toMatchObject({
      id: OFFER_ID,
      salary: 12_000_000,
      contractType: 'Plazo indefinido',
      terms: { schedule: 'L-V', reportingTo: 'Gerencia' },
      benefits: { '1': 'Seguro médico' },
    });
    expect(h.createMutate).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(es.offers.draftUpdated, { type: 'success' });
  });
});

describe('candidate profile "Crear oferta" (A-15 / B-17)', () => {
  it('is hidden for viewers who cannot create offers', () => {
    h.can.mockImplementation((module: string, action?: string) => !(module === 'offer' && action === 'create'));
    const { container } = render(<CreateOfferButton candidateId="cand-1" applications={applications} />);
    expect(container.textContent).toBe('');
  });

  it("asks only for the candidate's open offers, so the decision never rests on a newest-page slice", () => {
    render(<CreateOfferButton candidateId="cand-1" applications={applications} />);
    expect(h.listInputs.at(-1)).toEqual({ candidateId: 'cand-1', openOnly: true, pageSize: 100 });
  });

  it('becomes "Ver oferta" when the only application already has an open offer', () => {
    h.listData = {
      items: [{ id: OFFER_ID, status: 'pending_approval', vacancyId: 'vac-1', expiresAt: null }],
      total: 1,
    };
    render(<CreateOfferButton candidateId="cand-1" applications={applications} />);
    const link = screen.getByRole('link', { name: es.offers.viewExistingOffer });
    expect(link.getAttribute('href')).toBe(`/recruitment/offers?offer=${OFFER_ID}`);
    expect(screen.queryByRole('button', { name: es.offers.createOffer })).toBeNull();
  });

  it('stays "Crear oferta" when the earlier offer ended (declined, rejected, withdrawn or expired)', () => {
    h.listData = {
      items: [
        { id: 'o1', status: 'declined', vacancyId: 'vac-1', expiresAt: null },
        { id: 'o2', status: 'sent', vacancyId: 'vac-1', expiresAt: '2000-01-01T00:00:00Z' },
      ],
      total: 2,
    };
    render(<CreateOfferButton candidateId="cand-1" applications={applications} />);
    expect((screen.getByRole('button', { name: es.offers.createOffer }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('offer manage actions (B-04)', () => {
  const draft = {
    id: OFFER_ID,
    status: 'draft',
    candidateId: 'cand-1',
    applicationId: null,
    vacancy,
    salary: 12_000_000,
    currency: 'CRC',
    startDate: `${isoDay(20)}T12:00:00`,
    contractType: 'Plazo fijo',
  };

  it('a draft created without an application link can still be edited, but not copied into a new offer', () => {
    render(<OfferManageActions offer={draft} canEdit canWithdraw canCreateNew onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: es.offers.createNewOffer })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: es.offers.editDraft }));
    expect(screen.getByText(es.offers.editDraftTitle)).toBeTruthy();
  });
});

describe('approval chain (B-12 / B-02)', () => {
  it('labels a step "Paso n" and shows the approver\'s reason', () => {
    render(
      <ApprovalChain
        approvals={[
          {
            id: 'a1',
            step: 1,
            status: 'rejected',
            comment: 'Fuera de banda salarial',
            decidedAt: '2026-11-03T10:00:00Z',
            approver: { id: 'u1', firstName: 'Leo', lastName: 'Lider', jobTitle: null },
          },
        ]}
      />,
    );
    expect(screen.getByText('Paso 1')).toBeTruthy();
    expect(screen.getByText('Motivo: Fuera de banda salarial')).toBeTruthy();
    expect(screen.queryByText(/Step/)).toBeNull();
  });
});

describe('withdraw dialog (B-04)', () => {
  it('warns about a sent link and withdraws with the trimmed reason', async () => {
    h.withdrawMutate.mockResolvedValue({ id: OFFER_ID, status: 'withdrawn' });
    const onWithdrawn = vi.fn();
    render(<WithdrawOfferModal offerId={OFFER_ID} wasSent onClose={vi.fn()} onWithdrawn={onWithdrawn} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(es.offers.withdrawOfferSentWarning)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(es.offers.withdrawOfferReason), { target: { value: '  Salario mal  ' } });
    fireEvent.click(screen.getByRole('button', { name: es.offers.withdrawOfferConfirm }));
    await waitFor(() => expect(h.withdrawMutate).toHaveBeenCalledWith({ id: OFFER_ID, reason: 'Salario mal' }));
    expect(onWithdrawn).toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(es.offers.offerWithdrawnToast, { type: 'success' });
  });
});

describe('hire dialog (B-31)', () => {
  it('is a real dialog that shows start date, access email and role, and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <HireConfirmationModal
        candidateName="Ana Mora"
        accessEmail="ana@example.test"
        startDate="2026-12-01T12:00:00Z"
        initialJobTitle="Analista"
        isPending={false}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('ana@example.test')).toBeTruthy();
    expect(screen.getByText(es.roles.employee)).toBeTruthy();
    expect(screen.getByText(es.offers.hireStartDate)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // Codex review: a new onClose per keystroke made Modal re-run its focus effect and pull focus out of the field.
  it('keeps focus in the job-title field while typing', async () => {
    const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
    render(
      <HireConfirmationModal
        candidateName="Ana Mora"
        accessEmail="ana@example.test"
        startDate="2026-12-01T12:00:00Z"
        initialJobTitle=""
        isPending={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    await flush();
    const input = screen.getByLabelText(es.offers.hireJobTitle);
    input.focus();
    for (const value of ['A', 'An', 'Ana']) {
      fireEvent.change(input, { target: { value } });
      await flush();
      expect(document.activeElement).toBe(input);
    }
  });
});

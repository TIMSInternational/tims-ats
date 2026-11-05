import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-15: creating an offer from the Candidate 360 confirms it and opens THAT offer, not the offers list.
// (Same behaviour as B-16 in tests/offers/offer-manage-ui.test.tsx; both work packages fixed it and the
// release keeps the offers form, so this drives that form: contract-type select, future start date.)

const m = vi.hoisted(() => ({ mutateAsync: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      create: { useMutation: () => ({ mutateAsync: m.mutateAsync, isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

import { CreateOfferModal } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-modal';

const applications = [
  {
    id: 'app-1',
    vacancy: { id: 'vac-1', title: 'Analista', status: 'published', salary: { min: 600_000, max: 1_000_000, currency: 'CRC', period: 'monthly' } },
  },
] as unknown as Parameters<typeof CreateOfferModal>[0]['applications'];

beforeEach(() => vi.clearAllMocks());

describe('create offer from the 360', () => {
  it('toasts the new draft and opens it by id', async () => {
    m.mutateAsync.mockResolvedValue({ id: 'offer-9' });
    const onClose = vi.fn();
    const { container } = render(<CreateOfferModal candidateId="cand-1" applications={applications} onClose={onClose} />);
    fireEvent.change(container.querySelector('input[type="number"]') as HTMLInputElement, { target: { value: '800000' } });
    const startDate = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: startDate } });
    fireEvent.change(screen.getByLabelText(/Tipo Contrato|Contract Type/), { target: { value: 'indefinido' } });
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(m.push).toHaveBeenCalledWith('/recruitment/offers?offer=offer-9'));
    expect(m.toast).toHaveBeenCalledWith(es.offers.draftCreated, { type: 'success' });
    expect(m.toast).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn();
const toastMock = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      create: { useMutation: () => ({ mutateAsync, isPending: false }) },
      submitForApproval: { useMutation: () => ({ mutateAsync, isPending: false }) },
      approve: { useMutation: () => ({ mutateAsync, isPending: false }) },
      reject: { useMutation: () => ({ mutateAsync, isPending: false }) },
    },
    user: {
      list: {
        useQuery: () => ({
          data: { users: [{ id: 'u1', firstName: 'Ana', lastName: 'Leader' }] },
          isLoading: false,
          isError: false,
        }),
      },
      me: { useQuery: () => ({ data: { id: 'me' } }) },
    },
  },
}));

import {
  formatAnnualOfferSalary,
  formatMoneyCode,
  parseVacancySalary,
  toAnnualSalary,
  vacancyMidpointIn,
} from '../../apps/web/lib/offer-salary';
import { describeOfferActionError } from '../../apps/web/lib/offer-action-error';
import { OfferLetter } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-letter';
import { CreateOfferModal } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/create-offer-modal';
import { OfferApprovalActions } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-approval-actions';
import { OfferKpis } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-kpis';

const labels = { perYear: 'año', perMonth: 'mes' };

describe('offer salary semantics', () => {
  it('converts a monthly amount to the stored annual base salary', () => {
    expect(toAnnualSalary(8_000_000, 'monthly')).toBe(96_000_000);
    expect(toAnnualSalary(96_000_000, 'yearly')).toBe(96_000_000);
  });

  it('derives the vacancy midpoint in the chosen period (placeholder only)', () => {
    const range = parseVacancySalary({ min: 6_000_000, max: 10_000_000, currency: 'cop', period: 'monthly' });
    expect(range).toEqual({ min: 6_000_000, max: 10_000_000, currency: 'COP', period: 'monthly' });
    expect(vacancyMidpointIn(range, 'monthly')).toBe(8_000_000);
    expect(vacancyMidpointIn(range, 'yearly')).toBe(96_000_000);
    expect(parseVacancySalary(null)).toBeNull();
  });

  it('formats with the ISO currency code and period, never a bare "$"', () => {
    expect(formatMoneyCode(96_000_000, 'COP')).toBe('COP 96.000.000');
    expect(formatMoneyCode(96_000_000, ' cop ')).toBe('COP 96.000.000');
    // A non-ISO legacy value is shown verbatim, never replaced by USD.
    expect(formatMoneyCode(96_000_000, 'COP$')).toBe('COP$ 96.000.000');
    expect(formatMoneyCode(96_000_000, 'COP$')).not.toContain('USD');
    expect(formatMoneyCode(1_500, '')).toBe('1.500');
    const text = formatAnnualOfferSalary(96_000_000, 'COP', labels);
    expect(text).toBe('COP 96.000.000 / año (COP 8.000.000 / mes)');
    expect(text).not.toContain('$');
  });
});

describe('offer letter preview amount', () => {
  it('shows currency code, annual and monthly equivalents', () => {
    const { container } = render(
      createElement(OfferLetter, {
        companyName: 'Example Company',
        offer: {
          candidate: { firstName: 'QA', lastName: 'Candidate' },
          vacancy: { title: 'QA role' },
          salary: 96_000_000,
          currency: 'COP',
          startDate: new Date('2026-10-01T12:00:00Z'),
          contractType: 'Indefinido',
          benefits: null,
          terms: null,
          createdAt: new Date('2026-09-28T12:00:00Z'),
        },
      }),
    );
    const html = container.textContent ?? '';
    expect(html).toContain('COP 96.000.000 / año (COP 8.000.000 / mes)');
    expect(html).not.toContain('$');
  });
});

describe('offer action errors', () => {
  const errLabels = { forbidden: 'FORBIDDEN_MSG', generic: 'GENERIC_MSG' };

  it('maps FORBIDDEN to the specific message', () => {
    const err = Object.assign(new Error('raw server text'), { data: { code: 'FORBIDDEN' } });
    expect(describeOfferActionError(err, errLabels)).toBe('FORBIDDEN_MSG');
    expect(describeOfferActionError(new Error('Bad input'), errLabels)).toBe('Bad input');
    expect(describeOfferActionError('nope', errLabels)).toBe('GENERIC_MSG');
  });
});

describe('create offer form', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    toastMock.mockReset();
  });

  const applications = [
    {
      id: 'app-1',
      vacancy: {
        id: 'vac-1',
        title: 'Analista',
        status: 'published',
        salary: { min: 6_000_000, max: 10_000_000, currency: 'COP', period: 'monthly' },
      },
    },
  ] as unknown as Parameters<typeof CreateOfferModal>[0]['applications'];

  it('defaults to the vacancy period, uses the midpoint only as placeholder, and stores the annual amount', async () => {
    mutateAsync.mockResolvedValue({ id: 'offer-1' });
    const { container } = render(
      createElement(CreateOfferModal, { candidateId: 'cand-1', applications, onClose: vi.fn() }),
    );
    const amount = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(amount.value).toBe('');
    expect(amount.placeholder).toBe('8000000');
    const selects = container.querySelectorAll('select');
    expect((selects[1] as HTMLSelectElement).value).toBe('monthly');

    fireEvent.change(amount, { target: { value: '8000000' } });
    expect(screen.getByTestId('offer-salary-equivalents').textContent).toContain('COP 96.000.000');
    fireEvent.change(container.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(container.querySelector('input[type="text"]') as HTMLInputElement, {
      target: { value: 'Indefinido' },
    });
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ salary: 96_000_000, currency: 'COP' });
  });

  const twoVacancies = [
    applications[0],
    {
      id: 'app-2',
      vacancy: {
        id: 'vac-2',
        title: 'Ingeniero',
        status: 'published',
        salary: { min: 100_000, max: 140_000, currency: 'USD', period: 'yearly' },
      },
    },
  ] as unknown as Parameters<typeof CreateOfferModal>[0]['applications'];

  it('clears the typed amount when a different vacancy is selected instead of reinterpreting it', () => {
    const { container } = render(
      createElement(CreateOfferModal, { candidateId: 'cand-1', applications: twoVacancies, onClose: vi.fn() }),
    );
    const amount = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(amount, { target: { value: '8000000' } });
    expect(amount.value).toBe('8000000');

    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: 'app-2' } });
    expect((selects[1] as HTMLSelectElement).value).toBe('yearly');
    expect((selects[2] as HTMLSelectElement).value).toBe('USD');
    expect(amount.value).toBe('');
    expect(screen.queryByTestId('offer-salary-equivalents')).toBeNull();
    expect(amount.placeholder).toBe('120000');
  });

  it('keeps the vacancy reference in the vacancy currency and drops the placeholder when currencies differ', () => {
    const { container } = render(
      createElement(CreateOfferModal, { candidateId: 'cand-1', applications, onClose: vi.fn() }),
    );
    const amount = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(screen.getByText(/Referencia de la vacante|Vacancy reference/).textContent).toContain('COP 8.000.000');

    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[2] as HTMLSelectElement, { target: { value: 'USD' } });
    const reference = screen.getByText(/Referencia de la vacante|Vacancy reference/).textContent ?? '';
    expect(reference).toContain('COP 8.000.000');
    expect(reference).not.toContain('USD');
    expect(amount.placeholder).toBe('');
  });
});

describe('offer KPI average salary', () => {
  it('renders the annual average with the ISO code and period, never a bare "$"', () => {
    const { container } = render(
      createElement(OfferKpis, {
        activeCount: 1,
        acceptanceRate: 100,
        avgSalary: 120_000,
        avgSalaryCurrency: 'USD',
        pendingApprovals: 0,
        complete: true,
        loading: false,
        isError: false,
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/USD\s120\.000 \/ (año|year)/);
    expect(text).not.toContain('$');
  });

  it('shows N/D instead of averaging across currencies', () => {
    const { container } = render(
      createElement(OfferKpis, {
        activeCount: 0,
        acceptanceRate: 0,
        avgSalary: null,
        avgSalaryCurrency: null,
        pendingApprovals: 0,
        complete: true,
        loading: false,
        isError: false,
      }),
    );
    expect(container.textContent).toContain('N/D');
  });
});

describe('offer approval actions surface errors', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    toastMock.mockReset();
  });

  it('shows an inline alert and a toast with the FORBIDDEN message', async () => {
    mutateAsync.mockRejectedValue(Object.assign(new Error('raw'), { data: { code: 'FORBIDDEN' } }));
    const { container } = render(
      createElement(OfferApprovalActions, { offerId: 'o1', status: 'draft', approvals: [], onUpdated: vi.fn() }),
    );
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('button'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No tienes permiso/);
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/No tienes permiso/), { type: 'error' });
  });
});

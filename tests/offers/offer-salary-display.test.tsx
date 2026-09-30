import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn();
const toastMock = vi.fn();

const signingOffer = vi.fn();
const portalOffers = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ token: 'tok-1' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    offer: {
      create: { useMutation: () => ({ mutateAsync, isPending: false }) },
      submitForApproval: { useMutation: () => ({ mutateAsync, isPending: false }) },
      approve: { useMutation: () => ({ mutateAsync, isPending: false }) },
      reject: { useMutation: () => ({ mutateAsync, isPending: false }) },
      getBySigningToken: { useQuery: () => signingOffer() },
      acceptByToken: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      declineByToken: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    candidatePortal: {
      myOffers: { useQuery: () => portalOffers() },
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
import { OfferTable } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-table';
import OfferSignPage from '../../apps/web/app/offers/sign/[token]/page';
import { DashboardOffer } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-offer';

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
    expect(describeOfferActionError('nope', errLabels)).toBe('GENERIC_MSG');
  });

  const withCode = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });

  it('shows human server messages only for NOT_FOUND, CONFLICT and plain BAD_REQUEST', () => {
    expect(describeOfferActionError(withCode('Oferta no encontrada', 'NOT_FOUND'), errLabels)).toBe('Oferta no encontrada');
    expect(describeOfferActionError(withCode('Ya existe', 'CONFLICT'), errLabels)).toBe('Ya existe');
    expect(
      describeOfferActionError(withCode('Solo se pueden editar ofertas en estado borrador', 'BAD_REQUEST'), errLabels),
    ).toBe('Solo se pueden editar ofertas en estado borrador');
  });

  it('never shows internal errors, serialized Zod issues, or uncoded errors', () => {
    expect(
      describeOfferActionError(withCode('PrismaClientKnownRequestError: P2002 at offer.create', 'INTERNAL_SERVER_ERROR'), errLabels),
    ).toBe('GENERIC_MSG');
    const zodMessage = JSON.stringify([{ code: 'too_big', path: ['salary'], message: 'Salario fuera de rango' }], null, 2);
    expect(describeOfferActionError(withCode(zodMessage, 'BAD_REQUEST'), errLabels)).toBe('GENERIC_MSG');
    expect(describeOfferActionError(withCode('boom', 'TOO_MANY_REQUESTS'), errLabels)).toBe('GENERIC_MSG');
    expect(describeOfferActionError(new Error('Failed to fetch'), errLabels)).toBe('GENERIC_MSG');
    expect(describeOfferActionError(withCode('', 'NOT_FOUND'), errLabels)).toBe('GENERIC_MSG');
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
    // The average is computed over the loaded page (≤50 rows), and the label says so.
    expect(text).toMatch(/lista cargada|loaded list/);
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

// Annual 96M COP must read as annual with its monthly equivalent — never as a bare "$" or a monthly figure.
const ANNUAL_COP = /COP 96\.000\.000 \/ (año|year) \(COP 8\.000\.000 \/ (mes|month)\)/;

describe('candidate-facing salary rendering', () => {
  it('public signing page shows the annual amount with the monthly equivalent', () => {
    signingOffer.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        status: 'sent',
        salary: 96_000_000,
        currency: 'COP',
        contractType: 'Indefinido',
        startDate: '2026-10-01T12:00:00Z',
        benefits: null,
        candidate: { firstName: 'Ana', lastName: 'Gomez' },
        vacancy: { title: 'Analista' },
        organization: { name: 'Example Co', logo: null },
      },
    });
    const { container } = render(createElement(OfferSignPage));
    const text = container.textContent ?? '';
    expect(text).toMatch(ANNUAL_COP);
    expect(text).not.toContain('$');
  });

  it('candidate portal offer card shows the annual amount with the monthly equivalent', () => {
    portalOffers.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        {
          id: 'o1',
          status: 'sent',
          salary: 96_000_000,
          currency: 'COP',
          startDate: '2026-10-01T12:00:00Z',
          contractType: 'indefinido',
          expiresAt: null,
          signingToken: null,
          vacancy: { title: 'Analista', company: { name: 'Example Co' } },
        },
      ],
    });
    const { container } = render(createElement(DashboardOffer, { orgSlug: 'acme' }));
    const text = container.textContent ?? '';
    expect(text).toMatch(ANNUAL_COP);
    expect(text).not.toContain('$');
  });

  it('offer table labels the stored amount as annual with the ISO code', () => {
    const { container } = render(
      createElement(OfferTable, {
        items: [
          {
            id: 'o1',
            salary: 96_000_000,
            currency: 'COP',
            status: 'sent',
            sentAt: null,
            expiresAt: null,
            candidate: { id: 'c1', firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com', avatar: null },
            vacancy: { id: 'v1', title: 'Analista' },
            approvals: [],
          },
        ],
        loading: false,
        isError: false,
        statusFilter: '',
        onStatusChange: vi.fn(),
        onSelectOffer: vi.fn(),
      }),
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/COP 96\.000\.000 \/ (año|year)/);
    expect(text).not.toContain('$');
  });
});

describe('create offer form — vacancy switching and bounds', () => {
  beforeEach(() => mutateAsync.mockReset());

  const withBareVacancy = [
    {
      id: 'app-usd',
      vacancy: {
        id: 'vac-usd',
        title: 'Ingeniero',
        status: 'published',
        salary: { min: 100_000, max: 140_000, currency: 'USD', period: 'yearly' },
      },
    },
    { id: 'app-bare', vacancy: { id: 'vac-bare', title: 'Sin salario', status: 'published', salary: null } },
  ] as unknown as Parameters<typeof CreateOfferModal>[0]['applications'];

  it('resets period and currency to monthly/COP when the new vacancy has no salary data', () => {
    const { container } = render(
      createElement(CreateOfferModal, { candidateId: 'cand-1', applications: withBareVacancy, onClose: vi.fn() }),
    );
    const selects = container.querySelectorAll('select');
    expect((selects[1] as HTMLSelectElement).value).toBe('yearly');
    expect((selects[2] as HTMLSelectElement).value).toBe('USD');
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: 'app-bare' } });
    expect((selects[1] as HTMLSelectElement).value).toBe('monthly');
    expect((selects[2] as HTMLSelectElement).value).toBe('COP');
  });

  it('does not accept an amount above the API cap', () => {
    const { container } = render(
      createElement(CreateOfferModal, { candidateId: 'cand-1', applications: withBareVacancy, onClose: vi.fn() }),
    );
    const amount = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(amount.max).toBe('1000000000000');
    fireEvent.change(amount, { target: { value: '1000000000001' } });
    expect(screen.queryByTestId('offer-salary-equivalents')).toBeNull();
    fireEvent.change(amount, { target: { value: '120000' } });
    expect(screen.getByTestId('offer-salary-equivalents').textContent).toContain('USD 120.000');
  });
});

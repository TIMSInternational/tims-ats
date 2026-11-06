import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot call audit 2026-11-05: the wizard's salary band was <input type="number"> + parseInt(text): no digit
// grouping, a wheel/arrow step could change it, and nothing refused a minimum above the maximum. It now uses the
// shared money input (components/money-input.tsx, lib/money-amount.ts) through SalaryBandFields.

delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;
delete process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP;

const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    organization: {
      listCompanies: { useQuery: () => ok([]) },
      listTeams: { useQuery: () => ok(undefined) },
    },
    user: { list: { useQuery: () => ok({ users: [] }) } },
    vacancy: {
      generateDescription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      checkInclusiveLanguage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

let onConfirm: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  const { CreateModal } = await import('../../apps/web/app/(admin)/recruitment/vacancies/create-modal');
  onConfirm = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateModal onConfirm={onConfirm} onClose={() => {}} isPending={false} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText('Ej: Senior Software Engineer'), { target: { value: 'Analista' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
});

const minInput = () => screen.getByLabelText(es.vacancies.salaryMin) as HTMLInputElement;
const maxInput = () => screen.getByLabelText(es.vacancies.salaryMax) as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: es.vacancies.createVacancySubmit }) as HTMLButtonElement;
const type = (input: HTMLInputElement, value: string) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const g = (text: string) => text.replace(/ /g, ' ');

describe('vacancy wizard — salary band', () => {
  it('is a text input with a decimal keyboard: nothing can step the amount', () => {
    expect(minInput().type).toBe('text');
    expect(minInput().inputMode).toBe('decimal');
    expect(maxInput().type).toBe('text');
  });

  it('accepts digit grouping, shows it grouped, and sends whole colones', () => {
    type(minInput(), '650.000');
    type(maxInput(), '900,000');
    expect(minInput().value).toBe(g('650 000'));
    expect(maxInput().value).toBe(g('900 000'));
    fireEvent.click(submit());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0].salary).toEqual({
      min: 650_000,
      max: 900_000,
      currency: 'CRC',
      period: 'monthly',
    });
  });

  it('refuses a minimum above the maximum (Spanish error), and nothing is sent', () => {
    type(minInput(), '900000');
    type(maxInput(), '650000');
    expect(screen.getByRole('alert').textContent).toBe(es.vacancies.editSalaryRange);
    expect(submit().disabled).toBe(true);
    fireEvent.click(submit());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses decimals in colones', () => {
    type(minInput(), '650000,50');
    expect(screen.getByRole('alert').textContent).toBe('CRC se usa sin decimales: escribe un número entero.');
    expect(submit().disabled).toBe(true);
  });

  it('warns when the minimum is below a tenth of the maximum; the person confirms THIS band', () => {
    type(minInput(), '85000');
    type(maxInput(), '1200000');
    expect(screen.getByText(es.money.wideRange)).toBeTruthy();
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(es.money.confirmWideRange));
    expect(submit().disabled).toBe(false);
    // Changing an amount voids the confirmation.
    type(minInput(), '86000');
    expect((screen.getByLabelText(es.money.confirmWideRange) as HTMLInputElement).checked).toBe(false);
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(es.money.confirmWideRange));
    fireEvent.click(submit());
    expect(onConfirm.mock.calls[0]![0].salary).toMatchObject({ min: 86_000, max: 1_200_000 });
  });

  it('no salary at all is still allowed', () => {
    fireEvent.click(submit());
    expect(onConfirm.mock.calls[0]![0].salary).toBeUndefined();
  });
});

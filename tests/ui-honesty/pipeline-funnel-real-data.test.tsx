import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

type Funnel = { totalApplications: number; funnel: { stageName: string; currentCount: number; conversionRate: number }[] };
const state = vi.hoisted(() => ({
  funnel: { isLoading: false, isError: false, data: undefined as Funnel | undefined },
  calls: [] as { vacancyId: string; enabled: boolean }[],
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    pipeline: {
      getFunnel: {
        useQuery: (input: { vacancyId: string }, opts: { enabled: boolean }) => {
          state.calls.push({ vacancyId: input.vacancyId, enabled: opts.enabled });
          return { ...state.funnel, refetch: vi.fn() };
        },
      },
    },
  },
}));
vi.mock('../../apps/web/components', () => ({ ErrorState: () => <div data-testid="error-state" /> }));

import { PipelineFunnel } from '../../apps/web/app/(admin)/dashboard/pipeline-funnel';
import type { VacancyListItem } from '../../apps/web/lib/trpc-types';

const vacancy = (id: string, title: string) => ({ id, title }) as unknown as VacancyListItem;
const numbersIn = (el: HTMLElement) => (el.textContent ?? '').match(/\d+/g) ?? [];

describe('PipelineFunnel shows only real pipeline data', () => {
  it('an organization with no published vacancies sees an empty state and no numbers', () => {
    state.funnel = { isLoading: false, isError: false, data: undefined };
    const { container } = render(<PipelineFunnel vacancies={[]} />);
    expect(screen.getByText(en.recruitingDashboard.noVacanciesPublished)).toBeTruthy();
    expect(numbersIn(container)).toEqual([]);
    expect(state.calls.at(-1)?.enabled).toBe(false);
  });

  it('a vacancy with an empty pipeline sees an empty state, not estimated stage counts', () => {
    state.funnel = { isLoading: false, isError: false, data: { totalApplications: 0, funnel: [] } };
    const { container } = render(<PipelineFunnel vacancies={[vacancy('v1', 'Dev')]} />);
    expect(screen.getByText(en.recruitingDashboard.noPipelineData)).toBeTruthy();
    expect(numbersIn(container)).toEqual([]);
  });

  it('renders the API counts as-is, including a real total of 0, with no period filter', () => {
    state.funnel = {
      isLoading: false,
      isError: false,
      data: { totalApplications: 0, funnel: [{ stageName: 'Screen', currentCount: 0, conversionRate: 0 }] },
    };
    const { container } = render(<PipelineFunnel vacancies={[vacancy('v1', 'Dev')]} />);
    expect(numbersIn(container)).toEqual(['0', '0']);
    expect(screen.queryByText(en.recruitingDashboard.last30Days)).toBeNull();
    expect(screen.queryByText(en.recruitingDashboard.allVacancies)).toBeNull();
    // The selector names the vacancy whose funnel is shown.
    expect(screen.getByRole('button', { name: 'Dev' })).toBeTruthy();
    expect(state.calls.at(-1)).toEqual({ vacancyId: 'v1', enabled: true });
  });
});

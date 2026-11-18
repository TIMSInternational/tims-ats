import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// The FIT role family saves as soon as it changes (no extra "Guardar"), so leaving the page never drops a
// choice; a failed save is reported with an error toast. The SLA card shows no countdown on a closed vacancy.
const mutate = vi.fn();
const toast = vi.fn();
let mutationOptions: { onError?: (err: { message: string }) => void } = {};

vi.mock('../../apps/web/lib/i18n', async () => ({
  ...(await vi.importActual<typeof import('../../apps/web/lib/i18n/format')>('../../apps/web/lib/i18n/format')),
  useI18n: () => ({ t: es, locale: 'ES' }),
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ vacancy: { getById: { invalidate: vi.fn() } } }),
    fitEngine: {
      listRoleFamilyWeightProfiles: {
        useQuery: () => ({ data: [{ id: 'p1', name: 'Default' }, { id: 'p2', name: 'Ventas' }] }),
      },
    },
    vacancy: {
      updateRoleFamily: {
        useMutation: (opts: typeof mutationOptions) => {
          mutationOptions = opts;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));

import { RoleFamilyCard } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/role-family-card';
import { SlaCard } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/sla-card';
import type { VacancyDetail } from '../../apps/web/lib/trpc-types';

afterEach(() => {
  cleanup();
  mutate.mockReset();
  toast.mockReset();
});

describe('RoleFamilyCard', () => {
  it('saves the role family as soon as it changes', () => {
    render(<RoleFamilyCard vacancyId="vac-1" roleFamily={null} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ventas' } });
    expect(mutate).toHaveBeenCalledWith({ vacancyId: 'vac-1', roleFamily: 'Ventas' });
    expect(screen.queryByRole('button', { name: es.common.save })).toBeNull();
  });

  it('sends null when "Ninguna" is chosen and toasts a failed save', () => {
    render(<RoleFamilyCard vacancyId="vac-1" roleFamily="Ventas" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
    expect(mutate).toHaveBeenCalledWith({ vacancyId: 'vac-1', roleFamily: null });
    mutationOptions.onError?.({ message: 'boom' });
    expect(toast).toHaveBeenCalledWith('boom', { type: 'error' });
  });
});

describe('SlaCard', () => {
  const base = { createdAt: new Date(), settings: { slaTargetDays: 30 }, positions: 1 };

  it('counts down on an open vacancy', () => {
    render(<SlaCard vacancy={{ ...base, status: 'published' } as unknown as VacancyDetail} />);
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('shows no days remaining on a closed vacancy', () => {
    render(<SlaCard vacancy={{ ...base, status: 'closed' } as unknown as VacancyDetail} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});

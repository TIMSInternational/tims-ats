import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-08: "Congelar" said "pausada temporalmente" but had no way back, so wave 1 hid it in the pilot. With a real
// "Reanudar" (vacancy.resume) it is offered again, everywhere, and the confirm copy says how to undo it.
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));

import { VacancyTable } from '../../apps/web/app/(admin)/recruitment/vacancies/vacancy-table';
import type { VacancyListItem } from '../../apps/web/lib/trpc-types';

function vacancy(status: string): VacancyListItem {
  return {
    id: `v-${status}`,
    title: 'Analista',
    status,
    priority: 'medium',
    positions: 1,
    location: 'San José',
    remotePolicy: 'onsite',
    contractType: 'indefinido',
    salary: null,
    createdAt: new Date('2026-11-01'),
    closedAt: null,
    company: null,
    unit: null,
    team: null,
    creator: null,
    _count: { applications: 0 },
  } as unknown as VacancyListItem;
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('vacancy "Congelar" / "Reanudar" actions', () => {
  it('offers "Congelar" on a published vacancy under the pilot launch scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    const onFreeze = vi.fn();
    render(
      <VacancyTable vacancies={[vacancy('published')]} isLoading={false} onDuplicate={vi.fn()} onClose={vi.fn()} onFreeze={onFreeze} />,
    );
    fireEvent.click(screen.getByTitle(es.vacancies.freezeVacancy));
    expect(onFreeze).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-published' }));
    expect(screen.queryByRole('button', { name: es.vacancies.resumeVacancy })).toBeNull();
  });

  it('offers "Reanudar" (and neither close nor freeze) on a frozen vacancy', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    const onResume = vi.fn();
    render(
      <VacancyTable
        vacancies={[vacancy('frozen')]}
        isLoading={false}
        onDuplicate={vi.fn()}
        onClose={vi.fn()}
        onFreeze={vi.fn()}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: es.vacancies.resumeVacancy }));
    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ id: 'v-frozen' }));
    expect(screen.queryByTitle(es.vacancies.freezeVacancy)).toBeNull();
    expect(screen.queryByTitle(es.vacancies.closeVacancy)).toBeNull();
  });

  it('the freeze confirm no longer promises a pause it cannot undo, and names the way back', () => {
    expect(es.vacancies.confirmFreeze).toBe('¿Congelar esta vacante?');
    expect(es.vacancies.confirmFreezeDesc).not.toMatch(/temporal|no se puede reactivar/);
    expect(es.vacancies.confirmFreezeDesc).toContain(es.vacancies.resumeVacancy);
  });
});

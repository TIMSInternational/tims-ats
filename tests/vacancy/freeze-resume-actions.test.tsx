import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// A-08: "Congelar" said "pausada temporalmente" but there is no way back (no resume/reopen). The pilot does
// not offer it; outside the pilot its confirm copy now says it cannot be reactivated.
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));

import { VacancyTable } from '../../apps/web/app/(admin)/recruitment/vacancies/vacancy-table';
import type { VacancyListItem } from '../../apps/web/lib/trpc-types';

const published = {
  id: 'v1',
  title: 'Analista',
  status: 'published',
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

function renderTable() {
  return render(
    <VacancyTable vacancies={[published]} isLoading={false} onDuplicate={vi.fn()} onClose={vi.fn()} onFreeze={vi.fn()} />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('vacancy "Congelar" action', () => {
  it('is not offered under the pilot launch scope', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    renderTable();
    expect(screen.queryByTitle(es.vacancies.freezeVacancy)).toBeNull();
    expect(screen.getByTitle(es.vacancies.closeVacancy)).toBeTruthy();
  });

  it('is still offered in the full product, with honest copy', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', '');
    renderTable();
    expect(screen.getByTitle(es.vacancies.freezeVacancy)).toBeTruthy();
    expect(es.vacancies.confirmFreeze).toBe('¿Congelar esta vacante?');
    expect(es.vacancies.confirmFreezeDesc).not.toMatch(/temporal/);
  });
});

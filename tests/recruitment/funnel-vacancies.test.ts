import { describe, expect, it } from 'vitest';
import { buildFunnelVacancies } from '../../apps/web/app/(admin)/dashboard/funnel-vacancies';

describe('dashboard funnel vacancy options', () => {
  it('keeps filled (closed) vacancies selectable after the open ones, tagged', () => {
    const options = buildFunnelVacancies(
      [{ id: 'p1', title: 'Analista' }],
      [{ id: 'c1', title: 'Contador' }],
      'cerrada',
    );
    expect(options).toEqual([
      { id: 'p1', title: 'Analista' },
      { id: 'c1', title: 'Contador · cerrada' },
    ]);
  });

  it('works with no closed vacancies', () => {
    expect(buildFunnelVacancies([{ id: 'p1', title: 'A' }], [], 'cerrada')).toEqual([{ id: 'p1', title: 'A' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildStageSteps } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/stage-timeline';

function app(name: string, order: number) {
  return {
    id: 'a1',
    status: 'active',
    source: 'portal',
    appliedAt: '2026-10-01T00:00:00.000Z',
    vacancy: { id: 'v1', title: 'Analista', status: 'open' },
    currentStage: { id: 's1', name, order },
  };
}

const stripped = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

describe('candidate stage timeline', () => {
  it.each(['Preseleccion', 'Preselección', 'PRESELECCION'])(
    'collapses a stored "%s" stage onto the built-in step (accent/case-insensitive)',
    (stored) => {
      const steps = buildStageSteps(app(stored, 1));
      const presel = steps.filter((s) => s.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === 'preseleccion');
      expect(presel).toHaveLength(1);
      expect(steps.filter((s) => s.isCurrent)).toHaveLength(1);
    },
  );

  it.each([3, 5])('keeps the actual stage current when its name matches a built-in step at order %i', (order) => {
    const steps = buildStageSteps(app('Preselección', order));
    expect(steps.filter((s) => s.isCurrent)).toEqual([
      { name: 'Preselección', date: null, isCurrent: true, isCompleted: false },
    ]);
    expect(steps.filter((s) => stripped(s.name) === 'preseleccion')).toHaveLength(1);
  });

  it('keeps a distinct current stage as its own step', () => {
    const steps = buildStageSteps(app('Entrevista técnica', 3));
    expect(steps.map((s) => s.name)).toContain('Entrevista técnica');
    expect(steps.filter((s) => s.isCurrent).map((s) => s.name)).toEqual(['Entrevista técnica']);
  });
});

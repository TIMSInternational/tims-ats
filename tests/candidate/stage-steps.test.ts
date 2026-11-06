import { describe, expect, it } from 'vitest';
import { buildStageSteps } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/stage-steps';

// A-03: the 360 "Proceso" card shows the vacancy's REAL stages, with the dates the application entered each
// one from its movement history — not a hard-coded "Postulada / Preselección / Evaluaciones / … " list with
// steps ticked by order number.

const STAGES = [
  { id: 's0', name: 'Postulación recibida', order: 0 },
  { id: 's1', name: 'Preselección', order: 1 },
  { id: 's2', name: 'Entrevista con RR. HH.', order: 2 },
  { id: 's3', name: 'Prueba técnica', order: 3 },
  { id: 's4', name: 'Entrevista final', order: 4 },
  { id: 's5', name: 'Oferta', order: 5 },
  { id: 's6', name: 'Contratado', order: 6 },
];
const APPLIED = '2026-11-01T15:00:00.000Z';

function move(from: string | null, to: string, at: string) {
  return { movedAt: at, fromStage: from ? { id: from } : null, toStage: { id: to } };
}

describe('buildStageSteps', () => {
  it('lists exactly the vacancy stages, in order, with nothing invented', () => {
    const steps = buildStageSteps([...STAGES].reverse(), [], { appliedAt: APPLIED, currentStage: { id: 's0' } });
    expect(steps.map((s) => s.name)).toEqual(STAGES.map((s) => s.name));
    expect(steps.map((s) => s.name)).not.toContain('Evaluaciones');
  });

  it('marks the stages the application went through, with the date it entered each one', () => {
    const steps = buildStageSteps(
      STAGES,
      [move('s0', 's1', '2026-11-02T10:00:00.000Z'), move('s1', 's3', '2026-11-03T10:00:00.000Z')],
      { appliedAt: APPLIED, currentStage: { id: 's3' } },
    );
    expect(steps.map((s) => s.state)).toEqual(['reached', 'reached', 'pending', 'current', 'pending', 'pending', 'pending']);
    expect(steps[0]!.enteredAt).toBe(APPLIED);
    expect(steps[1]!.enteredAt).toBe('2026-11-02T10:00:00.000Z');
    // A skipped stage is not ticked just because its order is lower than the current one.
    expect(steps[2]!.enteredAt).toBeNull();
    expect(steps[3]!.enteredAt).toBe('2026-11-03T10:00:00.000Z');
  });

  it('uses the latest entry when an application came back to a stage, whatever the history order', () => {
    const steps = buildStageSteps(
      STAGES,
      [
        move('s2', 's1', '2026-11-04T10:00:00.000Z'),
        move('s0', 's1', '2026-11-02T10:00:00.000Z'),
        move('s1', 's2', '2026-11-03T10:00:00.000Z'),
      ],
      { appliedAt: APPLIED, currentStage: { id: 's1' } },
    );
    expect(steps[1]).toMatchObject({ state: 'current', enteredAt: '2026-11-04T10:00:00.000Z' });
    expect(steps[2]).toMatchObject({ state: 'reached' });
  });

  it('dates the stage an application was added into (not the first one) with the application date', () => {
    const steps = buildStageSteps(STAGES, [], { appliedAt: APPLIED, currentStage: { id: 's2' } });
    expect(steps.filter((s) => s.state !== 'pending').map((s) => s.id)).toEqual(['s2']);
    expect(steps[2]!.enteredAt).toBe(APPLIED);
  });
});

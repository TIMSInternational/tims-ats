import { describe, it, expect } from 'vitest';
import { moveApplicationOptimistic } from '../../apps/web/app/(admin)/recruitment/pipeline/pipeline-optimistic';

// Minimal structural board fixture — the helper only touches id/count/applications.
function board() {
  return {
    vacancyId: 'vac-1',
    stages: [
      { id: 'applied', name: 'Aplicado', count: 2, applications: [{ id: 'a1' }, { id: 'a2' }] },
      { id: 'screening', name: 'Screening', count: 0, applications: [] as Array<{ id: string }> },
      { id: 'offer', name: 'Oferta', count: 1, applications: [{ id: 'a3' }] },
    ],
  };
}

describe('moveApplicationOptimistic', () => {
  it('moves a card to the destination stage and keeps counts in sync', () => {
    const next = moveApplicationOptimistic(board(), 'a1', 'screening');

    const applied = next.stages.find((s) => s.id === 'applied')!;
    const screening = next.stages.find((s) => s.id === 'screening')!;

    expect(applied.applications.map((a) => a.id)).toEqual(['a2']);
    expect(applied.count).toBe(1);
    expect(screening.applications.map((a) => a.id)).toEqual(['a1']);
    expect(screening.count).toBe(1);
  });

  it('appends to the end of the destination stage (drop-to-end)', () => {
    const next = moveApplicationOptimistic(board(), 'a1', 'offer');
    const offer = next.stages.find((s) => s.id === 'offer')!;
    expect(offer.applications.map((a) => a.id)).toEqual(['a3', 'a1']);
    expect(offer.count).toBe(2);
  });

  it('preserves top-level board fields (e.g. vacancyId)', () => {
    const next = moveApplicationOptimistic(board(), 'a1', 'screening');
    expect(next.vacancyId).toBe('vac-1');
  });

  it('is a no-op when the destination is the same stage', () => {
    const next = moveApplicationOptimistic(board(), 'a1', 'applied');
    expect(next).toEqual(board());
  });

  it('is a no-op when the application is not found', () => {
    const next = moveApplicationOptimistic(board(), 'ghost', 'screening');
    expect(next).toEqual(board());
  });

  it('is a no-op when the destination stage does not exist (does not orphan the card)', () => {
    const next = moveApplicationOptimistic(board(), 'a1', 'deleted-stage');
    // Card must remain in its source stage, not vanish from every column.
    expect(next).toEqual(board());
    const applied = next.stages.find((s) => s.id === 'applied')!;
    expect(applied.applications.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('does not mutate the input board', () => {
    const original = board();
    const snapshot = JSON.parse(JSON.stringify(original));
    moveApplicationOptimistic(original, 'a1', 'screening');
    expect(original).toEqual(snapshot);
  });
});

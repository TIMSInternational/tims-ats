import { describe, expect, it } from 'vitest';
import { getNextActionForStage, visibleNextAction } from '../../apps/web/lib/pipeline-next-actions';

// Codex P2 on #398: after a stage move, the next-action toast must not link into a module the pilot scope
// hides (the route guard would answer with AccessDenied).
describe('stage-move next action under the launch scope', () => {
  it('drops the assessments suggestion under pilot', () => {
    const action = getNextActionForStage('Evaluaciones');
    expect(action?.href).toBe('/recruitment/assessments');
    expect(visibleNextAction(action, 'pilot')).toBeNull();
  });

  it('keeps it in full scope', () => {
    const action = getNextActionForStage('Evaluaciones');
    expect(visibleNextAction(action, 'full')).toEqual(action);
  });

  it('keeps in-scope suggestions (interviews, offers) under pilot', () => {
    for (const stage of ['Entrevistas', 'Oferta']) {
      const action = getNextActionForStage(stage);
      expect(action).not.toBeNull();
      expect(visibleNextAction(action, 'pilot')).toEqual(action);
    }
  });

  it('passes null through', () => {
    expect(visibleNextAction(null, 'pilot')).toBeNull();
  });
});

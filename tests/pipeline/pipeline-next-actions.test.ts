import { describe, it, expect } from 'vitest';
import { getNextActionForStage } from '../../apps/web/lib/pipeline-next-actions';

describe('getNextActionForStage', () => {
  it('maps "Postulado" to the review-profile action', () => {
    expect(getNextActionForStage('Postulado')).toEqual({ labelKey: 'postulado', href: '/recruitment/candidates' });
  });

  it('maps "Preselección" to the continue-screening action', () => {
    expect(getNextActionForStage('Preselección')).toEqual({ labelKey: 'preseleccion', href: '/recruitment/candidates' });
  });

  it('maps "Evaluaciones" to the assign-assessment-battery action', () => {
    expect(getNextActionForStage('Evaluaciones')).toEqual({ labelKey: 'evaluaciones', href: '/recruitment/assessments' });
  });

  it('maps "Entrevistas" to the schedule-interview action', () => {
    expect(getNextActionForStage('Entrevistas')).toEqual({ labelKey: 'entrevistas', href: '/recruitment/interviews' });
  });

  it('maps "Oferta" to the prepare-offer action', () => {
    expect(getNextActionForStage('Oferta')).toEqual({ labelKey: 'oferta', href: '/recruitment/offers' });
  });

  it('maps "Contratado" to the start-onboarding action', () => {
    expect(getNextActionForStage('Contratado')).toEqual({ labelKey: 'contratado', href: '/people/onboarding' });
  });

  it('is case-insensitive and accent-insensitive (fuzzy match)', () => {
    expect(getNextActionForStage('evaluaciones')).toEqual({ labelKey: 'evaluaciones', href: '/recruitment/assessments' });
    expect(getNextActionForStage('EVALUACIONES')).toEqual({ labelKey: 'evaluaciones', href: '/recruitment/assessments' });
    expect(getNextActionForStage('preseleccion')).toEqual({ labelKey: 'preseleccion', href: '/recruitment/candidates' });
    expect(getNextActionForStage('  Entrevistas  ')).toEqual({ labelKey: 'entrevistas', href: '/recruitment/interviews' });
  });

  it('returns null for an unrecognized custom stage name (never throws)', () => {
    expect(getNextActionForStage('Etapa Personalizada XYZ')).toBeNull();
    expect(getNextActionForStage('')).toBeNull();
  });

  it('gracefully returns null for a stageType that does not correspond to any known field on the model (PipelineStage has no stageType column — this param is accepted for forward-compat but currently unused)', () => {
    expect(getNextActionForStage('Custom Stage', 'some-unknown-type')).toBeNull();
  });
});

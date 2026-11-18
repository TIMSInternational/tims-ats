import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_PIPELINE_STAGES } from '../../packages/api/src/routers/vacancy/default-stages';
import { getNextActionForStage, visibleNextAction } from '../../apps/web/lib/pipeline-next-actions';

// A-11: every NEW vacancy starts with these stages. Recruiters read them as board columns and candidates
// read them as "Etapa actual", so they are accented Spanish, and the SLAs are realistic for a public-sector
// process instead of turning almost every card "SLA vencido".
describe('default pipeline stages for new vacancies', () => {
  const names = DEFAULT_PIPELINE_STAGES.map((s) => s.name);

  it('are Spanish with accents, no English and no unaccented leftovers', () => {
    expect(names).toEqual([
      'Postulación recibida',
      'Preselección',
      'Entrevista con RR. HH.',
      'Prueba técnica',
      'Entrevista final',
      'Oferta',
      'Contratado',
    ]);
    expect(names.join(' ')).not.toMatch(/Screening|Tecnica|Aplicado|RRHH/);
  });

  it('give recruiters days, not hours, and no SLA clock on Oferta or Contratado', () => {
    for (const stage of DEFAULT_PIPELINE_STAGES.slice(0, 5)) {
      expect(stage.slaHours).not.toBeNull();
      expect(stage.slaHours!).toBeGreaterThanOrEqual(72);
    }
    expect(DEFAULT_PIPELINE_STAGES.find((s) => s.name === 'Oferta')?.slaHours).toBeNull();
    expect(DEFAULT_PIPELINE_STAGES.find((s) => s.name === 'Contratado')?.slaHours).toBeNull();
  });

  it('is what vacancy.create seeds (the router no longer keeps its own copy)', () => {
    const src = readFileSync(resolve(__dirname, '../../packages/api/src/routers/vacancy/crud.ts'), 'utf8');
    expect(src).toContain("import { DEFAULT_PIPELINE_STAGES } from './default-stages';");
    expect(src).toContain('create: DEFAULT_PIPELINE_STAGES.map((stage, order) => ({');
    expect(src).not.toMatch(/name: 'Screening'/);
  });

  it('keeps the stage-move suggestions working for the new names', () => {
    expect(getNextActionForStage('Preselección')?.labelKey).toBe('preseleccion');
    expect(getNextActionForStage('Oferta')?.labelKey).toBe('oferta');
    expect(getNextActionForStage('Contratado')?.labelKey).toBe('contratado');
  });
});

// E-21 / A-11: the toast after a move must not send the viewer somewhere they cannot go.
describe('stage-move next action for the viewer', () => {
  const grants = (allowed: string[]) => (module: string, action = 'read') => allowed.includes(`${module}:${action}`);

  it('drops "Iniciar el onboarding" for a recruiter without onboarding access', () => {
    const action = getNextActionForStage('Contratado');
    const recruiter = grants(['pipeline:read', 'candidate:read', 'offer:read', 'offer:create']);
    expect(visibleNextAction(action, 'pilot', { can: recruiter })).toBeNull();
  });

  it('keeps it for a user who can open onboarding', () => {
    const action = getNextActionForStage('Contratado');
    const admin = grants(['onboarding:read']);
    expect(visibleNextAction(action, 'pilot', { can: admin })).toEqual({ labelKey: 'contratado', href: '/people/onboarding' });
  });

  it('sends "Preparar la oferta" to the moved candidate profile (offers are created there)', () => {
    const action = getNextActionForStage('Oferta');
    const recruiter = grants(['candidate:read', 'offer:create']);
    expect(visibleNextAction(action, 'pilot', { can: recruiter, candidateId: 'cand-1' })).toEqual({
      labelKey: 'oferta',
      href: '/recruitment/candidates/cand-1',
    });
  });

  it('drops the offer suggestion for a viewer who cannot create offers', () => {
    const action = getNextActionForStage('Oferta');
    expect(visibleNextAction(action, 'pilot', { can: grants(['candidate:read']), candidateId: 'cand-1' })).toBeNull();
  });

  it('still behaves as before when no viewer context is given', () => {
    const action = getNextActionForStage('Contratado');
    expect(visibleNextAction(action, 'pilot')).toEqual(action);
  });
});

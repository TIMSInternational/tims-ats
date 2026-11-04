import { describe, expect, it } from 'vitest';
import { withoutCopiedSections } from '../../apps/web/app/(admin)/recruitment/vacancies/create-modal.helpers';
import { applyFilters, EMPTY_FILTERS } from '../../apps/web/app/(admin)/recruitment/pipeline/pipeline-filters';
import { DEFAULT_PIPELINE_STAGES } from '../../packages/api/src/routers/vacancy/default-stages';

// F-6: "Usar" on the AI formal variant copied responsibilities/requirements/benefits into their own fields
// AND kept them inside "Sobre el cargo", so the saved description listed them twice.
const sections = { responsibilities: ['Conciliar cuentas'], requirements: ['Contabilidad'], benefits: ['Seguro'] };

describe('withoutCopiedSections', () => {
  it('drops the three copied sections and keeps the opening', () => {
    const description = [
      '# Analista Financiero',
      '',
      'Buscamos una persona analista para el área de finanzas.',
      '',
      '## Responsabilidades',
      '- Conciliar cuentas',
      '## Requisitos',
      '- Contabilidad',
      '**Beneficios:**',
      '- Seguro',
    ].join('\n');
    expect(withoutCopiedSections(description, sections)).toBe(
      '# Analista Financiero\n\nBuscamos una persona analista para el área de finanzas.',
    );
  });

  it('keeps every other section and its text, including several introductory ones (Codex P2)', () => {
    const description = [
      '# Analista',
      '',
      '## Sobre la empresa',
      'Somos una cooperativa.',
      '',
      '## Sobre el cargo',
      'Trabajo de campo obligatorio.',
      '',
      '## Responsabilidades',
      '- Conciliar cuentas',
    ].join('\n');
    const result = withoutCopiedSections(description, sections);
    expect(result).toContain('Somos una cooperativa.');
    expect(result).toContain('Trabajo de campo obligatorio.');
    expect(result).not.toContain('Conciliar cuentas');
  });

  it('recognises plain "Requisitos:" label lines too (Codex P2)', () => {
    expect(withoutCopiedSections('Buscamos analista.\n\nResponsabilidades:\n- Conciliar cuentas.', sections)).toBe(
      'Buscamos analista.',
    );
  });

  it('keeps the lines of a section that were NOT copied into its field, under their heading (Codex P2 round 2)', () => {
    const description = 'Intro.\n\n## Requisitos\n- Contabilidad\n- Colegiatura obligatoria\n\n## Beneficios\n- Seguro';
    expect(withoutCopiedSections(description, sections)).toBe('Intro.\n\n## Requisitos\n- Colegiatura obligatoria');
  });

  it('keeps a section whose structured field came back empty (nothing was copied for it)', () => {
    const noBenefits = { ...sections, benefits: [] };
    const result = withoutCopiedSections('Intro.\n\n## Beneficios\n- Seguro médico', noBenefits);
    expect(result).toBe('Intro.\n\n## Beneficios\n- Seguro médico');
  });
});

// Codex P2: the new default Oferta/Contratado stages carry no SLA; the "SLA vencido" filter must not list them.
describe('pipeline "SLA vencido" filter with the default stages', () => {
  it('shows nothing from a stage without an SLA', () => {
    const stages = DEFAULT_PIPELINE_STAGES.map((s, order) => ({
      id: `s${order}`,
      name: s.name,
      order,
      slaHours: s.slaHours,
      applications: [
        {
          id: `a${order}`,
          source: 'portal',
          appliedAt: new Date(Date.now() - 400 * 3600000).toISOString(),
          enteredStageAt: new Date(Date.now() - 400 * 3600000).toISOString(),
          candidate: { fitScores: [] },
        },
      ],
    }));
    const filtered = applyFilters(stages, { ...EMPTY_FILTERS, slaOnly: true });
    const withApps = filtered.filter((s) => s.applications.length > 0).map((s) => s.name);
    expect(withApps).not.toContain('Oferta');
    expect(withApps).not.toContain('Contratado');
    expect(withApps).toContain('Preselección'); // 400 h > its 120 h SLA
  });

  it('still treats a 0-hour SLA as a real SLA (Codex P2 round 2)', () => {
    const stage = {
      id: 's0',
      name: 'Llamada',
      order: 0,
      slaHours: 0,
      applications: [
        {
          id: 'a0',
          source: 'portal',
          appliedAt: new Date(Date.now() - 3600000).toISOString(),
          enteredStageAt: new Date(Date.now() - 3600000).toISOString(),
          candidate: { fitScores: [] },
        },
      ],
    };
    expect(applyFilters([stage], { ...EMPTY_FILTERS, slaOnly: true })[0]!.applications).toHaveLength(1);
  });
});

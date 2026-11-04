import { describe, expect, it } from 'vitest';
import { formalDescriptionIntro } from '../../apps/web/app/(admin)/recruitment/vacancies/create-modal.helpers';

// F-6: "Usar" on the AI formal variant filled the sections into their own fields AND kept them inside
// "Sobre el cargo", so the saved description listed Responsabilidades/Requisitos/Beneficios twice.
const sections = { responsibilities: ['Conciliar cuentas'], requirements: ['Contabilidad'], benefits: ['Seguro'] };

describe('formalDescriptionIntro', () => {
  it('keeps only the opening of a markdown description with section headings', () => {
    const description = [
      '# Analista Financiero',
      '',
      'Buscamos una persona analista para el área de finanzas.',
      'Trabajará con el equipo contable.',
      '',
      '## Responsabilidades',
      '- Conciliar cuentas',
      '## Requisitos',
      '- Contabilidad',
    ].join('\n');
    expect(formalDescriptionIntro(description, sections)).toBe(
      'Buscamos una persona analista para el área de finanzas.\nTrabajará con el equipo contable.',
    );
  });

  it('stops at a bold heading or a list too', () => {
    expect(formalDescriptionIntro('**Analista**\n\nIntro.\n\n**Responsabilidades:**\n- a', sections)).toBe('Intro.');
    expect(formalDescriptionIntro('Intro corta.\n- Conciliar cuentas', sections)).toBe('Intro corta.');
  });

  it('keeps the whole text when the variant came without sections', () => {
    const empty = { responsibilities: [], requirements: [], benefits: [] };
    expect(formalDescriptionIntro('Texto completo.\n- con lista', empty)).toBe('Texto completo.\n- con lista');
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownText } from '../../apps/web/components/markdown-text';
import { markdownToPlainText, parseMarkdownLite } from '../../apps/web/lib/markdown-lite';

const DESCRIPTION = [
  'Buscamos un analista con experiencia.',
  '',
  '**Responsabilidades:**',
  '- Liderar el equipo de **logística**',
  '- Reportar *semanalmente*',
  '',
  '## Beneficios',
  '1. Salud prepagada',
  '2. Bono anual',
  '',
  'Primera línea',
  'segunda línea',
].join('\n');

describe('MarkdownText', () => {
  it('renders bold, lists, headings and line breaks as elements, never raw asterisks', () => {
    const { container } = render(<MarkdownText source={DESCRIPTION} />);
    expect(container.textContent).not.toContain('**');
    expect(container.textContent).not.toMatch(/^- /m);
    const strong = [...container.querySelectorAll('strong')].map((node) => node.textContent);
    expect(strong).toEqual(['Responsabilidades:', 'logística']);
    expect(container.querySelector('em')?.textContent).toBe('semanalmente');
    expect([...container.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'Liderar el equipo de logística',
      'Reportar semanalmente',
    ]);
    expect([...container.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual([
      'Salud prepagada',
      'Bono anual',
    ]);
    expect(container.querySelector('h4')?.textContent).toBe('Beneficios');
    expect(container.querySelectorAll('br')).toHaveLength(1);
  });

  it('renders embedded HTML as literal text (no element, no handler)', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script> **<b>bold</b>**';
    const { container } = render(<MarkdownText source={attack} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('<script>alert(2)</script>');
    expect(container.querySelector('strong')?.textContent).toBe('<b>bold</b>');
  });

  it('does not treat a bold line as a bullet list', () => {
    expect(parseMarkdownLite('**Requisitos:**')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'strong', children: [{ type: 'text', text: 'Requisitos:' }] }]] },
    ]);
  });
});

describe('markdownToPlainText', () => {
  it('strips markdown syntax for single-line previews', () => {
    expect(markdownToPlainText(DESCRIPTION)).toBe(
      'Buscamos un analista con experiencia. Responsabilidades: Liderar el equipo de logística Reportar semanalmente Beneficios Salud prepagada Bono anual Primera línea segunda línea',
    );
  });
});

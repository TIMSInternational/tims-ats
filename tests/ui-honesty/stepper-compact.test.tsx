import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// The consent guide's step names are long ("Consentimiento para el uso de inteligencia artificial..."): in the
// labelled Stepper they were cut to "N..." inside the portal card. The compact variant never truncates a label.

vi.mock('../../apps/web/lib/i18n', async (orig) => ({
  ...(await orig<typeof import('../../apps/web/lib/i18n')>()),
  useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }),
}));

const steps = ['Aviso', 'Consentimiento para la evaluación', 'Consentimiento para grabar su voz', 'Empezar'];

describe('Stepper compact variant', () => {
  it('shows the position and the full current label on one line at every width, and no truncated labels', async () => {
    const { Stepper } = await import('../../apps/web/components/stepper');
    const { container } = render(<Stepper steps={steps} current={2} variant="compact" />);
    const line = screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes(steps[2]!));
    expect(line.className).not.toContain('sm:hidden');
    expect(container.querySelector('ol')!.className).not.toContain('hidden');
    expect(container.querySelector('.truncate')).toBeNull();
    // Every label stays available to assistive technology.
    for (const step of steps) expect(screen.getAllByText(step, { exact: false }).length).toBeGreaterThan(0);
  });

  it('keeps the default labelled layout unchanged', async () => {
    const { Stepper } = await import('../../apps/web/components/stepper');
    const { container } = render(<Stepper steps={steps} current={1} />);
    expect(container.querySelector('ol')!.className).toContain('hidden sm:flex');
    expect(container.querySelector('.truncate')).not.toBeNull();
  });
});

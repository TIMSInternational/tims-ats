import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { OfferLetter } from '../../apps/web/app/(admin)/recruitment/offers/_components/offer-letter';

describe('offer letter preview', () => {
  it('uses the actual organization and only configured employment terms', () => {
    const { container } = render(createElement(OfferLetter, {
      companyName: 'Example Company',
      offer: {
        candidate: { firstName: 'QA', lastName: 'Candidate' },
        vacancy: { title: 'QA role' },
        salary: 120000,
        currency: 'USD',
        startDate: new Date('2026-10-01T12:00:00Z'),
        contractType: 'Fixed term',
        benefits: null,
        terms: null,
        createdAt: new Date('2026-09-28T12:00:00Z'),
      },
    }));
    const html = container.innerHTML;

    expect(html).toContain('Example Company');
    expect(html).toContain('Salario base anual');
    expect(html).toContain('Fixed term');
    expect(html).not.toContain('TIMS International');
    expect(html).not.toContain('Mensual');
    expect(html).not.toContain('Presencial');
    expect(html).not.toContain('cinco (5)');
  });
});

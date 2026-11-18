import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { OpenVacanciesCard } from '../../apps/web/app/(admin)/dashboard/open-vacancies-card';

describe('OpenVacanciesCard', () => {
  it('shows the real open-vacancy count it is given', () => {
    render(<OpenVacanciesCard totalOpen={7} />);
    expect(screen.getByTestId('open-vacancies-total').textContent).toBe('7');
    expect(screen.getByRole('heading', { name: en.recruitingDashboard.openVacancies })).toBeTruthy();
  });

  it('shows 0 for an empty organization instead of substituting any figure', () => {
    render(<OpenVacanciesCard totalOpen={0} />);
    expect(screen.getByTestId('open-vacancies-total').textContent).toBe('0');
  });

  it('renders no number other than the real count (no invented per-dimension breakdown)', () => {
    const { container } = render(<OpenVacanciesCard totalOpen={3} />);
    const numbers = (container.textContent ?? '').match(/\d+/g) ?? [];
    expect(numbers).toEqual(['3']);
    // No dimension tabs either: there is no data source for them.
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).not.toContain(en.recruitingDashboard.vacanciesByDimension);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    assessment: {
      listPending: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: {
            items: [
              {
                id: 'a1',
                assignedAt: new Date(),
                candidate: { firstName: 'Ana', lastName: 'Pérez' },
                assessmentType: { name: 'DISC' },
              },
            ],
          },
        }),
      },
    },
    interview: {
      getPendingScorecards: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: [
            {
              role: 'lead',
              interview: { id: 'i1', candidate: { firstName: 'Luis', lastName: 'Gómez' }, vacancy: { title: 'Dev' } },
            },
          ],
        }),
      },
    },
  },
}));

import { AlertsPendingPanel } from '../../apps/web/app/(admin)/dashboard/alerts-pending-panel';

describe('pending alerts panel', () => {
  it('lists pending items without "coming soon" resend/remind buttons', () => {
    const { container } = render(<AlertsPendingPanel />);
    expect(container.textContent).toContain('Ana Pérez');
    expect(container.textContent).toContain('Luis Gómez');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

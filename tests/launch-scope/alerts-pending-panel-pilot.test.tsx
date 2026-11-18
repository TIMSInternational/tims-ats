import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Codex P2 on #398: the recruiter landing's pending panel queried and listed assessments, which are out of
// the pilot launch scope. Under pilot the assessment query is disabled and only pending scorecards show; an
// assessment failure can no longer hide the scorecards.

const q = vi.hoisted(() => ({
  assessmentOpts: [] as Array<{ enabled?: boolean } | undefined>,
  assessmentError: false,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    assessment: {
      listPending: {
        useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
          q.assessmentOpts.push(opts);
          const disabled = opts?.enabled === false;
          return {
            data: disabled
              ? undefined
              : {
                  items: [
                    {
                      id: 'a1',
                      candidate: { firstName: 'Ana', lastName: 'Mora' },
                      assessmentType: { name: 'Prueba X' },
                      assignedAt: new Date(),
                    },
                  ],
                },
            isLoading: false,
            isError: !disabled && q.assessmentError,
            refetch: vi.fn(),
          };
        },
      },
    },
    interview: {
      getPendingScorecards: {
        useQuery: () => ({
          data: [
            {
              interview: {
                id: 'i1',
                candidate: { firstName: 'Luis', lastName: 'Soto' },
                vacancy: { title: 'Analista' },
              },
              role: 'lead',
            },
          ],
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { AlertsPendingPanel } from '../../apps/web/app/(admin)/dashboard/alerts-pending-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  q.assessmentOpts.length = 0;
  q.assessmentError = false;
});

describe('AlertsPendingPanel launch scope', () => {
  it('under pilot: assessment query disabled, no assessment listed, scorecards shown', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    render(<AlertsPendingPanel />);
    expect(q.assessmentOpts.every((o) => o?.enabled === false)).toBe(true);
    expect(screen.queryByText(/Prueba X/)).toBeNull();
    expect(screen.getByText(/Luis Soto/)).toBeTruthy();
  });

  it('under pilot: an assessment failure cannot hide the scorecards', () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    q.assessmentError = true;
    render(<AlertsPendingPanel />);
    expect(screen.getByText(/Luis Soto/)).toBeTruthy();
  });

  it('full scope: assessments still listed', () => {
    render(<AlertsPendingPanel />);
    expect(screen.getByText(/Prueba X/)).toBeTruthy();
    expect(screen.getByText(/Luis Soto/)).toBeTruthy();
  });
});

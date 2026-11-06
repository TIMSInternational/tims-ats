import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

// Pilot UX audit B-27: a pending-scorecard to-do opens that interview's room (scoring stage), not the
// interviews list; and it is a full document load, because the room needs its own route's CSP.

const INTERVIEW_ID = '55555555-5555-4555-8555-555555555555';
const ROWS = [
  {
    id: 'eval-1',
    interviewId: INTERVIEW_ID,
    interview: { candidate: { firstName: 'María', lastName: 'Pérez' }, vacancy: { title: 'Data Analyst' } },
  },
];

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    interview: {
      getPendingScorecards: { useQuery: () => ({ data: ROWS, isLoading: false, isError: false }) },
      // The committee landing also lists upcoming panels (B-29, interviews WP); none here.
      list: { useQuery: () => ({ data: { items: [] }, isLoading: false, isError: false }) },
    },
  },
}));

import { CommitteeTasksDashboard } from '../../apps/web/app/(admin)/dashboard/committee-tasks-dashboard';
import { ScorecardsToSubmitPanel } from '../../apps/web/app/(admin)/dashboard/manager-todos';

const ROOM = `/recruitment/interviews/${INTERVIEW_ID}/room`;

describe('pending-scorecard to-dos link to the interview room', () => {
  it('committee landing', () => {
    render(<CommitteeTasksDashboard isPilot />);
    expect(screen.getByRole('link', { name: /María Pérez/ })).toHaveAttribute('href', ROOM);
  });

  it('leader landing', () => {
    render(<ScorecardsToSubmitPanel data={ROWS as never} isLoading={false} isError={false} />);
    expect(screen.getByRole('link', { name: /María Pérez/ })).toHaveAttribute('href', ROOM);
  });
});

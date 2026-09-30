import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

type Row = { id: string; type: string; meetingUrl: string | null };
const rows = vi.hoisted(() => ({ value: [] as Row[] }));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidatePortal: {
      myInterviews: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: rows.value.map((row) => ({
            ...row,
            status: 'scheduled',
            scheduledAt: '2026-10-01T15:00:00.000Z',
            duration: 60,
            location: null,
            vacancy: { title: `Vacancy ${row.id}` },
          })),
        }),
      },
    },
  },
}));

import { DashboardInterviews } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-interviews';

function renderRows(value: Row[]) {
  rows.value = value;
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <DashboardInterviews orgSlug="acme" />
    </I18nProvider>,
  );
}

describe('candidate dashboard — interview join', () => {
  it('never links the private Daily room of a video interview; points to the emailed link instead', () => {
    renderRows([
      { id: 'a', type: 'video', meetingUrl: 'https://tims.daily.co/tims-1234abcd' },
      { id: 'b', type: 'video', meetingUrl: null },
    ]);
    expect(screen.queryByRole('link', { name: en.portalDashboard.intJoin })).toBeNull();
    expect(screen.getAllByText(en.portalDashboard.intJoinViaEmail)).toHaveLength(2);
    expect(document.body.innerHTML).not.toContain('daily.co');
  });

  it('keeps the Join button for an external meeting link', () => {
    renderRows([{ id: 'c', type: 'video', meetingUrl: 'https://zoom.us/j/123' }]);
    expect(screen.getByRole('link', { name: en.portalDashboard.intJoin })).toHaveAttribute(
      'href',
      'https://zoom.us/j/123',
    );
    expect(screen.queryByText(en.portalDashboard.intJoinViaEmail)).toBeNull();
  });
});

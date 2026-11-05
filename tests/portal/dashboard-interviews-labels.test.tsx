import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// C-03: the portal showed the raw enum ("Onsite", "Technical"). C-02: a pasted Teams link was shown as an
// in-person interview, with the long URL repeated as "Ubicación".

type Row = { id: string; type: string; meetingUrl: string | null; location: string | null };
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
            scheduledAt: '2026-11-10T16:00:00.000Z',
            duration: 60,
            vacancy: { title: `Vacante ${row.id}` },
          })),
        }),
      },
    },
  },
}));

import { DashboardInterviews } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-interviews';

function renderRows(value: Row[]) {
  rows.value = value;
  localStorage.setItem('tims-locale', 'ES');
  return render(
    <I18nProvider>
      <DashboardInterviews orgSlug="acme" />
    </I18nProvider>,
  );
}

const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x';

describe('candidate dashboard — interview labels', () => {
  it('shows the Spanish type, never the raw enum', () => {
    renderRows([
      { id: 'a', type: 'onsite', meetingUrl: null, location: 'Oficinas centrales, San José' },
      { id: 'b', type: 'technical', meetingUrl: null, location: null },
      { id: 'c', type: 'legacy-unknown', meetingUrl: null, location: null },
    ]);
    expect(screen.getByText(es.portalDashboard.intTypeOnsite)).toBeInTheDocument();
    expect(screen.getByText(es.portalDashboard.intTypeTechnical)).toBeInTheDocument();
    expect(screen.getByText(es.portalDashboard.intTypeOther)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/onsite|technical|legacy-unknown/i);
  });

  it('a pasted Teams link reads "En línea", is not repeated as the location, and offers the join button', () => {
    renderRows([{ id: 'a', type: 'onsite', meetingUrl: TEAMS, location: TEAMS }]);
    expect(screen.getByText(es.portalDashboard.intTypeOnline)).toBeInTheDocument();
    expect(screen.queryByText(es.portalDashboard.intTypeOnsite)).toBeNull();
    expect(screen.queryByText(new RegExp(`${es.portalDashboard.intLocation}:`))).toBeNull();
    expect(screen.getByRole('link', { name: es.portalDashboard.intJoin })).toHaveAttribute('href', TEAMS);
  });

  it('a content type with a link says it is online', () => {
    renderRows([{ id: 'a', type: 'technical', meetingUrl: TEAMS, location: TEAMS }]);
    expect(
      screen.getByText(`${es.portalDashboard.intTypeTechnical} (${es.portalDashboard.intTypeOnlineSuffix})`),
    ).toBeInTheDocument();
  });

  it('a real place is kept, and long values wrap on a phone', () => {
    renderRows([{ id: 'a', type: 'onsite', meetingUrl: null, location: 'Oficinas centrales, San José' }]);
    const place = screen.getByText(/Oficinas centrales, San José/);
    expect(place.className).toContain('break-all');
  });

  it('portal interview copy addresses the candidate as usted', () => {
    const p = es.portalDashboard;
    for (const text of [p.intLoading, p.intError, p.intEmpty, p.intJoinViaEmail]) {
      expect(text).not.toMatch(/\btus?\b|\btienes\b|\bingresa\b/i);
    }
  });
});

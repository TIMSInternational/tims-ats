import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewDetail } from '../../apps/web/lib/trpc-types';

// B-28: a committee panelist holds interview grants only. "View candidate profile" / "View vacancy"
// opened "Acceso denegado"; the room no longer offers links the viewer cannot open.

const grants = vi.hoisted(() => ({ value: new Set<string>() }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: (module: string, action = 'read') => grants.value.has(`${module}:${action}`) }),
}));

import { CandidateTab } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/candidate-tab';

const interview = {
  id: 'i1',
  type: 'online',
  scheduledAt: new Date('2026-11-10T16:00:00Z'),
  duration: 60,
  candidate: { id: 'cand-1', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: null, avatar: null },
  vacancy: { id: 'vac-1', title: 'Analista de Datos' },
} as unknown as InterviewDetail;

function renderTab() {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <CandidateTab interview={interview} candidateInitials="AR" />
    </I18nProvider>,
  );
}

describe('interview room candidate tab — links follow permissions', () => {
  it('a panelist with interview grants only sees the facts but no dead links', () => {
    grants.value = new Set(['interview:read', 'interview:create', 'interview:update']);
    renderTab();
    expect(screen.getByText('Analista de Datos')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: en.interviewRoom.candidateViewProfile })).toBeNull();
    expect(screen.queryByRole('link', { name: en.interviewRoom.candidateViewVacancy })).toBeNull();
    expect(screen.getByText(new RegExp(en.interviews.typeOnline))).toBeInTheDocument();
  });

  it('a recruiter keeps both links', () => {
    grants.value = new Set(['interview:read', 'candidate:read', 'vacancy:read']);
    renderTab();
    expect(screen.getByRole('link', { name: en.interviewRoom.candidateViewProfile })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.interviewRoom.candidateViewVacancy })).toBeInTheDocument();
  });
});

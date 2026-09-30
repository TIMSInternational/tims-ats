import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { InterviewDetail } from '../../apps/web/lib/trpc-types';
import { CandidateTab } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/candidate-tab';

// F4 — the "Candidato" tab was a placeholder ("information will load from the profile").

const interview = {
  id: 'i1',
  type: 'technical',
  scheduledAt: new Date('2026-09-30T15:00:00Z'),
  duration: 60,
  candidate: { id: 'cand-1', firstName: 'Ana', lastName: 'Ruiz', email: 'ana@example.com', phone: null, avatar: null },
  vacancy: { id: 'vac-1', title: 'Analista de Datos' },
} as unknown as InterviewDetail;

describe('interview room candidate tab', () => {
  it('shows real candidate facts and links, with no placeholder copy', () => {
    localStorage.setItem('tims-locale', 'EN');
    render(
      <I18nProvider>
        <CandidateTab interview={interview} candidateInitials="AR" />
      </I18nProvider>,
    );
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ana@example.com' })).toHaveAttribute('href', 'mailto:ana@example.com');
    expect(screen.getByText(en.interviewRoom.notProvided)).toBeInTheDocument();
    expect(screen.getByText('Analista de Datos')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${en.interviews.typeTechnical} · .* · 60 min`))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.interviewRoom.candidateViewProfile })).toHaveAttribute(
      'href',
      '/recruitment/candidates/cand-1',
    );
    expect(screen.getByRole('link', { name: en.interviewRoom.candidateViewVacancy })).toHaveAttribute(
      'href',
      '/recruitment/vacancies/vac-1',
    );
    // The removed placeholder copy (es + en).
    expect(document.body.textContent).not.toMatch(/se cargará desde su perfil|be loaded from their profile/i);
  });
});

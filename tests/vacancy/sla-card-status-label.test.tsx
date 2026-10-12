import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { SlaCard } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/sla-card';
import { vacancyStatusLabel } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/vacancy-status-label';
import type { VacancyDetail } from '../../apps/web/lib/trpc-types';

function vacancy(status: string): VacancyDetail {
  return {
    status,
    positions: 2,
    settings: { slaTargetDays: 30 },
    createdAt: new Date().toISOString(),
  } as unknown as VacancyDetail;
}

describe('vacancy SLA panel — status label', () => {
  it('shows the translated label, never the raw "published" string (audit 2026-10-10)', () => {
    render(<SlaCard vacancy={vacancy('published')} />);
    expect(screen.getByText('Publicada')).toBeTruthy();
    expect(screen.queryByText('published')).toBeNull();
  });

  it.each([
    ['draft', 'Borrador', 'Draft'],
    ['pending_approval', es.vacancies.statusPendingApproval, en.vacancies.statusPendingApproval],
    ['approved', 'Aprobada', en.vacancies.statusApproved],
    ['published', 'Publicada', en.vacancies.statusPublished],
    ['closed', 'Cerrada', en.vacancies.statusClosed],
    ['frozen', 'Congelada', en.vacancies.statusFrozen],
  ])('maps %s for es and en', (status, esLabel, enLabel) => {
    expect(vacancyStatusLabel(status, es.vacancies)).toBe(esLabel);
    expect(vacancyStatusLabel(status, en.vacancies)).toBe(enLabel);
    expect(vacancyStatusLabel(status, en.vacancies)).not.toBe(status);
  });

  it('passes an unknown legacy status through as stored', () => {
    expect(vacancyStatusLabel('archived_legacy', es.vacancies)).toBe('archived_legacy');
  });
});

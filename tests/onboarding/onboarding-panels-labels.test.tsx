import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import type { OnboardingPlan } from '../../apps/web/app/(admin)/people/onboarding/onboarding-table';
import { PendingTasks, TasksByResponsible } from '../../apps/web/app/(admin)/people/onboarding/onboarding-panels';

// The admin onboarding panels must never show a raw owner slug (hr, it,
// employee...). Owner colors are keyed on the slugs, so a slug-keyed task must
// get its own color, not the gray fallback. Free-text owners typed by HR pass through.

function task(id: string, responsible: string, completed = false) {
  return { id, title: `Task ${id}`, completed, responsible, phase: 'day1_30' };
}

const plan: OnboardingPlan = {
  id: 'plan-1',
  status: 'active',
  phase: 'day1_30',
  riskScore: 0,
  startDate: '2026-10-01',
  completedAt: null,
  user: { id: 'user-1', firstName: 'Ana', lastName: 'Lopez', avatar: null },
  buddy: null,
  tasks: [task('1', 'hr'), task('2', 'employee', true), task('3', 'it'), task('4', 'Equipo legal')],
  checkIns: [],
} as OnboardingPlan;

function renderEs(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('onboarding admin panels — owner labels', () => {
  it('TasksByResponsible labels slugs, keeps free text, and colors by slug', () => {
    renderEs(<TasksByResponsible plans={[plan]} />);
    expect(screen.getByText('RRHH')).toBeInTheDocument();
    expect(screen.getByText('Nuevo colaborador')).toBeInTheDocument();
    expect(screen.getByText('TI')).toBeInTheDocument();
    expect(screen.getByText('Equipo legal')).toBeInTheDocument();
    for (const slug of ['hr', 'employee', 'it']) {
      expect(screen.queryByText(slug, { exact: true })).not.toBeInTheDocument();
    }
    const hrDot = screen.getByText('RRHH').querySelector('span');
    expect(hrDot?.className).toContain('bg-[#1F114C]');
    const freeTextDot = screen.getByText('Equipo legal').querySelector('span');
    expect(freeTextDot?.className).toContain('bg-gray-500');
    expect(screen.getByText('1/1 completadas')).toBeInTheDocument();
  });

  it('PendingTasks shows the owner label, not the slug', () => {
    renderEs(<PendingTasks plans={[plan]} />);
    expect(screen.getByText('Ana Lopez — RRHH')).toBeInTheDocument();
    expect(screen.getByText('Ana Lopez — TI')).toBeInTheDocument();
    expect(screen.queryByText('Ana Lopez — hr')).not.toBeInTheDocument();
  });
});

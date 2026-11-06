import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// journeys-23 / spec-39: the vacancy detail had no way to fix a typo, a salary band or the hiring manager
// (vacancy.update had no caller). A-08: a frozen vacancy had no way back. B-10: a leader's draft request gave
// the leader no hint of what happens next.

const VACANCY = '77777777-7777-4777-8777-777777777777';
const m = vi.hoisted(() => ({
  update: vi.fn(),
  freeze: vi.fn(),
  resume: vi.fn(),
  grants: new Set<string>(),
}));
const idle = vi.hoisted(() => () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: (mod: string, action = 'read') => m.grants.has(`${mod}:${action}`), userId: 'me' }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      vacancy: {
        getById: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
        getDashboardKpis: { invalidate: vi.fn() },
      },
    }),
    vacancy: {
      update: { useMutation: () => ({ ...idle(), mutate: m.update }) },
      freeze: { useMutation: () => ({ ...idle(), mutate: m.freeze }) },
      resume: { useMutation: () => ({ ...idle(), mutate: m.resume }) },
      generateDescription: { useMutation: idle },
      submitForApproval: { useMutation: idle },
      approve: { useMutation: idle },
      reject: { useMutation: idle },
      withdrawApproval: { useMutation: idle },
    },
  },
}));
vi.mock('../../apps/web/components/user-picker', () => ({
  UserPicker: ({
    onSelect,
  }: {
    onSelect: (id: string, u: { id: string; firstName: string; lastName: string }) => void;
  }) => (
    <button type="button" onClick={() => onSelect('leader-1', { id: 'leader-1', firstName: 'Lía', lastName: 'Líder' })}>
      pick-leader
    </button>
  ),
}));
vi.mock('../../apps/web/app/(admin)/recruitment/vacancies/[id]/submit-approval-modal', () => ({
  SubmitApprovalModal: () => null,
}));

import { VacancyLifecycleActions } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/vacancy-lifecycle-actions';
import { ApprovalChain } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/approval-chain';
import {
  buildVacancyPatch,
  initialEditForm,
  validateEditForm,
  type EditableVacancy,
} from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/edit-vacancy-form';
import type { VacancyDetail } from '../../apps/web/lib/trpc-types';

const editable: EditableVacancy = {
  title: 'Analista de datos',
  description: 'Sobre el cargo',
  location: 'San José, Costa Rica',
  remotePolicy: 'hybrid',
  contractType: 'indefinido',
  positions: 2,
  priority: 'high',
  salary: { min: 850000, max: 1200000, currency: 'CRC', period: 'monthly' },
  assignee: null,
};

function detail(status: string): VacancyDetail {
  return { id: VACANCY, status, ...editable } as unknown as VacancyDetail;
}

beforeEach(() => {
  m.update.mockReset();
  m.freeze.mockReset();
  m.resume.mockReset();
  m.grants = new Set(['vacancy:read', 'vacancy:update', 'vacancy:publish']);
});

describe('edit form helpers', () => {
  it('sends nothing when nothing changed, and only the changed fields otherwise', () => {
    const initial = initialEditForm(editable);
    expect(buildVacancyPatch(initial, initial)).toBeNull();
    expect(buildVacancyPatch(initial, { ...initial, title: '  Analista Sr ' })).toEqual({ title: 'Analista Sr' });
    expect(buildVacancyPatch(initial, { ...initial, location: '   ' })).toEqual({ location: null });
  });

  it('sends the whole salary band (with its currency) only when it was touched', () => {
    const initial = initialEditForm(editable);
    expect(buildVacancyPatch(initial, { ...initial, salaryMax: '1300000' })).toEqual({
      salary: { min: 850000, max: 1300000, currency: 'CRC', period: 'monthly' },
    });
  });

  it('sets or clears the hiring manager', () => {
    const initial = initialEditForm(editable);
    const leader = { id: 'leader-1', firstName: 'Lía', lastName: 'Líder' };
    expect(buildVacancyPatch(initial, { ...initial, hiringManager: leader })).toEqual({ assignedTo: 'leader-1' });
    const withManager = initialEditForm({ ...editable, assignee: leader });
    expect(buildVacancyPatch(withManager, { ...withManager, hiringManager: null })).toEqual({ assignedTo: null });
  });

  it('defaults a missing currency to the tenant currency and reads a stored annual period as yearly', () => {
    const form = initialEditForm({ ...editable, salary: { min: 1, period: 'annual' } });
    expect(form.currency).toBe('CRC');
    expect(form.salaryPeriod).toBe('yearly');
    expect(initialEditForm({ ...editable, salary: null }).salaryMin).toBe('');
  });

  it('validates the title and the salary band', () => {
    const initial = initialEditForm(editable);
    expect(validateEditForm(initial, { ...initial, title: ' ' })).toBe('titleRequired');
    expect(validateEditForm(initial, { ...initial, salaryMin: '1.200.000' })).toBe('salaryInvalid');
    expect(validateEditForm(initial, { ...initial, salaryMin: '1.200' })).toBe('salaryInvalid');
    expect(validateEditForm(initial, { ...initial, salaryMin: '2000000' })).toBe('salaryRange');
    expect(validateEditForm(initial, { ...initial, salaryMin: '850000.50' })).toBeNull();
    expect(validateEditForm(initial, initial)).toBeNull();
  });

  // Codex P2: a stored decimal (the API accepts any non-negative number) must not block a title-only edit.
  it('never lets an untouched stored salary block an unrelated edit', () => {
    const initial = initialEditForm({ ...editable, salary: { min: 1500.5, max: 900, currency: 'CRC', period: 'monthly' } });
    const titleOnly = { ...initial, title: 'Analista Sr' };
    expect(validateEditForm(initial, titleOnly)).toBeNull();
    expect(buildVacancyPatch(initial, titleOnly)).toEqual({ title: 'Analista Sr' });
  });
});

describe('vacancy detail lifecycle actions', () => {
  it('"Editar" opens a drawer that saves only the changed fields through vacancy.update', () => {
    render(<VacancyLifecycleActions vacancy={detail('published')} />);
    fireEvent.click(screen.getByRole('button', { name: es.vacancies.editVacancy }));
    const drawer = screen.getByRole('dialog', { name: es.vacancies.editVacancyTitle });
    expect(within(drawer).getByText(es.vacancies.editPublishedNotice)).toBeInTheDocument();
    const save = within(drawer).getByRole('button', { name: es.vacancies.editSave });
    expect(save).toBeDisabled(); // nothing changed yet

    fireEvent.change(within(drawer).getByLabelText(es.vacancies.titleField), { target: { value: 'Analista Sr' } });
    fireEvent.click(within(drawer).getByRole('button', { name: es.vacancies.pickHiringManager }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'pick-leader' }));
    fireEvent.click(save);
    expect(m.update).toHaveBeenCalledWith({ id: VACANCY, title: 'Analista Sr', assignedTo: 'leader-1' });
  });

  it('blocks a salary band whose minimum is above its maximum', () => {
    render(<VacancyLifecycleActions vacancy={detail('draft')} />);
    fireEvent.click(screen.getByRole('button', { name: es.vacancies.editVacancy }));
    fireEvent.change(screen.getByLabelText(es.vacancies.salaryMin), { target: { value: '5000000' } });
    expect(screen.getByRole('alert')).toHaveTextContent(es.vacancies.editSalaryRange);
    expect(screen.getByRole('button', { name: es.vacancies.editSave })).toBeDisabled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('offers no "Editar" while the vacancy is pending approval or closed, nor without vacancy:update', () => {
    const pending = render(<VacancyLifecycleActions vacancy={detail('pending_approval')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.editVacancy })).toBeNull();
    pending.unmount();
    const closed = render(<VacancyLifecycleActions vacancy={detail('closed')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.editVacancy })).toBeNull();
    closed.unmount();
    m.grants = new Set(['vacancy:read']);
    render(<VacancyLifecycleActions vacancy={detail('draft')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.editVacancy })).toBeNull();
  });

  it('freezes a published vacancy and resumes a frozen one, each after a confirmation', () => {
    const published = render(<VacancyLifecycleActions vacancy={detail('published')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.resumeVacancy })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: es.vacancies.freezeVacancy }));
    expect(m.freeze).not.toHaveBeenCalled();
    expect(screen.getByText(es.vacancies.confirmFreezeDesc)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: es.vacancies.freezeVacancy }));
    expect(m.freeze).toHaveBeenCalledWith({ id: VACANCY });
    published.unmount();

    render(<VacancyLifecycleActions vacancy={detail('frozen')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.freezeVacancy })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: es.vacancies.resumeVacancy }));
    expect(screen.getByText(es.vacancies.confirmResumeDesc)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: es.vacancies.resumeVacancy }));
    expect(m.resume).toHaveBeenCalledWith({ id: VACANCY });
  });

  it('does not offer "Reanudar" without vacancy:publish (the server requires it)', () => {
    m.grants = new Set(['vacancy:read', 'vacancy:update']);
    render(<VacancyLifecycleActions vacancy={detail('frozen')} />);
    expect(screen.queryByRole('button', { name: es.vacancies.resumeVacancy })).toBeNull();
  });
});

describe('approval chain hints on a draft', () => {
  const rejected = {
    id: 'a-1',
    step: 1,
    status: 'rejected',
    comment: 'Ajustar la banda salarial',
    decidedAt: new Date('2026-11-03T15:00:00Z'),
    approver: { id: 'boss', firstName: 'Ana', lastName: 'Aprobadora', avatar: null },
  };

  it('tells the submitter to edit and resubmit after a rejection', () => {
    render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="draft" approvals={[rejected]} />);
    expect(screen.getByText(es.vacancies.rejectedEditHint)).toBeInTheDocument();
  });

  it('tells a requester who cannot submit (a leader) who moves the draft on', () => {
    m.grants = new Set(['vacancy:read', 'vacancy:create']);
    render(<ApprovalChain vacancyId={VACANCY} vacancyStatus="draft" approvals={[]} />);
    expect(screen.getByText(es.vacancies.draftAwaitingHr)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.vacancies.submitForApproval })).toBeNull();
  });
});

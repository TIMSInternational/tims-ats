import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

// "Competencias del puesto" in the creation wizard (step 2, under "Generar con IA") and in the "Editar"
// drawer: catalog + custom rows, level, reorder, remove, AI suggestions to accept — optional, never blocking.

delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;
delete process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP;

type Opts = { onSuccess?: (d: unknown) => void; onError?: (e: unknown) => void };
const m = vi.hoisted(() => ({
  generate: vi.fn(),
  generateOpts: [] as Opts[],
  update: vi.fn(),
  grants: new Set<string>(['vacancy:read', 'vacancy:update', 'vacancy:create']),
}));
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({ can: (mod: string, action = 'read') => m.grants.has(`${mod}:${action}`), userId: 'me' }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ vacancy: { getById: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    organization: {
      listCompanies: { useQuery: () => ok([]) },
      listTeams: { useQuery: () => ok(undefined) },
    },
    user: { list: { useQuery: () => ok({ users: [] }) } },
    vacancy: {
      generateDescription: {
        useMutation: (opts: Opts) => {
          m.generateOpts.push(opts);
          return { mutate: m.generate, isPending: false, isError: false, error: null };
        },
      },
      checkInclusiveLanguage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: m.update, isPending: false, error: null }) },
    },
  },
}));
vi.mock('../../apps/web/components/user-picker', () => ({ UserPicker: () => null }));

import { CreateModal } from '../../apps/web/app/(admin)/recruitment/vacancies/create-modal';
import { EditVacancyDrawer } from '../../apps/web/app/(admin)/recruitment/vacancies/[id]/edit-vacancy-drawer';
import {
  competenciesChanged,
  draftsFromStored,
  moveDraft,
  toCompetencyInput,
  validateCompetencyDrafts,
} from '../../apps/web/app/(admin)/recruitment/vacancies/competencies-model';

const v = es.vacancies;
const section = () => screen.getByRole('region', { name: v.competenciesSectionTitle });
const nextButton = () => screen.getByRole('button', { name: /Siguiente/ });

beforeEach(() => {
  m.generate.mockReset();
  m.update.mockReset();
  m.generateOpts = [];
  m.grants = new Set(['vacancy:read', 'vacancy:update', 'vacancy:create']);
});

function renderWizardAtStep2() {
  const onConfirm = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateModal onConfirm={onConfirm} onClose={() => {}} isPending={false} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText('Ej: Senior Software Engineer'), {
    target: { value: 'Ejecutivo de cuenta' },
  });
  fireEvent.click(nextButton());
  return onConfirm;
}

function finish() {
  fireEvent.click(nextButton());
  fireEvent.click(screen.getByRole('button', { name: v.createVacancySubmit }));
}

describe('wizard — Competencias del puesto', () => {
  it('is optional: no competencies, nothing sent, creation not blocked', () => {
    const onConfirm = renderWizardAtStep2();
    expect(within(section()).getByText(v.competenciesEmpty)).toBeInTheDocument();
    expect(nextButton()).not.toBeDisabled();
    finish();
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ competencies: undefined }));
  });

  it('adds from the catalog and custom, sets levels, reorders, removes — and sends them in that order', () => {
    const onConfirm = renderWizardAtStep2();
    const s = section();
    fireEvent.change(within(s).getByLabelText(v.competencyCatalogLabel), {
      target: { value: 'builtin:communication' },
    });
    fireEvent.click(within(s).getByRole('button', { name: v.competencyAddCustom }));
    // A blank custom row must be named (or removed) before moving on.
    expect(nextButton()).toBeDisabled();
    expect(within(s).getByRole('alert')).toHaveTextContent(v.competencyErrorName);
    const names = within(s).getAllByLabelText(v.competencyNameLabel);
    fireEvent.change(names[1]!, { target: { value: 'Negociación' } });
    fireEvent.change(within(s).getByLabelText(`${v.competencyLevelLabel}: Negociación`), { target: { value: '5' } });
    fireEvent.click(within(s).getByRole('button', { name: v.competencyMoveUp.replace('{name}', 'Negociación') }));
    fireEvent.change(within(s).getByLabelText(v.competencyCatalogLabel), { target: { value: 'builtin:integrity' } });
    fireEvent.click(
      within(s).getByRole('button', { name: v.competencyRemove.replace('{name}', v.competencyCatalog.integrity.name) }),
    );
    // The catalog row's name is the catalog's (read-only); the custom one is editable.
    expect(within(s).getAllByLabelText(v.competencyNameLabel)[1]).toHaveAttribute('readonly');
    expect(nextButton()).not.toBeDisabled();
    finish();
    expect(onConfirm.mock.calls[0]![0].competencies).toEqual([
      { name: 'Negociación', level: 5, scaleMax: 5 },
      {
        name: v.competencyCatalog.communication.name,
        description: v.competencyCatalog.communication.description,
        level: 3,
        scaleMax: 5,
        code: 'builtin:communication',
      },
    ]);
  });

  it('refuses repeated names until one is removed', () => {
    renderWizardAtStep2();
    const s = section();
    fireEvent.click(within(s).getByRole('button', { name: v.competencyAddCustom }));
    fireEvent.click(within(s).getByRole('button', { name: v.competencyAddCustom }));
    const names = within(s).getAllByLabelText(v.competencyNameLabel);
    fireEvent.change(names[0]!, { target: { value: 'Ventas' } });
    fireEvent.change(names[1]!, { target: { value: ' ventas ' } });
    expect(within(s).getByRole('alert')).toHaveTextContent(v.competencyErrorDuplicate);
    expect(nextButton()).toBeDisabled();
  });

  it('shows the AI suggestions from "Generar con IA" for review; accepting adds editable rows', () => {
    const onConfirm = renderWizardAtStep2();
    // The AI panel's mutation is registered first, the section's "Sugerir competencias" second.
    act(() => {
      m.generateOpts[0]!.onSuccess!({
        kind: 'variants',
        formal: { description: 'Formal', sections: { responsibilities: [], requirements: [], benefits: [] } },
        social: { description: 'S' },
        whatsapp: { description: 'W' },
        competencies: [
          { name: 'Orientación al cliente', description: 'Entiende al cliente', level: 4 },
          { name: 'Excel', description: 'Tablas', level: 2 },
        ],
        model: 'haiku',
        tokensUsed: 1,
      });
    });
    const s = section();
    const suggestions = within(s).getByRole('region', { name: v.competencySuggestionsTitle });
    // Nothing applied until accepted.
    expect(within(s).queryAllByLabelText(v.competencyNameLabel)).toHaveLength(0);
    fireEvent.click(
      within(suggestions).getByRole('button', { name: v.competencySuggestionAddNamed.replace('{name}', 'Excel') }),
    );
    expect(
      within(s)
        .getAllByLabelText(v.competencyNameLabel)
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Excel']);
    fireEvent.click(
      within(s).getByRole('button', { name: v.competencySuggestionAddNamed.replace('{name}', 'Orientación al cliente') }),
    );
    finish();
    expect(
      onConfirm.mock.calls[0]![0].competencies.map((c: { name: string; level: number }) => [c.name, c.level]),
    ).toEqual([
      ['Excel', 2],
      ['Orientación al cliente', 4],
    ]);
  });

  it('"Sugerir competencias" asks with the title and the description written so far', () => {
    renderWizardAtStep2();
    const areas = screen.getAllByRole('textbox').filter((el) => el.tagName === 'TEXTAREA');
    fireEvent.change(areas[0]!, { target: { value: 'Atiende cuentas corporativas' } });
    fireEvent.click(within(section()).getByRole('button', { name: v.competencySuggestAction }));
    expect(m.generate).toHaveBeenCalledWith({
      title: 'Ejecutivo de cuenta',
      mode: 'competencies',
      description: 'Atiende cuentas corporativas',
    });
    act(() => {
      m.generateOpts[1]!.onSuccess!({
        kind: 'competencies',
        competencies: [{ name: 'Negociación', description: 'd', level: 3 }],
      });
    });
    expect(within(section()).getByText('Negociación')).toBeInTheDocument();
  });
});

const EDITABLE = {
  title: 'Ejecutivo',
  description: 'Ventas',
  location: null,
  remotePolicy: 'hybrid',
  contractType: 'indefinido',
  positions: 1,
  priority: 'medium',
  salary: null,
  assignee: null,
};

describe('edit drawer — Competencias del puesto', () => {
  it('is seeded from the job profile and sends competencies only when they changed', () => {
    render(
      <EditVacancyDrawer
        vacancyId="v1"
        vacancyStatus="draft"
        vacancy={{
          ...EDITABLE,
          jobProfile: {
            competencies: [
              { name: 'SQL', level: 4 },
              { name: 'Excel', level: 2, scaleMax: 4 },
            ],
          },
        }}
        onClose={() => {}}
      />,
    );
    const s = section();
    expect(
      within(s)
        .getAllByLabelText(v.competencyNameLabel)
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(['SQL', 'Excel']);
    const save = screen.getByRole('button', { name: v.editSave });
    expect(save).toBeDisabled();
    fireEvent.change(within(s).getByLabelText(`${v.competencyLevelLabel}: Excel`), { target: { value: '3' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    expect(m.update).toHaveBeenCalledWith({
      id: 'v1',
      competencies: [
        { name: 'SQL', level: 4, scaleMax: 5 },
        { name: 'Excel', level: 3, scaleMax: 4 },
      ],
    });
  });

  it('does not resend competencies on an unrelated edit, and hides "Sugerir" without vacancy:create', () => {
    m.grants = new Set(['vacancy:read', 'vacancy:update']);
    render(
      <EditVacancyDrawer
        vacancyId="v1"
        vacancyStatus="draft"
        vacancy={{ ...EDITABLE, jobProfile: null }}
        onClose={() => {}}
      />,
    );
    expect(within(section()).queryByRole('button', { name: v.competencySuggestAction })).toBeNull();
    fireEvent.change(screen.getByDisplayValue('Ejecutivo'), { target: { value: 'Ejecutivo Sr' } });
    fireEvent.click(screen.getByRole('button', { name: v.editSave }));
    expect(m.update).toHaveBeenCalledWith({ id: 'v1', title: 'Ejecutivo Sr' });
  });
});

describe('competencies model', () => {
  it('round-trips stored rows, tracks changes by content and order, and validates', () => {
    const drafts = draftsFromStored([
      { name: 'A', level: 2 },
      { name: 'B', level: 4, scaleMax: 4, code: 'x:b', description: 'd' },
    ]);
    expect(toCompetencyInput(drafts)).toEqual([
      { name: 'A', level: 2, scaleMax: 5 },
      { name: 'B', level: 4, scaleMax: 4, code: 'x:b', description: 'd' },
    ]);
    expect(competenciesChanged(drafts, [...drafts])).toBe(false);
    expect(competenciesChanged(drafts, moveDraft(drafts, drafts[1]!.rowId, -1))).toBe(true);
    expect(validateCompetencyDrafts([])).toBeNull();
    expect(validateCompetencyDrafts([{ ...drafts[0]!, name: ' ' }])).toBe('nameRequired');
    expect(validateCompetencyDrafts([drafts[0]!, { ...drafts[1]!, name: 'a' }])).toBe('duplicate');
  });
});

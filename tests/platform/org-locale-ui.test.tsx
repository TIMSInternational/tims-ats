import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The organization's locale profile in the UI: the vacancy wizard defaults to the organization's currency
// (not the pilot's CRC), and the platform owner's edit sends only the profile keys that changed — the
// server merges them, so candidateContactEmail and every other settings key are kept.

delete process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP;
delete process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP;

const m = vi.hoisted(() => ({
  tenant: { currency: 'CRC', intlLocale: 'es-CR' },
  updateMutate: vi.fn(),
}));
vi.mock('../../apps/web/lib/tenant-locale-context', () => ({ useTenantLocale: () => m.tenant }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const invalidate = { invalidate: vi.fn() };
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      platform: { listOrganizations: invalidate, getOrganizationKpis: invalidate, getOrganization: invalidate },
    }),
    platform: {
      updateOrganization: { useMutation: () => ({ mutate: m.updateMutate, isPending: false, error: null }) },
      suspendOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    organization: {
      listCompanies: { useQuery: () => ok([]) },
      listTeams: { useQuery: () => ok(undefined) },
    },
    user: { list: { useQuery: () => ok({ users: [] }) } },
    vacancy: {
      generateDescription: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      checkInclusiveLanguage: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import es from '../../apps/web/lib/i18n/es.json';
import { orgLocaleFormFromOrg } from '../../apps/web/lib/org-locale-form';

beforeEach(() => {
  m.tenant = { currency: 'CRC', intlLocale: 'es-CR' };
  m.updateMutate.mockReset();
});

async function createVacancyWithSalary(): Promise<{ currency?: string } | undefined> {
  const { CreateModal } = await import('../../apps/web/app/(admin)/recruitment/vacancies/create-modal');
  const onConfirm = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateModal onConfirm={onConfirm} onClose={() => {}} isPending={false} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText('Ej: Senior Software Engineer'), { target: { value: 'Analista' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  fireEvent.change(screen.getByPlaceholderText(es.vacancies.salaryMinPlaceholder), { target: { value: '8000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear vacante' }));
  view.unmount();
  return onConfirm.mock.calls[0]?.[0]?.salary;
}

describe('vacancy wizard default currency', () => {
  it('is the organization currency (GTQ for a Guatemalan tenant)', async () => {
    m.tenant = { currency: 'GTQ', intlLocale: 'es-GT' };
    expect(await createVacancyWithSalary()).toMatchObject({ currency: 'GTQ' });
  });

  it('stays CRC for INVU / an organization without a profile', async () => {
    expect(await createVacancyWithSalary()).toMatchObject({ currency: 'CRC' });
  });
});

describe('platform owner edit of an existing organization', () => {
  const org = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Maquila',
    plan: 'trial',
    isActive: true,
    subscription: null,
  };
  // Created before profiles: empty settings except the contact mailbox; the company still has the old defaults.
  const localeInitial = orgLocaleFormFromOrg(
    { candidateContactEmail: 'talento@maquila.test' },
    { country: 'CR', currency: 'USD', timezone: 'America/Bogota' },
  );

  async function renderEdit(withLocale: boolean) {
    const { EditOrgModal } = await import('../../apps/web/app/(admin)/platform/organizations/edit-org-modal');
    const props = { org: org as never, onClose: () => {}, onSuccess: () => {} };
    return render(withLocale ? <EditOrgModal {...props} localeInitial={localeInitial} /> : <EditOrgModal {...props} />);
  }

  it('moving it to Guatemala sends only the four profile keys, as a patch (merged server-side)', async () => {
    const { container } = await renderEdit(true);
    fireEvent.change(screen.getByLabelText(/^País/), { target: { value: 'GT' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(m.updateMutate).toHaveBeenCalledExactlyOnceWith({
      id: org.id,
      name: 'Maquila',
      plan: 'trial',
      settings: { locale: 'es-GT', timezone: 'America/Guatemala', currency: 'GTQ', country: 'GT' },
    });
  });

  it('saving without touching the profile sends no settings at all (a rename stays a rename)', async () => {
    const { container } = await renderEdit(true);
    // Not required on the edit form: an old organization may have no locale yet.
    expect(screen.getByLabelText(/^Formato de números/)).not.toBeRequired();
    fireEvent.submit(container.querySelector('form')!);
    expect(m.updateMutate).toHaveBeenCalledExactlyOnceWith({ id: org.id, name: 'Maquila', plan: 'trial' });
  });

  it('an invalid change blocks saving', async () => {
    const { container } = await renderEdit(true);
    fireEvent.change(screen.getByLabelText(/^País/), { target: { value: 'OTHER' } });
    fireEvent.change(screen.getByLabelText(/^Código del país/), { target: { value: 'A' } });
    expect(screen.getByRole('alert')).toHaveTextContent(es.orgLocale.invalid);
    fireEvent.submit(container.querySelector('form')!);
    expect(m.updateMutate).not.toHaveBeenCalled();
  });

  it('from the organizations list (no profile passed) it edits name and plan only', async () => {
    await renderEdit(false);
    expect(screen.queryByLabelText(/^País/)).toBeNull();
  });
});

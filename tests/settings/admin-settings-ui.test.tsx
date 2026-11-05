/**
 * Admin settings UI — company-admin access-3 / ideal-78 (members table), D-16 (profile page), D-11
 * (organization data card).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { updateProfileSchema } from '@tims/shared';

const mocks = vi.hoisted(() => ({
  userId: 'me' as string | null,
  roles: ['super_admin'] as string[],
  canUpdate: true,
  canDelete: true,
  changeRole: vi.fn(),
  deactivate: vi.fn(),
  updateProfile: vi.fn(),
  setLocale: vi.fn(),
  toast: vi.fn(),
  profile: null as null | Record<string, unknown>,
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'ES', setLocale: mocks.setLocale }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({
    can: (module: string, action?: string) =>
      module === 'user' &&
      (action === 'read' || (action === 'update' && mocks.canUpdate) || (action === 'delete' && mocks.canDelete)),
    roles: mocks.roles,
    userId: mocks.userId,
    roleLabel: 'Super Administrador',
    isLoading: false,
  }),
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ user: { list: { invalidate: vi.fn() }, me: { invalidate: vi.fn() } } }),
    user: {
      list: {
        useInfiniteQuery: () => ({
          isLoading: false,
          isError: false,
          hasNextPage: false,
          data: {
            pages: [
              {
                users: [
                  {
                    id: 'me',
                    firstName: 'Ana',
                    lastName: 'Admin',
                    email: 'ana@x.test',
                    jobTitle: null,
                    userRoles: [{ role: { slug: 'super_admin' } }],
                  },
                  {
                    id: 'u2',
                    firstName: 'Rita',
                    lastName: 'Recluta',
                    email: 'rita@x.test',
                    jobTitle: 'Analista',
                    userRoles: [{ role: { slug: 'recruiter' } }],
                  },
                  {
                    id: 'u3',
                    firstName: 'Sofi',
                    lastName: 'Super',
                    email: 'sofi@x.test',
                    jobTitle: null,
                    userRoles: [{ role: { slug: 'super_admin' } }],
                  },
                ],
              },
            ],
          },
        }),
      },
      assignRole: { useMutation: () => ({ mutate: mocks.changeRole, isPending: false }) },
      deactivate: { useMutation: () => ({ mutate: mocks.deactivate, isPending: false }) },
      me: { useQuery: () => ({ isLoading: false, isError: false, data: mocks.profile, refetch: vi.fn() }) },
      updateProfile: { useMutation: () => ({ mutate: mocks.updateProfile, isPending: false }) },
    },
    organization: {
      getCurrent: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
          data: {
            id: 'o1',
            name: 'Organización Piloto',
            slug: 'piloto',
            logo: null,
            country: 'CR',
            currency: 'CRC',
            currencySource: 'organization',
            timeZone: 'America/Costa_Rica',
            timeZoneSource: 'organization',
            locale: 'es-CR',
            candidateContactEmail: null,
            candidateContactSource: null,
            companyName: 'Piloto S.A.',
          },
        }),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userId = 'me';
  mocks.roles = ['super_admin'];
  mocks.canUpdate = true;
  mocks.canDelete = true;
});

describe('members table (access-3 / ideal-78)', () => {
  async function renderTable() {
    const { MembersTable } = await import('../../apps/web/app/(admin)/settings/users/members-table');
    render(<MembersTable />);
  }
  const row = (email: string) => screen.getByText(email).closest('tr')!;

  it('shows every member role in Spanish and marks the signed-in admin', async () => {
    await renderTable();
    expect(screen.getByRole('columnheader', { name: 'Rol' })).toBeInTheDocument();
    expect(within(row('rita@x.test')).getByText('Reclutador')).toBeInTheDocument();
    expect(within(row('ana@x.test')).getByText('Super Administrador')).toBeInTheDocument();
    expect(within(row('ana@x.test')).getByText('Tú')).toBeInTheDocument();
  });

  it('offers no action on the admin own row', async () => {
    await renderTable();
    expect(within(row('ana@x.test')).queryByRole('button')).toBeNull();
    expect(within(row('rita@x.test')).getByRole('button', { name: 'Cambiar rol' })).toBeInTheDocument();
  });

  it('hides every action without user:update / user:delete', async () => {
    mocks.canUpdate = false;
    mocks.canDelete = false;
    await renderTable();
    expect(screen.queryByRole('button', { name: 'Cambiar rol' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Acciones' })).toBeNull();
  });

  it('an hr_admin sees no action on a super_admin row', async () => {
    mocks.roles = ['hr_admin'];
    await renderTable();
    expect(within(row('sofi@x.test')).queryByRole('button')).toBeNull();
    expect(within(row('rita@x.test')).getByRole('button', { name: 'Desactivar' })).toBeInTheDocument();
  });

  it('"Desactivar" asks first and only then calls user.deactivate', async () => {
    await renderTable();
    fireEvent.click(within(row('rita@x.test')).getByRole('button', { name: 'Desactivar' }));
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('¿Desactivar a Rita Recluta?');
    fireEvent.click(screen.getByRole('button', { name: 'Sí, desactivar' }));
    expect(mocks.deactivate).toHaveBeenCalledWith({ userId: 'u2' });
  });

  it('"Cambiar rol" offers pilot roles only and saves the new one', async () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    await renderTable();
    fireEvent.click(within(row('rita@x.test')).getByRole('button', { name: 'Cambiar rol' }));
    const select = screen.getByLabelText('Rol') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain('leader');
    expect(values).not.toContain('hrbp');
    fireEvent.change(select, { target: { value: 'committee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rol' }));
    expect(mocks.changeRole).toHaveBeenCalledWith({ userId: 'u2', roleSlug: 'committee' });
    vi.unstubAllEnvs();
  });
});

describe('profile page (D-16)', () => {
  it('loads the own profile and saves name, phone, language and time zone through updateProfile', async () => {
    mocks.profile = {
      firstName: 'Ana',
      lastName: 'Admin',
      email: 'ana@x.test',
      jobTitle: null,
      phone: null,
      locale: 'es',
      timezone: 'America/Bogota',
    };
    const { default: ProfilePage } = await import('../../apps/web/app/(admin)/profile/page');
    render(<ProfilePage />);
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@x.test');
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '+506 8888 0000' } });
    fireEvent.change(screen.getByLabelText('Zona horaria'), { target: { value: 'America/Costa_Rica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(mocks.updateProfile).toHaveBeenCalledWith({
      firstName: 'Ana',
      lastName: 'Admin',
      jobTitle: '',
      phone: '+506 8888 0000',
      locale: 'es',
      timezone: 'America/Costa_Rica',
    });
  });

  it('refuses an empty name before calling the server', async () => {
    mocks.profile = {
      firstName: 'Ana',
      lastName: 'Admin',
      email: 'ana@x.test',
      jobTitle: null,
      phone: null,
      locale: 'es',
      timezone: 'America/Costa_Rica',
    };
    const { default: ProfilePage } = await import('../../apps/web/app/(admin)/profile/page');
    render(<ProfilePage />);
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(mocks.updateProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe tu nombre.');
  });

  it('the server schema accepts IANA zones only', () => {
    expect(updateProfileSchema.safeParse({ timezone: 'America/Costa_Rica' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ timezone: 'Costa Rica' }).success).toBe(false);
  });
});

describe('organization data card (D-11)', () => {
  it('shows country, currency, time zone, language and says when no candidate contact is set', async () => {
    const { default: Page } = await import('../../apps/web/app/(admin)/settings/organization/page');
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Datos de la organización' })).toBeInTheDocument();
    expect(screen.getByText('Costa Rica (CR)')).toBeInTheDocument();
    expect(screen.getByText(/^CRC · colón/)).toBeInTheDocument();
    expect(screen.getByText(/hora de Costa Rica \(GMT-6\)/)).toBeInTheDocument();
    expect(screen.getByText(/los correos a candidatos no incluyen un correo de contacto/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\/careers\/piloto$/ })).toBeInTheDocument();
  });
});

/**
 * Platform-owner safety in the UI — D-14 (confirmations), D-15 (invitation CTAs, similar organization name),
 * platform-owner journeys-30 (allowlist typed confirmation), D-12 (business units copy in the pilot).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { areOrganizationNamesSimilar, findSimilarOrganizations } from '../../apps/web/lib/similar-organizations';

const m = vi.hoisted(() => ({
  changeRole: vi.fn(),
  sendNotification: vi.fn(),
  addOwner: vi.fn(),
  createOrg: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'ES' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: m.toast }));
vi.mock('../../apps/web/lib/platform-api/organization-invitation-create', () => ({
  useOrganizationInvitationCreate: () => ({ mutate: m.createOrg, isPending: false, error: null }),
}));
vi.mock('../../apps/web/lib/trpc', () => {
  const idle = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({
        platform: {
          getOrgUsers: { invalidate: vi.fn() },
          listPlatformOwnerEmails: { invalidate: vi.fn() },
        },
        organization: { listUnitMembers: { invalidate: vi.fn() } },
      }),
      platform: {
        getOrgUsers: {
          useQuery: () => ({
            isLoading: false,
            isError: false,
            data: {
              total: 1,
              users: [
                {
                  id: 'u2',
                  firstName: 'Rita',
                  lastName: 'Recluta',
                  email: 'rita@x.test',
                  jobTitle: null,
                  isActive: true,
                  isPlatformOwner: false,
                  lastLoginAt: null,
                  userRoles: [{ role: { slug: 'recruiter' } }],
                },
              ],
            },
          }),
        },
        changeOrgUserRole: { useMutation: () => ({ mutate: m.changeRole, isPending: false }) },
        deactivateOrgUser: idle,
        activateOrgUser: idle,
        resetUserPassword: idle,
        forceLogoutUser: idle,
        sendBulkNotification: { useMutation: () => ({ mutate: m.sendNotification, isPending: false }) },
        listOrganizationsMinimal: {
          useQuery: () => ({
            data: [
              { id: 'o1', name: 'Nova' },
              { id: 'o2', name: 'Acme Logística' },
            ],
            isError: false,
          }),
        },
        listPlatformOwnerEmails: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) },
        addPlatformOwnerEmail: { useMutation: () => ({ mutate: m.addOwner, isPending: false }) },
        removePlatformOwnerEmail: idle,
      },
      organization: {
        listCompanies: {
          useQuery: () => ({
            data: [{ id: 'c1', name: 'Piloto S.A.' }],
            isLoading: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
        listBusinessUnits: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) },
        listUnitMembers: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
        unassignUserFromUnit: idle,
      },
    },
  };
});
vi.mock('../../apps/web/app/(admin)/platform/invitations/invite-user-modal', () => ({ InviteUserModal: () => null }));

beforeEach(() => vi.clearAllMocks());

describe('org detail → Users role picker (D-14)', () => {
  it('picking a role opens a confirmation naming both roles; only "Sí, cambiar rol" applies it', async () => {
    const { UsersSection } =
      await import('../../apps/web/app/(admin)/platform/organizations/[id]/sections/users-section');
    render(<UsersSection organizationId="22222222-2222-4222-8222-222222222222" organizationName="Pilot" />);
    fireEvent.change(screen.getByLabelText('Rol — Rita Recluta'), { target: { value: 'committee' } });
    expect(m.changeRole).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Pasará de Reclutador a Comité de entrevista.');
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cambiar rol' }));
    expect(m.changeRole).toHaveBeenCalledWith({
      userId: 'u2',
      organizationId: '22222222-2222-4222-8222-222222222222',
      roleSlug: 'committee',
    });
  });
});

describe('support → send notification (D-14)', () => {
  it('confirms the audience (all organizations by default) before sending', async () => {
    const { QuickActions } = await import('../../apps/web/app/(admin)/platform/support/quick-actions');
    render(<QuickActions />);
    fireEvent.change(screen.getByLabelText('Título de la notificación'), { target: { value: 'Mantenimiento' } });
    fireEvent.change(screen.getByLabelText('Mensaje de la notificación...'), { target: { value: 'Esta noche' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar Notificación/ }));
    expect(m.sendNotification).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('TODAS las organizaciones activas');
    fireEvent.click(screen.getByRole('button', { name: 'Sí, enviar' }));
    expect(m.sendNotification).toHaveBeenCalledWith({
      organizationId: undefined,
      title: 'Mantenimiento',
      message: 'Esta noche',
      type: 'info',
    });
  });
});

describe('support → owner allowlist (journeys-30)', () => {
  it('adds an address only after it is typed twice identically', async () => {
    const { PlatformOwnerSection } = await import('../../apps/web/app/(admin)/platform/support/platform-owner-section');
    render(<PlatformOwnerSection />);
    expect(screen.getByText(/pierde ese acceso de inmediato/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Agregar' });
    fireEvent.change(screen.getByLabelText('Correo a autorizar'), { target: { value: 'nuevo@nexadev.test' } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Repite el correo para confirmar'), {
      target: { value: 'nuevo@nexadev.tes' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Los correos no coinciden.');
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Repite el correo para confirmar'), {
      target: { value: 'Nuevo@NexaDev.test' },
    });
    fireEvent.click(add);
    expect(m.addOwner).toHaveBeenCalledWith({ email: 'nuevo@nexadev.test' });
  });
});

describe('invitations (D-15)', () => {
  it('a new organization named like an existing one needs an explicit confirmation', async () => {
    const { InviteOrgModal } = await import('../../apps/web/app/(admin)/platform/invitations/invite-org-modal');
    render(<InviteOrgModal onClose={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Email del Admin *'), { target: { value: 'admin@x.test' } });
    fireEvent.change(screen.getByLabelText('Nombre de la Organización *'), { target: { value: 'Nova Costa Rica' } });
    expect(screen.getByRole('alert')).toHaveTextContent('nombre parecido: Nova');
    const submit = screen.getByRole('button', { name: 'Crear & Enviar Invitación' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Confirmo que es una organización nueva'));
    fireEvent.click(submit);
    expect(m.createOrg).toHaveBeenCalledWith(expect.objectContaining({ organizationName: 'Nova Costa Rica' }));
  });

  it('similar-name matching ignores accents and legal forms but not unrelated names', () => {
    expect(areOrganizationNamesSimilar('Nova Costa Rica', 'Nova')).toBe(true);
    expect(areOrganizationNamesSimilar('Acme Logistica S.A.', 'ACME logística')).toBe(true);
    expect(areOrganizationNamesSimilar('Grupo Nova', 'Grupo Delta')).toBe(false);
    expect(findSimilarOrganizations('Zeta', [{ name: 'Nova' }, { name: 'Acme' }])).toEqual([]);
    expect(findSimilarOrganizations('no', [{ name: 'Nova' }])).toEqual([]);
  });
});

describe('business units in the pilot (D-12)', () => {
  it('says the structure is not used in the pilot (no "ask support to enable it") and shows an empty state', async () => {
    vi.stubEnv('NEXT_PUBLIC_LAUNCH_SCOPE', 'pilot');
    const { LegacyBusinessUnitsView } =
      await import('../../apps/web/app/(admin)/settings/business-units/legacy-business-units-view');
    render(<LegacyBusinessUnitsView />);
    expect(screen.getByText(/no se usa durante el piloto/)).toBeInTheDocument();
    expect(screen.queryByText(/pide a soporte que active/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Selecciona una empresa'), { target: { value: 'c1' } });
    expect(screen.getByText('Esta empresa no tiene unidades de negocio.')).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});

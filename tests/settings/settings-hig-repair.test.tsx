import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';

// Repairs after the independent check of the settings Apple-HIG pass (settings-check-01..04).

const mocks = vi.hoisted(() => ({
  plan: { isPending: false, isError: false, data: null as unknown, refetch: () => undefined },
  canAudit: true,
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/permissions', () => ({
  usePermissions: () => ({
    can: (module: string) => module !== 'audit' || mocks.canAudit,
    isLoading: false,
  }),
}));
vi.mock('../../apps/web/lib/platform-api/billing', () => ({
  useBillingCurrentPlan: () => mocks.plan,
  useBillingCreatePortalSession: () => ({ mutate: vi.fn(), isPending: false }),
  useBillingCancelSubscription: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../../apps/web/lib/platform-api/org-structure', () => ({
  useOrgStructureMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  classifyOrgStructureError: () => 'other',
}));

function withQuery(ui: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.plan = { isPending: false, isError: false, data: null, refetch: () => undefined };
  mocks.canAudit = true;
});

describe('billing current plan (settings-check-01)', () => {
  it('shows the trial plan, not a permanent skeleton, when the org has no subscription (null)', async () => {
    const { BillingCurrentPlan } = await import('../../apps/web/app/(admin)/settings/billing/billing-current-plan');
    const { container } = render(withQuery(<BillingCurrentPlan configured />));
    expect(screen.getByText(es.billing.planTrial)).toBeInTheDocument();
    expect(screen.getByText(es.billing.statusTrialing)).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows the skeleton only while the plan request is pending', async () => {
    mocks.plan = { ...mocks.plan, isPending: true, data: undefined };
    const { BillingCurrentPlan } = await import('../../apps/web/app/(admin)/settings/billing/billing-current-plan');
    const { container } = render(withQuery(<BillingCurrentPlan configured />));
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText(es.billing.planTrial)).toBeNull();
  });
});

describe('team members modal focus (settings-check-02)', () => {
  const team = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ventas',
    businessUnitId: '22222222-2222-4222-8222-222222222222',
    isActive: true,
    leader: null,
    members: [
      { userId: '33333333-3333-4333-8333-333333333333', fullName: 'Ada Admin', email: 'ada@x.test', role: 'member' },
    ],
  };
  const abilities = { unassignPeople: true, assignPeople: false } as never;

  it('moves focus into the inline confirm, and back to "Quitar" when it is cancelled', async () => {
    const { TeamMembersModal } = await import('../../apps/web/app/(admin)/settings/business-units/team-members-modal');
    render(<TeamMembersModal team={team} abilities={abilities} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: es.units.remove }));
    const cancel = screen.getByRole('button', { name: es.units.cancel });
    expect(document.activeElement).toBe(cancel);

    fireEvent.click(cancel);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: es.units.remove }));
  });
});

describe('org-structure error copy (settings-check-03)', () => {
  it('maps the stable C# error codes to specific translated messages, never the backend text', async () => {
    const { useOrgErrorMessage } =
      await import('../../apps/web/app/(admin)/settings/business-units/use-org-error-message');
    const { result } = renderHook(() => useOrgErrorMessage());
    const err = (code: string) => new PlatformApiError(400, 'Bad Request', { code, message: 'Nombre duplicado' });
    expect(result.current(err('invalid_input'))).toBe(es.units.errorInvalidInput);
    expect(result.current(err('company_required'))).toBe(es.units.errorCompanyRequired);
    expect(result.current(err('business_unit_inactive'))).toBe(es.units.errorUnitInactive);
    expect(result.current(err('team_inactive'))).toBe(es.units.errorTeamInactive);
    expect(result.current(err('user_inactive'))).toBe(es.units.errorUserInactive);
    expect(result.current(err('something_else'))).toBe(es.units.errorGeneric);
  });
});

describe('integrations audit-log link (settings-check-04)', () => {
  it('is offered only to a role that can open the audit log', async () => {
    const { AuditLogLink } = await import('../../apps/web/app/(admin)/settings/integrations/integration-bottom');
    const { unmount } = render(<AuditLogLink />);
    expect(screen.getByRole('link', { name: es.integrations.viewAuditLog })).toHaveAttribute(
      'href',
      '/settings/audit-log',
    );
    unmount();

    mocks.canAudit = false;
    render(<AuditLogLink />);
    expect(screen.queryByRole('link', { name: es.integrations.viewAuditLog })).toBeNull();
  });
});

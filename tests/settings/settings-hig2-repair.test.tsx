import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';

// Second repair round of the settings Apple-HIG pass: the unlimited-usage line, the billing notice's next step,
// the plan cards, the one-time key dialog, the key dialog's Cancel, and the project rule that every mutation
// toasts its failure (the inline copy inside an open dialog stays too).

type MutationOptions = { onError?: (error: unknown) => void; onSuccess?: (...args: unknown[]) => void };

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  supportEmail: null as string | null,
  cancelOptions: null as MutationOptions | null,
  orgOptions: [] as MutationOptions[],
}));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES', setLocale: vi.fn() }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => mocks.toast(...args) }));
vi.mock('../../apps/web/lib/support-email', () => ({ getSupportEmail: () => mocks.supportEmail }));
vi.mock('../../apps/web/lib/platform-api/billing', () => ({
  useBillingCurrentPlan: () => ({ isPending: false, isError: false, data: null, refetch: () => undefined }),
  useBillingCreatePortalSession: () => ({ mutate: vi.fn(), isPending: false }),
  useBillingCreateCheckoutSession: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useBillingCancelSubscription: (options: MutationOptions) => {
    mocks.cancelOptions = options;
    return { mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false };
  },
}));
vi.mock('../../apps/web/lib/platform-api/org-structure', () => ({
  useOrgStructureMutation: (_name: string, options: MutationOptions) => {
    mocks.orgOptions.push(options);
    return { mutate: vi.fn(), isPending: false, error: null };
  },
  classifyOrgStructureError: () => 'other',
}));

function withQuery(ui: React.ReactElement) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.supportEmail = null;
  mocks.cancelOptions = null;
  mocks.orgOptions = [];
});

describe('billing usage line', () => {
  it('reads "{used} · sin límite" for an unlimited plan, never "3 de Sin límite"', async () => {
    const { UsageRow } = await import('../../apps/web/app/(admin)/settings/billing/usage-row');
    render(<UsageRow label="Empleados" used={3} limit={null} />);
    expect(screen.getByText('3 · sin límite')).toBeInTheDocument();
    expect(screen.queryByText(/de Sin límite/)).toBeNull();
  });

  it('keeps "{used} de {limit}" for a limited plan', async () => {
    const { UsageRow } = await import('../../apps/web/app/(admin)/settings/billing/usage-row');
    render(<UsageRow label="Empleados" used={3} limit={10} />);
    expect(screen.getAllByText('3 de 10').length).toBeGreaterThan(0);
  });
});

describe('billing not-configured notice', () => {
  it('names a next step when no support address is configured', async () => {
    const { NotConfiguredNotice } = await import('../../apps/web/app/(admin)/settings/billing/not-configured-notice');
    render(<NotConfiguredNotice />);
    expect(screen.getByText(es.billing.notConfiguredNextStep, { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('links to support when an address is configured', async () => {
    mocks.supportEmail = 'soporte@example.com';
    const { NotConfiguredNotice } = await import('../../apps/web/app/(admin)/settings/billing/not-configured-notice');
    render(<NotConfiguredNotice />);
    expect(screen.getByRole('link', { name: es.billing.contactSupport })).toHaveAttribute(
      'href',
      'mailto:soporte@example.com',
    );
    expect(screen.queryByText(es.billing.notConfiguredNextStep, { exact: false })).toBeNull();
  });
});

describe('billing plan cards', () => {
  const load = () => import('../../apps/web/app/(admin)/settings/billing/billing-plans');

  it('configured: upgrade above the current plan, switch below it, current card has no action', async () => {
    const { BillingPlans } = await load();
    render(<BillingPlans currentPlan="professional" configured />);
    expect(screen.getByRole('button', { name: 'Cambiar a Starter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Professional/ })).toBeNull();
    expect(screen.getByText(es.billing.currentBadge)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: es.billing.contactSales })).toBeInTheDocument();
  });

  it('configured on trial: every self-serve plan is an upgrade', async () => {
    const { BillingPlans } = await load();
    render(<BillingPlans currentPlan={null} configured />);
    expect(screen.getByRole('button', { name: 'Mejorar a Starter' })).toBeInTheDocument();
  });

  it('not configured: no checkout buttons, a plain "not available yet" line', async () => {
    const { BillingPlans } = await load();
    render(<BillingPlans currentPlan={null} configured={false} />);
    expect(screen.queryByRole('button', { name: /Mejorar a|Cambiar a/ })).toBeNull();
    expect(screen.getAllByText(es.billing.notAvailableYet)).toHaveLength(2);
  });

  it('loading: no card claims to be current and no action is offered yet', async () => {
    const { BillingPlans } = await load();
    render(<BillingPlans currentPlan="starter" configured loading />);
    expect(screen.queryByText(es.billing.currentBadge)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('current = enterprise: no "contact sales" link on the plan already held', async () => {
    const { BillingPlans } = await load();
    render(<BillingPlans currentPlan="enterprise" configured />);
    expect(screen.queryByRole('link', { name: es.billing.contactSales })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar a Starter' })).toBeInTheDocument();
  });
});

describe('mutation failures toast (project rule)', () => {
  it('cancelling the subscription toasts its failure', async () => {
    const { BillingCurrentPlan } = await import('../../apps/web/app/(admin)/settings/billing/billing-current-plan');
    render(withQuery(<BillingCurrentPlan configured />));
    mocks.cancelOptions?.onError?.(new Error('boom'));
    expect(mocks.toast).toHaveBeenCalledWith(es.billing.cancelError, { type: 'error' });
  });

  it('the business-unit dialog toasts its failure in translated copy', async () => {
    const { BusinessUnitFormModal } =
      await import('../../apps/web/app/(admin)/settings/business-units/business-unit-form-modal');
    render(<BusinessUnitFormModal companies={[{ id: 'c1', name: 'Acme' }]} onClose={vi.fn()} />);
    expect(mocks.orgOptions.length).toBeGreaterThan(0);
    for (const options of mocks.orgOptions) options.onError?.(new Error('raw server text'));
    expect(mocks.toast).toHaveBeenCalledWith(expect.any(String), { type: 'error' });
    expect(mocks.toast).not.toHaveBeenCalledWith('raw server text', expect.anything());
  });
});

describe('one-time API key dialog', () => {
  it('Escape does not discard the only copy of the key; the explicit button does', async () => {
    const { ApiKeySecretDialog } =
      await import('../../apps/web/app/(admin)/settings/integrations/api-key-secret-dialog');
    const onClose = vi.fn();
    render(<ApiKeySecretDialog rawKey="tims_live_abc" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: es.integrations.apiKeyClose }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('new API key dialog', () => {
  it('Cancel with a typed name asks before discarding, like ✕ and Escape', async () => {
    const { ApiKeyCreateModal } = await import('../../apps/web/app/(admin)/settings/integrations/api-key-create-modal');
    const onClose = vi.fn();
    render(<ApiKeyCreateModal pending={false} error={null} onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(es.integrations.apiKeyName, { exact: false }), {
      target: { value: 'CI' },
    });
    fireEvent.click(screen.getByRole('button', { name: es.integrations.apiKeyCancel }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: es.common.discardTitle })).toBeInTheDocument();
  });
});

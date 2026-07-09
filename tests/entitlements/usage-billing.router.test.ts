/**
 * usage-billing.router.test.ts
 *
 * Router unit tests for the platform-owner usage-billing router (Slice 2b,
 * Task 4). Mocks the service layer (computeUsageBilling / createUsageInvoice),
 * the repository's organizationExists (IDOR check) + findDraftInvoiceForPeriod
 * (duplicate-draft guard), and db.auditLog.create (best-effort audit
 * side-channel). Mirrors the makeCaller pattern from
 * tests/entitlements/entitlement.admin-router.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/services/usage-billing.service', () => ({
  computeUsageBilling: vi.fn(),
  createUsageInvoice: vi.fn(),
}));

vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  organizationExists: vi.fn(),
  findDraftInvoiceForPeriod: vi.fn(),
}));

vi.mock('@tims/db', () => ({
  db: {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
  // Platform-owner requests with no org row of their own skip runWithTenant
  // entirely (see withTenantContext in trpc.ts); non-owner requests DO call it,
  // so it must be a passthrough here for the FORBIDDEN test to reach the guard.
  runWithTenant: (_orgId: string, fn: () => unknown) => fn(),
}));

import {
  computeUsageBilling,
  createUsageInvoice,
} from '../../packages/api/src/services/usage-billing.service';
import {
  organizationExists,
  findDraftInvoiceForPeriod,
} from '../../packages/api/src/repositories/entitlement.repository';
import { db } from '@tims/db';

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const PERIOD_START = new Date('2026-07-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-07-31T23:59:59.999Z');

async function makeCaller(overrideCtx?: Record<string, unknown>) {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { usageBillingRouter } = await import('../../packages/api/src/routers/platform/usage-billing');

  const testRouter = router({ platform: usageBillingRouter });
  const callerFactory = createCallerFactory(testRouter);

  const baseCtx = {
    // Platform-owner context has NO organizationId of its own — withTenantContext
    // short-circuits (return next()) without calling runWithTenant. A non-owner
    // context below sets organizationId so withTenantContext's runWithTenant path
    // is exercised (mocked as a passthrough above).
    user: {
      id: 'platform-user-1',
      email: 'owner@tims.co',
      supabaseUserId: 's-owner-1',
      roles: ['platform_owner'],
      isPlatformOwner: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    ...overrideCtx,
  };

  return callerFactory(baseCtx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usageBillingRouter — platformProcedure gate', () => {
  it('non-platform-owner caller gets FORBIDDEN', async () => {
    const caller = await makeCaller({
      user: {
        id: 'staff-user-1',
        email: 'staff@tims.co',
        supabaseUserId: 's-staff-1',
        organizationId: ORG_ID,
        roles: ['hr_admin'],
        isPlatformOwner: false,
      },
    });

    await expect(caller.platform.getUsageBillingPreview({ orgId: ORG_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('usageBillingRouter — IDOR guard', () => {
  it('platform-owner caller with a missing org gets NOT_FOUND on getUsageBillingPreview', async () => {
    vi.mocked(organizationExists).mockResolvedValue(false);

    const caller = await makeCaller();

    await expect(caller.platform.getUsageBillingPreview({ orgId: ORG_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(vi.mocked(computeUsageBilling)).not.toHaveBeenCalled();
  });

  it('platform-owner caller with a missing org gets NOT_FOUND on generateUsageInvoice', async () => {
    vi.mocked(organizationExists).mockResolvedValue(false);

    const caller = await makeCaller();

    await expect(
      caller.platform.generateUsageInvoice({
        orgId: ORG_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(vi.mocked(computeUsageBilling)).not.toHaveBeenCalled();
  });
});

describe('usageBillingRouter — getUsageBillingPreview', () => {
  it('calls computeUsageBilling with default period (first-of-month..now) when omitted', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(computeUsageBilling).mockResolvedValue({ lines: [], subtotalUsd: 0 });

    const caller = await makeCaller();
    const result = await caller.platform.getUsageBillingPreview({ orgId: ORG_ID });

    expect(result).toEqual({ lines: [], subtotalUsd: 0 });
    expect(vi.mocked(computeUsageBilling)).toHaveBeenCalledTimes(1);
    const [calledOrgId, calledStart, calledEnd] = vi.mocked(computeUsageBilling).mock.calls[0];
    expect(calledOrgId).toBe(ORG_ID);
    expect(calledStart.getDate()).toBe(1);
    expect(calledStart.getHours()).toBe(0);
    expect(calledStart.getMinutes()).toBe(0);
    expect(calledEnd).toBeInstanceOf(Date);
  });

  it('calls computeUsageBilling with explicit period when provided', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(computeUsageBilling).mockResolvedValue({ lines: [], subtotalUsd: 0 });

    const caller = await makeCaller();
    await caller.platform.getUsageBillingPreview({
      orgId: ORG_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(vi.mocked(computeUsageBilling)).toHaveBeenCalledWith(ORG_ID, PERIOD_START, PERIOD_END);
  });
});

describe('usageBillingRouter — generateUsageInvoice', () => {
  it('rejects with BAD_REQUEST when every line has amountUsd <= 0', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(computeUsageBilling).mockResolvedValue({
      lines: [
        {
          moduleCode: 'ai_screening',
          name: 'AI Screening',
          unit: 'call',
          quantity: 10,
          includedQty: 100,
          billableQty: 0,
          unitPrice: 0.5,
          amountUsd: 0,
        },
      ],
      subtotalUsd: 0,
    });

    const caller = await makeCaller();

    await expect(
      caller.platform.generateUsageInvoice({
        orgId: ORG_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(vi.mocked(findDraftInvoiceForPeriod)).not.toHaveBeenCalled();
    expect(vi.mocked(createUsageInvoice)).not.toHaveBeenCalled();
  });

  it('rejects with CONFLICT when a draft invoice already exists for the period', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    vi.mocked(computeUsageBilling).mockResolvedValue({
      lines: [
        {
          moduleCode: 'ai_screening',
          name: 'AI Screening',
          unit: 'call',
          quantity: 200,
          includedQty: 100,
          billableQty: 100,
          unitPrice: 0.5,
          amountUsd: 50,
        },
      ],
      subtotalUsd: 50,
    });
    vi.mocked(findDraftInvoiceForPeriod).mockResolvedValue({ id: 'existing-invoice-id' });

    const caller = await makeCaller();

    await expect(
      caller.platform.generateUsageInvoice({
        orgId: ORG_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(vi.mocked(createUsageInvoice)).not.toHaveBeenCalled();
  });

  it('happy path: calls createUsageInvoice and returns its result', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    const preview = {
      lines: [
        {
          moduleCode: 'ai_screening',
          name: 'AI Screening',
          unit: 'call',
          quantity: 200,
          includedQty: 100,
          billableQty: 100,
          unitPrice: 0.5,
          amountUsd: 50,
        },
      ],
      subtotalUsd: 50,
    };
    vi.mocked(computeUsageBilling).mockResolvedValue(preview);
    vi.mocked(findDraftInvoiceForPeriod).mockResolvedValue(null);
    vi.mocked(createUsageInvoice).mockResolvedValue({ invoiceId: 'inv-1', invoiceNumber: 1001 });

    const caller = await makeCaller();
    const result = await caller.platform.generateUsageInvoice({
      orgId: ORG_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(result).toEqual({ invoiceId: 'inv-1', invoiceNumber: 1001 });
    expect(vi.mocked(createUsageInvoice)).toHaveBeenCalledWith(ORG_ID, PERIOD_START, PERIOD_END, preview);
  });

  it('audit-logs action entitlement_usage_invoiced on success', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    const preview = { lines: [{ moduleCode: 'x', name: 'X', unit: 'call', quantity: 1, includedQty: 0, billableQty: 1, unitPrice: 1, amountUsd: 1 }], subtotalUsd: 1 };
    vi.mocked(computeUsageBilling).mockResolvedValue(preview);
    vi.mocked(findDraftInvoiceForPeriod).mockResolvedValue(null);
    vi.mocked(createUsageInvoice).mockResolvedValue({ invoiceId: 'inv-2', invoiceNumber: 1002 });

    const caller = await makeCaller();
    await caller.platform.generateUsageInvoice({
      orgId: ORG_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(vi.mocked(db.auditLog.create)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          action: 'entitlement_usage_invoiced',
          entity: 'invoice',
          entityId: 'inv-2',
        }),
      }),
    );
  });

  it('is best-effort on audit logging: an auditLog.create rejection does NOT fail the mutation', async () => {
    vi.mocked(organizationExists).mockResolvedValue(true);
    const preview = { lines: [{ moduleCode: 'x', name: 'X', unit: 'call', quantity: 1, includedQty: 0, billableQty: 1, unitPrice: 1, amountUsd: 1 }], subtotalUsd: 1 };
    vi.mocked(computeUsageBilling).mockResolvedValue(preview);
    vi.mocked(findDraftInvoiceForPeriod).mockResolvedValue(null);
    vi.mocked(createUsageInvoice).mockResolvedValue({ invoiceId: 'inv-3', invoiceNumber: 1003 });
    vi.mocked(db.auditLog.create as unknown as (a: unknown) => Promise<unknown>).mockRejectedValue(
      new Error('audit db down'),
    );

    const caller = await makeCaller();
    const result = await caller.platform.generateUsageInvoice({
      orgId: ORG_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(result).toEqual({ invoiceId: 'inv-3', invoiceNumber: 1003 });
  });
});

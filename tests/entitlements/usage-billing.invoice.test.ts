import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock-based (no real DB, no Postgres in CI). Mocks only `@tims/db`'s `db`
// delegate — `InvoiceStatus` is imported directly from `@prisma/client` in
// the repository (not re-exported through this mock), so the repository's
// `InvoiceStatus.draft` reference stays real even while `db` is faked.
// ---------------------------------------------------------------------------

const mockDb = vi.hoisted(() => ({ invoice: { create: vi.fn(), findFirst: vi.fn() } }));
vi.mock('@tims/db', () => ({ db: mockDb }));

import {
  createDraftInvoice,
  findDraftInvoiceForPeriod,
} from '../../packages/api/src/repositories/entitlement.repository';
import { createUsageInvoice, type UsageBillingPreview } from '../../packages/api/src/services/usage-billing.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('entitlement.repository — createDraftInvoice', () => {
  it('writes a draft invoice with period + nested line totals', async () => {
    mockDb.invoice.create.mockResolvedValue({ id: 'inv-1', invoiceNumber: 7 });

    const res = await createDraftInvoice({
      orgId: 'org-1',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      subtotalUsd: 18,
      lines: [{ description: 'Voz: 120 minutes', quantity: 1, unitPrice: 18 }],
    });

    expect(res).toEqual({ invoiceId: 'inv-1', invoiceNumber: 7 });

    const arg = mockDb.invoice.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      organizationId: 'org-1',
      status: 'draft',
      currency: 'USD',
      subtotal: 18,
      amount: 18,
    });
    expect(arg.data.periodStart).toEqual(new Date('2026-07-01'));
    expect(arg.data.periodEnd).toEqual(new Date('2026-07-31'));
    expect(arg.data.lineItems.create[0]).toMatchObject({
      description: 'Voz: 120 minutes',
      quantity: 1,
      unitPrice: 18,
      total: 18,
      sortOrder: 0,
    });
    expect(arg.select).toEqual({ id: true, invoiceNumber: true });
  });

  it('computes per-line total = quantity*unitPrice and sortOrder = index for multiple lines', async () => {
    mockDb.invoice.create.mockResolvedValue({ id: 'inv-2', invoiceNumber: 8 });

    await createDraftInvoice({
      orgId: 'org-1',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
      subtotalUsd: 30,
      lines: [
        { description: 'A', quantity: 1, unitPrice: 10 },
        { description: 'B', quantity: 2, unitPrice: 10 },
      ],
    });

    const arg = mockDb.invoice.create.mock.calls[0][0];
    expect(arg.data.lineItems.create[0]).toMatchObject({ description: 'A', total: 10, sortOrder: 0 });
    expect(arg.data.lineItems.create[1]).toMatchObject({ description: 'B', total: 20, sortOrder: 1 });
  });
});

describe('entitlement.repository — findDraftInvoiceForPeriod', () => {
  it('filters by org, draft status, and period; returns null when none found', async () => {
    mockDb.invoice.findFirst.mockResolvedValue(null);

    const r = await findDraftInvoiceForPeriod('org-1', new Date('2026-07-01'), new Date('2026-07-31'));

    expect(r).toBeNull();
    const arg = mockDb.invoice.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      organizationId: 'org-1',
      status: 'draft',
      periodStart: new Date('2026-07-01'),
      periodEnd: new Date('2026-07-31'),
    });
    expect(arg.select).toEqual({ id: true });
  });

  it('returns the matching row when found', async () => {
    mockDb.invoice.findFirst.mockResolvedValue({ id: 'inv-3' });

    const r = await findDraftInvoiceForPeriod('org-1', new Date('2026-07-01'), new Date('2026-07-31'));

    expect(r).toEqual({ id: 'inv-3' });
  });
});

describe('usage-billing.service — createUsageInvoice', () => {
  it('builds invoice lines from the preview (via buildUsageInvoiceLines) and persists a draft', async () => {
    mockDb.invoice.create.mockResolvedValue({ id: 'inv-9', invoiceNumber: 42 });

    const preview: UsageBillingPreview = {
      subtotalUsd: 18,
      lines: [
        {
          moduleCode: 'ai_voice_interview',
          name: 'Voz',
          unit: 'minutes',
          quantity: 120,
          includedQty: 0,
          billableQty: 120,
          unitPrice: 0.15,
          amountUsd: 18,
        },
      ],
    };

    const res = await createUsageInvoice('org-1', new Date('2026-07-01'), new Date('2026-07-31'), preview);

    expect(res).toEqual({ invoiceId: 'inv-9', invoiceNumber: 42 });

    const arg = mockDb.invoice.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      organizationId: 'org-1',
      status: 'draft',
      subtotal: 18,
      amount: 18,
      currency: 'USD',
    });
    expect(arg.data.periodStart).toEqual(new Date('2026-07-01'));
    expect(arg.data.periodEnd).toEqual(new Date('2026-07-31'));
    expect(arg.data.lineItems.create[0]).toMatchObject({
      description: 'Voz: 120 minutes × $0.15 (0 incl.)',
      quantity: 1,
      unitPrice: 18,
      total: 18,
      sortOrder: 0,
    });
  });

  it('drops zero-amount lines (via buildUsageInvoiceLines) before persisting', async () => {
    mockDb.invoice.create.mockResolvedValue({ id: 'inv-10', invoiceNumber: 43 });

    const preview: UsageBillingPreview = {
      subtotalUsd: 0,
      lines: [
        {
          moduleCode: 'ai_screening',
          name: 'Filtro IA',
          unit: 'screenings',
          quantity: 100,
          includedQty: 5000,
          billableQty: 0,
          unitPrice: 0.5,
          amountUsd: 0,
        },
      ],
    };

    await createUsageInvoice('org-1', new Date('2026-07-01'), new Date('2026-07-31'), preview);

    const arg = mockDb.invoice.create.mock.calls[0][0];
    expect(arg.data.lineItems.create).toEqual([]);
    expect(arg.data.subtotal).toBe(0);
    expect(arg.data.amount).toBe(0);
  });
});

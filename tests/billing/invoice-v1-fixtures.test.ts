import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Phase-5 Slice 3: the SAME golden fixtures asserted by the C# billing wire mappers
// (contracts/billing-fixtures/{invoice-v1,subscription-v1}.json; Tims.UnitTests BillingV1FixtureTests)
// are asserted here by reproducing the RAW TS billing-router shape. billing.listInvoices /
// billing.getInvoice return the raw Prisma rows (no `select`, no mapper), so the wire contract IS the full
// model: every field passthrough, NO schemaVersion, money as JSON numbers (Float),
// InvoiceStatus/OrgPlan/SubscriptionStatus enums as their DB strings, Date -> toISOString().
// The 'shape' discriminates the two router surfaces: 'list' (listInvoices, no include) OMITS the
// subscription key entirely; 'detail' (getInvoice, include:{subscription:true}) ALWAYS emits it — the
// nested object, or null when the invoice has none. A dropped/renamed field, a re-added schemaVersion, or
// a wrong subscription omit-vs-null turns this suite (and the C# suite) RED.

interface SubscriptionInput {
  id: string;
  organizationId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelledAt: string | null;
  lastStripeEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InvoiceInput {
  id: string;
  invoiceNumber: number;
  organizationId: string;
  subscriptionId: string | null;
  stripeInvoiceId: string | null;
  amount: number;
  subtotal: number | null;
  taxRate: number | null;
  currency: string;
  status: string;
  description: string | null;
  invoiceDate: string;
  dueDate: string | null;
  poNumber: string | null;
  notes: string | null;
  memo: string | null;
  emailTo: string | null;
  emailCc: string | null;
  paidAt: string | null;
  invoiceUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  subscription: SubscriptionInput | null;
}

const isoOrNull = (s: string | null): string | null => (s === null ? null : new Date(s).toISOString());

function toSubscriptionWire(s: SubscriptionInput): Record<string, unknown> {
  return {
    id: s.id,
    organizationId: s.organizationId,
    stripeCustomerId: s.stripeCustomerId,
    stripeSubscriptionId: s.stripeSubscriptionId,
    plan: s.plan,
    status: s.status,
    currentPeriodStart: isoOrNull(s.currentPeriodStart),
    currentPeriodEnd: isoOrNull(s.currentPeriodEnd),
    trialEndsAt: isoOrNull(s.trialEndsAt),
    cancelledAt: isoOrNull(s.cancelledAt),
    lastStripeEventAt: isoOrNull(s.lastStripeEventAt),
    createdAt: new Date(s.createdAt).toISOString(),
    updatedAt: new Date(s.updatedAt).toISOString(),
  };
}

type InvoiceShape = 'list' | 'detail';

function toInvoiceWire(i: InvoiceInput, shape: InvoiceShape): Record<string, unknown> {
  // Raw Prisma row (no select, no mapper) — NO schemaVersion.
  const wire: Record<string, unknown> = {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    organizationId: i.organizationId,
    subscriptionId: i.subscriptionId,
    stripeInvoiceId: i.stripeInvoiceId,
    amount: i.amount,
    subtotal: i.subtotal,
    taxRate: i.taxRate,
    currency: i.currency,
    status: i.status,
    description: i.description,
    invoiceDate: new Date(i.invoiceDate).toISOString(),
    dueDate: isoOrNull(i.dueDate),
    poNumber: i.poNumber,
    notes: i.notes,
    memo: i.memo,
    emailTo: i.emailTo,
    emailCc: i.emailCc,
    paidAt: isoOrNull(i.paidAt),
    invoiceUrl: i.invoiceUrl,
    periodStart: isoOrNull(i.periodStart),
    periodEnd: isoOrNull(i.periodEnd),
    createdAt: new Date(i.createdAt).toISOString(),
  };
  // Prisma include-vs-not: getInvoice (detail) ALWAYS emits subscription (object or null); listInvoices
  // (list, no include) OMITS the key entirely.
  if (shape === 'detail') {
    wire.subscription = i.subscription === null ? null : toSubscriptionWire(i.subscription);
  }
  return wire;
}

const invoiceData = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/billing-fixtures/invoice-v1.json', import.meta.url)), 'utf8'),
) as { description: string; cases: Array<{ name: string; shape: InvoiceShape; input: InvoiceInput; expected: Record<string, unknown> }> };

const subscriptionData = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../contracts/billing-fixtures/subscription-v1.json', import.meta.url)), 'utf8'),
) as { description: string; cases: Array<{ name: string; input: SubscriptionInput; expected: Record<string, unknown> }> };

describe('invoice-v1.json — raw billing-router Invoice wire shape', () => {
  it.each(invoiceData.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const wire = toInvoiceWire(c.input, c.shape);
    expect(wire).toEqual(c.expected);
    // Pin the exact key set (catches an added/omitted field the value-compare could miss on undefined,
    // and a re-added schemaVersion or a wrong subscription omit-vs-null).
    expect(Object.keys(wire).sort()).toEqual(Object.keys(c.expected).sort());
    // No schemaVersion on the billing wire (parity: raw Prisma row).
    expect(wire).not.toHaveProperty('schemaVersion');
    // list OMITS subscription; detail ALWAYS has the key (object or null).
    expect(Object.prototype.hasOwnProperty.call(wire, 'subscription')).toBe(c.shape === 'detail');
  });
});

describe('subscription-v1.json — raw billing-router Subscription wire shape', () => {
  it.each(subscriptionData.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const wire = toSubscriptionWire(c.input);
    expect(wire).toEqual(c.expected);
    expect(Object.keys(wire).sort()).toEqual(Object.keys(c.expected).sort());
  });
});

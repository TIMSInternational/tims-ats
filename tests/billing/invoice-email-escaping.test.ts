/**
 * invoice-email-escaping.test.ts — WP-04 PR H (platform-owner-journeys-41).
 *
 * Invoice emails are HTML built by string interpolation. Values that come from stored or
 * user-entered data (organization name, invoice memo/description, line-item description and
 * quantity) must be HTML-escaped before they are interpolated, so they render as text.
 *
 * Two layers are pinned:
 *  1. the pure builders in invoices.helpers.ts;
 *  2. the running procedures (createInvoice line items, sendPaymentReminder), by capturing the
 *     html actually handed to sendEmail. Mock strategy mirrors
 *     tests/platform/invitations-export-cap.test.ts (pass-through trpc, real platformProcedure gate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC } from '@trpc/server';

const invoiceCreate = vi.fn();
const invoiceFindUnique = vi.fn();
const invoiceUpdate = vi.fn();
const sendEmailMock = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    invoice: {
      create: (...a: unknown[]) => invoiceCreate(...a),
      findUnique: (...a: unknown[]) => invoiceFindUnique(...a),
      update: (...a: unknown[]) => invoiceUpdate(...a),
    },
  },
  InvoiceStatus: { draft: 'draft', pending: 'pending', paid: 'paid', void: 'void' },
}));

vi.mock('../../packages/api/src/lib/ses', () => ({
  sendEmail: (...a: unknown[]) => sendEmailMock(...a),
}));

vi.mock('../../packages/api/src/access/security-audit', () => ({
  logPlatformExport: vi.fn(),
}));

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
    .create();
  return { router: t.router, publicProcedure: t.procedure, protectedProcedure: t.procedure };
});

import {
  buildInvoiceLineItemsHtml,
  buildNewInvoiceEmailHtml,
  buildPaymentReminderEmailHtml,
} from '../../packages/api/src/routers/platform/invoices.helpers';
import { invoicesRouter } from '../../packages/api/src/routers/platform/invoices';

const MARKUP = '<b>X</b>';
const ESCAPED = '&lt;b&gt;X&lt;/b&gt;';
const ORG_ID = '11111111-1111-4111-8111-111111111111';
const INV_ID = '22222222-2222-4222-8222-222222222222';

const t = initTRPC
  .context<{ user: { id: string; organizationId: string; isPlatformOwner: boolean }; headers: Headers }>()
  .create();
const createCaller = t.createCallerFactory(invoicesRouter as unknown as Parameters<typeof t.createCallerFactory>[0]);

interface InvoiceCaller {
  createInvoice(input: Record<string, unknown>): Promise<unknown>;
  sendPaymentReminder(input: Record<string, unknown>): Promise<unknown>;
}

const caller = () =>
  createCaller({
    user: { id: 'owner-1', organizationId: '99999999-9999-4999-8999-999999999999', isPlatformOwner: true },
    headers: new Headers(),
  }) as unknown as InvoiceCaller;

function sentHtml(): string {
  expect(sendEmailMock, 'sendEmail was not called').toHaveBeenCalledTimes(1);
  return (sendEmailMock.mock.calls[0][0] as { html: string }).html;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmailMock.mockResolvedValue(true);
});

describe('buildNewInvoiceEmailHtml escapes interpolated values', () => {
  const base = {
    organizationName: 'Acme',
    amtFmt: '$100.00',
    invNum: 'INV-1',
    dueFmt: '01 de enero de 2027',
    lineItemsHtml: '',
  };

  it('escapes organizationName', () => {
    const html = buildNewInvoiceEmailHtml({ ...base, organizationName: MARKUP });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes memo', () => {
    const html = buildNewInvoiceEmailHtml({ ...base, memo: MARKUP });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes invNum, amtFmt and dueFmt', () => {
    const html = buildNewInvoiceEmailHtml({ ...base, invNum: 'A&B', amtFmt: '"1"', dueFmt: "o'clock" });
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&quot;1&quot;');
    expect(html).toContain('o&#39;clock');
  });

  it('does not escape lineItemsHtml (already-built markup)', () => {
    const html = buildNewInvoiceEmailHtml({ ...base, lineItemsHtml: '<tr><td>row</td></tr>' });
    expect(html).toContain('<tr><td>row</td></tr>');
  });
});

describe('buildPaymentReminderEmailHtml escapes interpolated values', () => {
  const base = { organizationName: 'Acme', invNum: 'INV-1', amountFormatted: '$100.00' };

  it('escapes organizationName', () => {
    const html = buildPaymentReminderEmailHtml({ ...base, organizationName: MARKUP });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes description', () => {
    const html = buildPaymentReminderEmailHtml({ ...base, description: MARKUP });
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes invNum and amountFormatted', () => {
    const html = buildPaymentReminderEmailHtml({ ...base, invNum: 'A&B', amountFormatted: '"1"' });
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&quot;1&quot;');
  });
});

describe('buildInvoiceLineItemsHtml escapes every cell', () => {
  // The money formatter is injected, so each formatted cell is escaped independently of
  // what the formatter returns (defence in depth; Intl output is not trusted to be markup-free).
  const formatMoney = (v: number) => (v === 10 ? '<i>unit</i>' : v === 20 ? '<u>total</u>' : String(v));
  const row = { description: 'Service', quantity: 2, unitPrice: 10, total: 20 };

  it('escapes the formatted unit price', () => {
    const html = buildInvoiceLineItemsHtml([row], formatMoney);
    expect(html).toContain('&lt;i&gt;unit&lt;/i&gt;');
    expect(html).not.toContain('<i>unit</i>');
  });

  it('escapes the formatted total', () => {
    const html = buildInvoiceLineItemsHtml([row], formatMoney);
    expect(html).toContain('&lt;u&gt;total&lt;/u&gt;');
    expect(html).not.toContain('<u>total</u>');
  });

  it('emits one table row per line item with four cells each', () => {
    const html = buildInvoiceLineItemsHtml([row, { ...row, description: 'Other' }], formatMoney);
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html.match(/<td /g)).toHaveLength(8);
  });
});

describe('createInvoice escapes line items in the sent email', () => {
  it('escapes li.description in lineItemsHtml', async () => {
    invoiceCreate.mockResolvedValue({
      id: INV_ID,
      invoiceNumber: 7,
      amount: 10,
      currency: 'USD',
      lineItems: [{ description: MARKUP, quantity: 1, unitPrice: 10, total: 10 }],
      organization: { name: 'Acme', billingEmail: null },
    });

    await caller().createInvoice({
      organizationId: ORG_ID,
      currency: 'USD',
      sendEmail: true,
      emailTo: 'billing@example.test',
      lineItems: [{ description: MARKUP, quantity: 1, unitPrice: 10 }],
    });

    const html = sentHtml();
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes li.quantity (stringified) in lineItemsHtml', async () => {
    // quantity is an int at the schema boundary; the stored value is passed through
    // String() + escapeHtml, so a non-numeric stored value still renders as text.
    invoiceCreate.mockResolvedValue({
      id: INV_ID,
      invoiceNumber: 7,
      amount: 10,
      currency: 'USD',
      lineItems: [{ description: 'Service', quantity: MARKUP as unknown as number, unitPrice: 10, total: 10 }],
      organization: { name: 'Acme', billingEmail: null },
    });

    await caller().createInvoice({
      organizationId: ORG_ID,
      currency: 'USD',
      sendEmail: true,
      emailTo: 'billing@example.test',
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 10 }],
    });

    const html = sentHtml();
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });

  it('escapes the organization name from the created invoice', async () => {
    invoiceCreate.mockResolvedValue({
      id: INV_ID,
      invoiceNumber: 7,
      amount: 10,
      currency: 'USD',
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 10, total: 10 }],
      organization: { name: MARKUP, billingEmail: null },
    });

    await caller().createInvoice({
      organizationId: ORG_ID,
      currency: 'USD',
      sendEmail: true,
      emailTo: 'billing@example.test',
      lineItems: [{ description: 'Service', quantity: 1, unitPrice: 10 }],
    });

    const html = sentHtml();
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });
});

describe('sendPaymentReminder escapes stored values in the sent email', () => {
  it('escapes organization name and description', async () => {
    invoiceFindUnique.mockResolvedValue({
      id: INV_ID,
      invoiceNumber: 7,
      amount: 10,
      currency: 'USD',
      description: MARKUP,
      dueDate: null,
      organizationId: ORG_ID,
      organization: { name: MARKUP, billingEmail: 'billing@example.test', billingProfile: null },
    });
    invoiceUpdate.mockResolvedValue({ id: INV_ID });

    await caller().sendPaymentReminder({ id: INV_ID }).catch(() => undefined);

    const html = sentHtml();
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain(MARKUP);
  });
});

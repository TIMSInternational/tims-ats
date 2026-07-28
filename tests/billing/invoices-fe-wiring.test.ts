import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('billing-invoices FE consumer — hooks wiring', () => {
  const billing = read('apps/web/lib/platform-api/billing.ts');

  it('defines the new dark-launch flag', () => {
    expect(billing).toMatch(/NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP/);
  });

  it('exports useBillingInvoices with cursor-infinite-query dark/live branching', () => {
    expect(billing).toMatch(/export function useBillingInvoices/);
    expect(billing).toMatch(/trpc\.billing\.listInvoices\.useInfiniteQuery/);
    expect(billing).toMatch(/platformGetRaw\(['"]\/billing\/invoices['"]/);
  });

  it('exports useBillingInvoice with typed single-fetch dark/live branching', () => {
    expect(billing).toMatch(/export function useBillingInvoice\(/);
    expect(billing).toMatch(/trpc\.billing\.getInvoice\.useQuery/);
    expect(billing).toMatch(/platformGet\(['"]\/billing\/invoices\/\{id\}['"]/);
  });

  it('no any type in the new hooks', () => {
    expect(billing).not.toMatch(/:\s*any\b/);
    expect(billing).not.toMatch(/\bas any\b/);
  });
});

describe('billing-invoices FE consumer — i18n', () => {
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));

  const expectedKeys = [
    'invoicesTitle',
    'invoicesEmpty',
    'invoicesEmptyDesc',
    'invoiceColDate',
    'invoiceColAmount',
    'invoiceColStatus',
    'invoiceStatusDraft',
    'invoiceStatusPending',
    'invoiceStatusPaid',
    'invoiceStatusVoid',
    'loadMoreInvoices',
    'loadingMoreInvoices',
    'invoiceSubtotal',
    'invoiceTax',
    'invoicePoNumber',
    'invoiceNotes',
    'invoicePeriod',
    'invoiceDownload',
    'invoiceNumber',
    'invoiceDueDate',
  ];

  it('every new key exists and is non-empty in both locales', () => {
    for (const key of expectedKeys) {
      expect(en.billing[key], `en.billing.${key}`).toBeTruthy();
      expect(es.billing[key], `es.billing.${key}`).toBeTruthy();
    }
  });
});

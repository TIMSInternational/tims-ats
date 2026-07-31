import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('billing-invoices FE consumer — hooks wiring', () => {
  const billing = read('apps/web/lib/platform-api/billing.ts');

  // TS deletion (2026-07-31): NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP is confirmed live in prod
  // and the TS listInvoices/getInvoice procedures have been deleted from packages/api/src/routers/
  // billing.ts — these hooks are now C#-only (no dark/live branching left to assert), mirroring
  // useBillingUsage's precedent.
  it('mentions the (now-always-live) flag in the file-header commentary', () => {
    expect(billing).toMatch(/NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP/);
  });

  it('exports useBillingInvoices as a C#-only cursor-infinite-query, no TS fallback', () => {
    expect(billing).toMatch(/export function useBillingInvoices/);
    expect(billing).not.toMatch(/trpc\.billing\.listInvoices/);
    expect(billing).toMatch(/platformGetRaw\(['"]\/billing\/invoices['"]/);
  });

  it('exports useBillingInvoice as a C#-only typed single-fetch, no TS fallback', () => {
    expect(billing).toMatch(/export function useBillingInvoice\(/);
    expect(billing).not.toMatch(/trpc\.billing\.getInvoice/);
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

describe('billing-invoices FE consumer — component', () => {
  it('billing-invoices.tsx wires the shared components and new hooks', () => {
    const component = read('apps/web/app/(admin)/settings/billing/billing-invoices.tsx');
    expect(component).toMatch(/export function BillingInvoices/);
    expect(component).toMatch(/useBillingInvoices/);
    expect(component).toMatch(/useBillingInvoice\(/);
    expect(component).toMatch(/<DataTable/);
    expect(component).toMatch(/<Drawer/);
    expect(component).toMatch(/<EmptyState/);
    expect(component).toMatch(/<ErrorState/);
    expect(component).toMatch(/<StatusBadge/);
    expect(component).not.toMatch(/style=\{\{/);
    expect(component).not.toMatch(/:\s*any\b/);
    expect(component).not.toMatch(/\bas any\b/);
  });

  it('settings/billing page.tsx mounts BillingInvoices after BillingPlans', () => {
    const page = read('apps/web/app/(admin)/settings/billing/page.tsx');
    expect(page).toMatch(/import\s*\{\s*BillingInvoices\s*\}\s*from\s*['"]\.\/billing-invoices['"]/);
    expect(page).toMatch(/<BillingPlans[\s\S]*<BillingInvoices/);
  });
});

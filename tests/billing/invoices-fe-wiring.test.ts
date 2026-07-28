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

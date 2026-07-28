# billing-invoices(read) FE Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-ever FE consumer for the already-parity-verified-live billing-invoices(read) tRPC procedures (`listInvoices`/`getInvoice`), following the exact dark-launch flag pattern every other domain in this codebase uses.

**Architecture:** Two new hooks in `apps/web/lib/platform-api/billing.ts` (`useBillingInvoices` cursor-infinite-query, `useBillingInvoice` single fetch), a new card component `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` wired into the existing `settings/billing/page.tsx`, new i18n keys, and a static source-text "wiring" test (this codebase's established convention for verifying FE cutover wrapper correctness — see `tests/tier1/s3-compensation-wiring.test.ts` for precedent).

**Tech Stack:** Next.js 15 / React, tRPC v10 (`@trpc/react-query`), `@tanstack/react-query` v5, TypeScript strict, Tailwind, vitest.

## Global Constraints

- No backend changes — `packages/api/src/routers/billing.ts`'s `listInvoices`/`getInvoice` are untouched and already parity-verified 5/5 live.
- New flag `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` ships **dark** (never set to `true` anywhere in this plan) — flipping it live is a separate follow-up decision, out of scope.
- No `any` type anywhere (CLAUDE.md TypeScript rule). No inline `style={{}}` (frontend.md rule). No hardcoded UI strings — every label through `lib/i18n`.
- `apps/web/lib/i18n/es.json`'s shape is the canonical `Translations` type (`type Translations = typeof es` in `lib/i18n/index.tsx`) — `en.json` must declare the exact same key set or `tsc` fails.
- Read-only feature: no forms, no mutations, no `onError` toast needed.
- Every query surface needs Loading + Error + Empty states (frontend.md rule) — already satisfied by the shared `DataTable`/`ErrorState`/`EmptyState` components used throughout this plan.

---

### Task 1: Add `useBillingInvoices` + `useBillingInvoice` hooks

**Files:**

- Modify: `apps/web/lib/platform-api/billing.ts:1-24` (imports + type aliases), `apps/web/lib/platform-api/billing.ts:30` (flag constants), insert new code after line 138 (end of `useBillingUsage`) and before line 140 (the "Writes" section divider comment)
- Test: `tests/billing/invoices-fe-wiring.test.ts` (new file)

**Interfaces:**

- Produces: `useBillingInvoices(): { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch }` where `data.pages` is an array of `{ items: InvoiceListItem[], nextCursor?: string }`. `useBillingInvoice(id: string): { data, isLoading, isError, refetch }` where `data` is `{ ...InvoiceListItem fields, subscription: SubscriptionShape | null }` (matches `RouterOutput['billing']['getInvoice']`).
- Consumes: nothing from other tasks (this task is self-contained; Task 3 consumes these two hook names).

- [ ] **Step 1: Write the failing wiring test**

Create `tests/billing/invoices-fe-wiring.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: FAIL — `useBillingInvoices`/`useBillingInvoice`/`NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` not found in `billing.ts` yet.

- [ ] **Step 3: Add the `useInfiniteQuery` import and new type aliases**

In `apps/web/lib/platform-api/billing.ts`, change line 12 from:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
```

to:

```typescript
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
```

Then, immediately after line 24 (`type CancelSubscriptionOutput = RouterOutput['billing']['cancelSubscription'];`), add:

```typescript
type ListInvoicesOutput = RouterOutput['billing']['listInvoices'];
type InvoiceListItem = ListInvoicesOutput['items'][number];
type GetInvoiceOutput = RouterOutput['billing']['getInvoice'];
type InvoiceSubscription = NonNullable<GetInvoiceOutput['subscription']>;
```

- [ ] **Step 4: Add the new flag constant**

Immediately after line 30 (`const BILLING_USAGE_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP === 'true';`), add:

```typescript
// A FOURTH, independent read surface (added 2026-07-28): tenant invoice history had ZERO FE
// consumer of any kind (TS or C#) until this wrapper. Own flag (not reused from
// BILLING_USAGE_VIA_CSHARP) since it cuts over independently of the other three billing reads.
const BILLING_INVOICES_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP === 'true';
```

- [ ] **Step 5: Add the raw-JSON type, mapping helpers, and the two hooks**

Find the end of `useBillingUsage` (the function ending at line 138 with `}`) and the divider comment block starting at line 140 (`// ---... Writes (Phase-5 Slice 4b) ...`). Insert the following block between them (i.e., right after `useBillingUsage`'s closing `}`, right before the `// ---` divider):

```typescript
// The C# /billing/invoices list endpoint has no `.Produces<T>()` annotation (verified in
// schema.d.ts: `content?: never` at 200), so its shape isn't in the generated contract —
// hand-typed here from the same Invoice model the tRPC `listInvoices` procedure queries
// (packages/api/src/routers/billing.ts), one field looser (string | number for numerics,
// unknown for date-times) matching every other raw-JSON mapper in this file.
interface RawInvoiceListItem {
  id: string;
  invoiceNumber: number | string;
  organizationId: string;
  subscriptionId: string | null;
  stripeInvoiceId: string | null;
  amount: number | string;
  subtotal: number | string | null;
  taxRate: number | string | null;
  currency: string;
  status: string;
  description: string | null;
  invoiceDate: unknown;
  dueDate: unknown;
  poNumber: string | null;
  notes: string | null;
  memo: string | null;
  emailTo: string | null;
  emailCc: string | null;
  paidAt: unknown;
  invoiceUrl: string | null;
  periodStart: unknown;
  periodEnd: unknown;
  createdAt: unknown;
}

function mapInvoiceListItem(raw: RawInvoiceListItem): InvoiceListItem {
  return {
    id: raw.id,
    invoiceNumber: num(raw.invoiceNumber),
    organizationId: raw.organizationId,
    subscriptionId: raw.subscriptionId,
    stripeInvoiceId: raw.stripeInvoiceId,
    amount: num(raw.amount),
    subtotal: numOrNull(raw.subtotal),
    taxRate: numOrNull(raw.taxRate),
    currency: raw.currency,
    status: raw.status as InvoiceListItem['status'],
    description: raw.description,
    invoiceDate: toDate(raw.invoiceDate),
    dueDate: toDateOrNull(raw.dueDate),
    poNumber: raw.poNumber,
    notes: raw.notes,
    memo: raw.memo,
    emailTo: raw.emailTo,
    emailCc: raw.emailCc,
    paidAt: toDateOrNull(raw.paidAt),
    invoiceUrl: raw.invoiceUrl,
    periodStart: toDateOrNull(raw.periodStart),
    periodEnd: toDateOrNull(raw.periodEnd),
    createdAt: toDate(raw.createdAt),
  };
}

// Mirrors useBillingCurrentPlan's raw→Date mapping above, applied to the nested subscription
// on a single invoice's detail (InvoiceDetailV1.subscription in schema.d.ts) — duplicated
// rather than shared to avoid touching the already-live useBillingCurrentPlan hook.
function mapInvoiceSubscription(raw: {
  id: string;
  organizationId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: string;
  status: string;
  currentPeriodStart: unknown;
  currentPeriodEnd: unknown;
  trialEndsAt: unknown;
  cancelledAt: unknown;
  lastStripeEventAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}): InvoiceSubscription {
  return {
    id: raw.id,
    organizationId: raw.organizationId,
    stripeCustomerId: raw.stripeCustomerId,
    stripeSubscriptionId: raw.stripeSubscriptionId,
    plan: raw.plan as InvoiceSubscription['plan'],
    status: raw.status as InvoiceSubscription['status'],
    currentPeriodStart: toDateOrNull(raw.currentPeriodStart),
    currentPeriodEnd: toDateOrNull(raw.currentPeriodEnd),
    trialEndsAt: toDateOrNull(raw.trialEndsAt),
    cancelledAt: toDateOrNull(raw.cancelledAt),
    lastStripeEventAt: toDateOrNull(raw.lastStripeEventAt),
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
  };
}

/**
 * Tenant invoice history, cursor-paginated (`take`/`cursor`, 20 per page — matches the tRPC
 * procedure's default). Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP
 * === 'true'`. First-ever FE consumer of this read surface (2026-07-28) — ships dark.
 *  - true  → GET /billing/invoices?take=&cursor= via {@link platformGetRaw} (this endpoint has
 *            no `.Produces<T>()` annotation, so it isn't in `GetPaths`/`platformGet`'s contract).
 *  - false → trpc.billing.listInvoices.useInfiniteQuery (the DEFAULT), matching
 *            trpc.notification.list.useInfiniteQuery's shape on the notifications page.
 */
export function useBillingInvoices() {
  const viaCSharp = isPlatformApiEnabled() && BILLING_INVOICES_VIA_CSHARP;

  const trpcQuery = trpc.billing.listInvoices.useInfiniteQuery(
    { take: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor, enabled: !viaCSharp },
  );

  const csharpQuery = useInfiniteQuery<ListInvoicesOutput>({
    queryKey: ['platform-api', 'billing', 'invoices'],
    enabled: viaCSharp,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    queryFn: async ({ pageParam }) => {
      const raw = (await platformGetRaw('/billing/invoices', {
        take: 20,
        cursor: pageParam as string | undefined,
      })) as { items: RawInvoiceListItem[]; nextCursor?: string };
      return {
        items: raw.items.map(mapInvoiceListItem),
        nextCursor: raw.nextCursor,
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Single invoice detail (1 call site: the invoices drawer on settings/billing). Gate as above.
 *  - true  → GET /billing/invoices/{id}, **typed** via {@link platformGet} (schema.d.ts confirms
 *            `InvoiceDetailV1` IS `.Produces<T>()`-annotated, unlike the list endpoint above).
 *  - false → trpc.billing.getInvoice.useQuery({ id }) (the DEFAULT).
 */
export function useBillingInvoice(id: string) {
  const viaCSharp = isPlatformApiEnabled() && BILLING_INVOICES_VIA_CSHARP;

  const trpcQuery = trpc.billing.getInvoice.useQuery({ id }, { enabled: !viaCSharp && id.length > 0 });

  const csharpQuery = useQuery<GetInvoiceOutput>({
    queryKey: ['platform-api', 'billing', 'invoice', id],
    enabled: viaCSharp && id.length > 0,
    queryFn: async () => {
      const raw = await platformGet('/billing/invoices/{id}', undefined, { id });
      return {
        ...mapInvoiceListItem(raw),
        subscription: raw.subscription ? mapInvoiceSubscription(raw.subscription) : null,
      };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}
```

- [ ] **Step 6: Run the wiring test to verify it passes**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: PASS (all 4 assertions in the `hooks wiring` describe block).

- [ ] **Step 7: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 errors. (If `mapInvoiceListItem`/`mapInvoiceSubscription`'s return types don't structurally match `InvoiceListItem`/`InvoiceSubscription`, fix the mismatched field before proceeding — do not loosen with `any`.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/platform-api/billing.ts tests/billing/invoices-fe-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): add dark-launch hooks for billing-invoices FE consumer

useBillingInvoices/useBillingInvoice mirror every other domain's
dark-launch pattern — trpc by default, C# behind
NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP (ships unset/off).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add new i18n keys

**Files:**

- Modify: `apps/web/lib/i18n/en.json:2878` (insert before the closing `},` of the `billing` object)
- Modify: `apps/web/lib/i18n/es.json:2878` (same insertion point)
- Test: `tests/billing/invoices-fe-wiring.test.ts` (extend with a new `describe` block)

**Interfaces:**

- Produces: `t.billing.invoicesTitle`, `t.billing.invoicesEmpty`, `t.billing.invoicesEmptyDesc`, `t.billing.invoiceColDate`, `t.billing.invoiceColAmount`, `t.billing.invoiceColStatus`, `t.billing.invoiceStatusDraft`, `t.billing.invoiceStatusPending`, `t.billing.invoiceStatusPaid`, `t.billing.invoiceStatusVoid`, `t.billing.loadMoreInvoices`, `t.billing.loadingMoreInvoices`, `t.billing.invoiceSubtotal`, `t.billing.invoiceTax`, `t.billing.invoicePoNumber`, `t.billing.invoiceNotes`, `t.billing.invoicePeriod`, `t.billing.invoiceDownload`, `t.billing.invoiceNumber`, `t.billing.invoiceDueDate` — all consumed by Task 3's component.
- Consumes: nothing from Task 1.

- [ ] **Step 1: Extend the wiring test with an i18n assertion (still failing)**

Add this `describe` block to `tests/billing/invoices-fe-wiring.test.ts` (append after the existing `describe` block, same file):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: FAIL on the new `i18n` describe block — keys don't exist yet.

- [ ] **Step 3: Add the English keys**

In `apps/web/lib/i18n/en.json`, find line 2878 (`"noOrgInvoices": "No invoices for this organization"`, the last key in the `billing` object, immediately before its closing `},`). Change it to add a trailing comma and insert the new keys after it:

```json
    "noOrgInvoices": "No invoices for this organization",
    "invoicesTitle": "Invoices",
    "invoicesEmpty": "No invoices yet",
    "invoicesEmptyDesc": "Invoices will appear here once generated.",
    "invoiceColDate": "Date",
    "invoiceColAmount": "Amount",
    "invoiceColStatus": "Status",
    "invoiceStatusDraft": "Draft",
    "invoiceStatusPending": "Pending",
    "invoiceStatusPaid": "Paid",
    "invoiceStatusVoid": "Void",
    "loadMoreInvoices": "Load more",
    "loadingMoreInvoices": "Loading...",
    "invoiceSubtotal": "Subtotal",
    "invoiceTax": "Tax",
    "invoicePoNumber": "PO number",
    "invoiceNotes": "Notes",
    "invoicePeriod": "Billing period",
    "invoiceDownload": "Download invoice",
    "invoiceNumber": "Invoice",
    "invoiceDueDate": "Due date"
```

- [ ] **Step 4: Add the Spanish keys**

In `apps/web/lib/i18n/es.json`, find line 2878 (`"noOrgInvoices": "No hay facturas para esta organización"`, same position). Change it to:

```json
    "noOrgInvoices": "No hay facturas para esta organización",
    "invoicesTitle": "Facturas",
    "invoicesEmpty": "Aun no hay facturas",
    "invoicesEmptyDesc": "Las facturas apareceran aqui una vez generadas.",
    "invoiceColDate": "Fecha",
    "invoiceColAmount": "Monto",
    "invoiceColStatus": "Estado",
    "invoiceStatusDraft": "Borrador",
    "invoiceStatusPending": "Pendiente",
    "invoiceStatusPaid": "Pagada",
    "invoiceStatusVoid": "Anulada",
    "loadMoreInvoices": "Cargar mas",
    "loadingMoreInvoices": "Cargando...",
    "invoiceSubtotal": "Subtotal",
    "invoiceTax": "Impuesto",
    "invoicePoNumber": "Numero de orden de compra",
    "invoiceNotes": "Notas",
    "invoicePeriod": "Periodo de facturacion",
    "invoiceDownload": "Descargar factura",
    "invoiceNumber": "Factura",
    "invoiceDueDate": "Fecha de vencimiento"
```

- [ ] **Step 5: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/es.json','utf8')); console.log('valid')"`
Expected: `valid` printed, no parse errors.

- [ ] **Step 6: Run the wiring test to verify it passes**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 7: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 errors (confirms `en.json`'s shape still structurally matches `es.json`'s `Translations` type).

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/billing/invoices-fe-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): add i18n keys for billing-invoices FE consumer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Build the `BillingInvoices` component and wire it into the billing page

**Files:**

- Create: `apps/web/app/(admin)/settings/billing/billing-invoices.tsx`
- Modify: `apps/web/app/(admin)/settings/billing/page.tsx` (add import + render `<BillingInvoices />`)
- Test: `tests/billing/invoices-fe-wiring.test.ts` (extend with a new `describe` block)

**Interfaces:**

- Consumes: `useBillingInvoices()`, `useBillingInvoice(id: string)` from Task 1 (exact names/signatures as produced there); `t.billing.*` keys from Task 2 (exact key names as produced there); shared components `DataTable`, `Drawer`, `EmptyState`, `ErrorState`, `StatusBadge` from `apps/web/components` (existing); `formatCurrency`, `formatDate` from `apps/web/lib/format-utils` (existing).
- Produces: `export function BillingInvoices()` — a self-contained card component, no props, consumed only by `page.tsx`.

- [ ] **Step 1: Extend the wiring test with a component-structure assertion (still failing)**

Add this final `describe` block to `tests/billing/invoices-fe-wiring.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: FAIL on the new `component` describe block — `billing-invoices.tsx` doesn't exist yet, `page.tsx` doesn't import it yet.

- [ ] **Step 3: Create `apps/web/app/(admin)/settings/billing/billing-invoices.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { useBillingInvoices, useBillingInvoice } from '../../../../lib/platform-api/billing';
import { formatCurrency, formatDate } from '../../../../lib/format-utils';
import { DataTable, Drawer, EmptyState, ErrorState, StatusBadge } from '../../../../components';

type T = ReturnType<typeof useI18n>['t'];

function invoiceStatusMap(t: T): Record<string, { cls: string; label: string }> {
  return {
    draft: { cls: 'bg-gray-100 text-gray-600', label: t.billing.invoiceStatusDraft },
    pending: { cls: 'bg-amber-100 text-amber-700', label: t.billing.invoiceStatusPending },
    paid: { cls: 'bg-green-100 text-green-700', label: t.billing.invoiceStatusPaid },
    void: { cls: 'bg-red-100 text-red-700', label: t.billing.invoiceStatusVoid },
  };
}

function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const invoice = useBillingInvoice(id);

  return (
    <Drawer title={invoice.data ? `${t.billing.invoiceNumber} INV-${invoice.data.invoiceNumber}` : t.billing.invoiceNumber} onClose={onClose}>
      {invoice.isError ? (
        <ErrorState onRetry={() => invoice.refetch()} />
      ) : invoice.isLoading || !invoice.data ? (
        <p className="text-[13px] text-[#8B8B8B]">{t.common.loading}</p>
      ) : (
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColAmount}</span>
            <span className="font-semibold text-[#1F114C]">{formatCurrency(invoice.data.amount, invoice.data.currency, 2)}</span>
          </div>
          {invoice.data.subtotal != null && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceSubtotal}</span>
              <span className="text-[#333]">{formatCurrency(invoice.data.subtotal, invoice.data.currency, 2)}</span>
            </div>
          )}
          {invoice.data.taxRate != null && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceTax}</span>
              <span className="text-[#333]">{invoice.data.taxRate}%</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColStatus}</span>
            <StatusBadge status={invoice.data.status} map={invoiceStatusMap(t)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8B8B8B]">{t.billing.invoiceColDate}</span>
            <span className="text-[#333]">{formatDate(invoice.data.invoiceDate)}</span>
          </div>
          {invoice.data.dueDate && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoiceDueDate}</span>
              <span className="text-[#333]">{formatDate(invoice.data.dueDate)}</span>
            </div>
          )}
          {(invoice.data.periodStart || invoice.data.periodEnd) && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoicePeriod}</span>
              <span className="text-[#333]">
                {formatDate(invoice.data.periodStart)} - {formatDate(invoice.data.periodEnd)}
              </span>
            </div>
          )}
          {invoice.data.poNumber && (
            <div className="flex items-center justify-between">
              <span className="text-[#8B8B8B]">{t.billing.invoicePoNumber}</span>
              <span className="text-[#333]">{invoice.data.poNumber}</span>
            </div>
          )}
          {invoice.data.notes && (
            <div>
              <span className="text-[#8B8B8B] block mb-1">{t.billing.invoiceNotes}</span>
              <p className="text-[#333] whitespace-pre-wrap">{invoice.data.notes}</p>
            </div>
          )}
          {invoice.data.invoiceUrl && (
            <a
              href={invoice.data.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 h-9 inline-flex items-center justify-center rounded-lg border border-[#EDEDED] text-[#1F114C] text-[12px] font-medium hover:bg-[#F6F6F6] transition"
            >
              {t.billing.invoiceDownload}
            </a>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function BillingInvoices() {
  const { t } = useI18n();
  const [openId, setOpenId] = useState<string | null>(null);
  const invoices = useBillingInvoices();

  const rows = invoices.data?.pages.flatMap((p) => p.items) ?? [];
  const statusMap = invoiceStatusMap(t);

  const columns = [
    { key: 'date', label: t.billing.invoiceColDate },
    { key: 'amount', label: t.billing.invoiceColAmount, align: 'right' as const },
    { key: 'status', label: t.billing.invoiceColStatus, align: 'center' as const },
  ];

  const emptyIcon = (
    <svg className="w-10 h-10 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  return (
    <div className="bg-white border border-[#EDEDED] rounded-xl p-5">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-3">{t.billing.invoicesTitle}</h2>

      {invoices.isError ? (
        <ErrorState onRetry={() => invoices.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            loading={invoices.isLoading}
            empty={<EmptyState icon={emptyIcon} message={t.billing.invoicesEmpty} description={t.billing.invoicesEmptyDesc} />}
          >
            {rows.map((inv) => (
              <tr
                key={inv.id}
                className="border-b border-[#F6F6F6] last:border-0 hover:bg-[#FAFAFA] transition cursor-pointer"
                onClick={() => setOpenId(inv.id)}
              >
                <td className="px-4 py-3 text-xs text-[#585858]">{formatDate(inv.invoiceDate)}</td>
                <td className="px-4 py-3 text-right text-sm font-semibold text-[#333]">
                  {formatCurrency(inv.amount, inv.currency, 2)}
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={inv.status} map={statusMap} />
                </td>
              </tr>
            ))}
          </DataTable>

          {invoices.hasNextPage && (
            <div className="mt-3 text-center">
              <button
                onClick={() => invoices.fetchNextPage()}
                disabled={invoices.isFetchingNextPage}
                className="h-9 px-6 rounded-lg border border-[#EDEDED] text-[#1F114C] text-[12px] font-medium hover:bg-[#F6F6F6] transition disabled:opacity-50"
              >
                {invoices.isFetchingNextPage ? t.billing.loadingMoreInvoices : t.billing.loadMoreInvoices}
              </button>
            </div>
          )}
        </>
      )}

      {openId && <InvoiceDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into `page.tsx`**

In `apps/web/app/(admin)/settings/billing/page.tsx`, change the import block at the top (currently ending with `import { BillingPlans } from './billing-plans';` at line 17) to add:

```typescript
import { BillingPlans } from './billing-plans';
import { BillingInvoices } from './billing-invoices';
```

Then change the final line of the return JSX (line 230, `<BillingPlans currentPlan={currentPlan} configured={configured} />`) to:

```typescript
        <BillingPlans currentPlan={currentPlan} configured={configured} />
        <BillingInvoices />
```

- [ ] **Step 5: Run the wiring test to verify it passes**

Run: `npx vitest run tests/billing/invoices-fe-wiring.test.ts`
Expected: PASS (all 3 describe blocks, 6 total assertions).

- [ ] **Step 6: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no regressions in unrelated suites — this change touches only `billing.ts`, two i18n files, one new component file, and `page.tsx`'s render).

- [ ] **Step 8: Manual smoke test**

Run: `cd apps/web && pnpm dev`, log in as a tenant user, navigate to Settings > Billing. Confirm:

- The "Invoices" card renders below the Plans section.
- If the org has zero invoices, the empty state shows (icon + "No invoices yet" + description).
- If the org has invoices, the list renders with Date/Amount/Status columns, and clicking a row opens the detail drawer with no console errors.
- No behavior change anywhere else on the page (flag is unset, so this is 100% additive).

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/\(admin\)/settings/billing/billing-invoices.tsx apps/web/app/\(admin\)/settings/billing/page.tsx tests/billing/invoices-fe-wiring.test.ts
git commit -m "$(cat <<'EOF'
feat(billing): add billing-invoices FE consumer (settings/billing page)

First-ever FE consumer for the already-parity-verified-live
billing-invoices(read) surface. List + detail drawer, dark by
default behind NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Final gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full local verify gate**

Run: `cd apps/web && npx tsc --noEmit && cd .. && npx tsc --noEmit --project packages/api/tsconfig.json 2>/dev/null; pnpm --filter @tims/api exec tsc --noEmit`
Expected: 0 errors on both `@tims/api` and `@tims/web` (per CLAUDE.md's PR requirement — `@tims/api` should be unaffected since this plan makes no backend changes, but the gate still runs it for safety).

- [ ] **Step 2: Run the full test suite one more time**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 3: Confirm the new flag is genuinely dark**

Run: `grep -n "NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP" apps/web/lib/platform-api/billing.ts`
Expected: exactly one definition (`const BILLING_INVOICES_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP === 'true';`), no other file in the repo setting it to `'true'` — confirm with `grep -rn "NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP" . --include=*.env* --include=vercel.json 2>/dev/null` returning nothing.

- [ ] **Step 4: Report completion**

Summarize for Federico: hooks + component + i18n shipped, flag dark, ready for his own manual review before deciding whether/when to flip `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` in Vercel (his call, separate from this plan).

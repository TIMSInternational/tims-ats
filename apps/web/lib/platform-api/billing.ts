'use client';

// This file now mixes TWO states across its hooks:
//
// C#-only (useBillingConfig / useBillingCurrentPlan / useBillingUsage) — the TS tRPC procedures
// (getBillingConfig/getCurrentPlan/getUsage in packages/api/src/routers/billing.ts) have been
// deleted — there is no TS fallback path left for these three. NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP
// is confirmed live in prod (2026-07-29) and local dev's .env.local mirrors production values
// directly, so these hooks call the C# service unconditionally rather than gating on the flag
// (mirrors lib/platform-api/team-intel.ts's precedent for a fully-deleted surface). Since these
// TS procedures are gone, two of the three C# outputs below are hand-declared rather than
// `inferRouterOutputs`-derived (see BillingConfigOutput/Subscription below).
//
// Still genuinely DARK-by-default (useBillingInvoices / useBillingInvoice, gated on
// NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP; and the 3 self-serve write mutations, gated on
// NEXT_PUBLIC_BILLING_SELF_SERVE_WRITE_VIA_CSHARP) — unless their respective env vars are set at
// deploy time, these hooks return the existing tRPC query/mutation unchanged (byte-identical to
// today). The C# useQuery/useMutation for these is typed to the EXACT tRPC output type
// (inferRouterOutputs), so each mapper below is compile-time-locked to the live contract's shape —
// including the superjson Date semantics on the invoice date fields.

import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import type { UsageView } from '@tims/shared';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformGetRaw, platformPostRaw } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type CreateCheckoutSessionOutput = RouterOutput['billing']['createCheckoutSession'];
type CreatePortalSessionOutput = RouterOutput['billing']['createPortalSession'];
type CancelSubscriptionOutput = RouterOutput['billing']['cancelSubscription'];
type ListInvoicesOutput = RouterOutput['billing']['listInvoices'];
type InvoiceListItem = ListInvoicesOutput['items'][number];
type GetInvoiceOutput = RouterOutput['billing']['getInvoice'];
type InvoiceSubscription = NonNullable<GetInvoiceOutput['subscription']>;

// getBillingConfig's output — the TS tRPC procedure has been deleted, so this can no longer
// be derived via inferRouterOutputs; hand-declared to match its one field exactly.
interface BillingConfigOutput {
  configured: boolean;
}

// getCurrentPlan's output — the Prisma Subscription row or null (findUnique parity). The TS
// tRPC procedure has been deleted; hand-declared to match packages/db/prisma/schema/billing.prisma's
// Subscription model exactly (duplicated rather than reusing InvoiceSubscription below, which is a
// distinct concern — mirrors this file's own established convention, see mapInvoiceSubscription's comment).
interface Subscription {
  id: string;
  organizationId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: 'trial' | 'starter' | 'professional' | 'enterprise';
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelledAt: Date | null;
  lastStripeEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type CurrentPlanOutput = Subscription | null;

// A FOURTH, independent read surface (added 2026-07-28): tenant invoice history had ZERO FE
// consumer of any kind (TS or C#) until this wrapper. Its own independent flag, since it cuts
// over independently of the other three (now C#-only) billing reads above.
const BILLING_INVOICES_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP === 'true';

const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

// The C# service serializes every DateTime as a canonical Node-ISO string (…fffZ) via
// NodeIsoDateTimeOffsetConverter; superjson on the tRPC path deserializes the same instants to
// real Date objects. The tRPC output type (Prisma Subscription) declares these fields as Date, so
// the C# path must reconstruct Date objects to be byte-identical at cutover (the billing page does
// `new Date(currentPeriodEnd).toLocaleDateString()` — a Date input clones fine either way, but the
// TYPE must match). The contract types the raw values as `unknown`; narrow null, else parse.
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/** Whether Stripe self-serve billing is configured for this deploy. GET /billing/config. */
export function useBillingConfig() {
  return useQuery<BillingConfigOutput>({
    queryKey: ['platform-api', 'billing', 'config'],
    queryFn: async () => {
      const raw = await platformGet('/billing/config');
      return { configured: raw.configured };
    },
  });
}

/** The org's raw Subscription row (full model) or `null` (findUnique parity). GET /billing/plan. */
export function useBillingCurrentPlan() {
  return useQuery<CurrentPlanOutput>({
    queryKey: ['platform-api', 'billing', 'plan'],
    queryFn: async () => {
      const raw = await platformGet('/billing/plan');
      if (raw == null) return null;
      return {
        id: raw.id,
        organizationId: raw.organizationId,
        stripeCustomerId: raw.stripeCustomerId,
        stripeSubscriptionId: raw.stripeSubscriptionId,
        // DB-enum strings on the wire → the Prisma OrgPlan / SubscriptionStatus unions.
        // The C# service only ever emits valid DB enum values.
        plan: raw.plan as NonNullable<CurrentPlanOutput>['plan'],
        status: raw.status as NonNullable<CurrentPlanOutput>['status'],
        currentPeriodStart: toDateOrNull(raw.currentPeriodStart),
        currentPeriodEnd: toDateOrNull(raw.currentPeriodEnd),
        trialEndsAt: toDateOrNull(raw.trialEndsAt),
        cancelledAt: toDateOrNull(raw.cancelledAt),
        lastStripeEventAt: toDateOrNull(raw.lastStripeEventAt),
        createdAt: toDate(raw.createdAt),
        updatedAt: toDate(raw.updatedAt),
      };
    },
  });
}

/** Usage — real org-scoped counts + entitled-plan limits. GET /billing/usage. */
export function useBillingUsage() {
  return useQuery<UsageView>({
    queryKey: ['platform-api', 'billing', 'usage'],
    queryFn: async () => {
      const raw = await platformGet('/billing/usage');
      return {
        employees: { used: num(raw.employees.used), limit: numOrNull(raw.employees.limit) },
        vacancies: { used: num(raw.vacancies.used), limit: numOrNull(raw.vacancies.limit) },
        assessments: { used: num(raw.assessments.used), limit: numOrNull(raw.assessments.limit) },
        // No metering source yet — always-null nested objects, matching buildUsageView (rule #4).
        storage: { usedMb: null, limitMb: null },
        apiCalls: { used: null, limit: null },
        periodStart: raw.periodStart == null ? null : String(raw.periodStart),
        periodEnd: raw.periodEnd == null ? null : String(raw.periodEnd),
      };
    },
  });
}

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

// ---------------------------------------------------------------------------
// Writes (Phase-5 Slice 4b) — a SEPARATE flag from the reads above, mirroring backend
// `Platform:BillingSelfServeEnabled` (independent of BillingUsageEnabled). All 3 C# self-serve
// mutations (createCheckoutSession/createPortalSession/cancelSubscription) have live FE consumers
// (billing-plans.tsx, settings/billing/page.tsx) — a 100% wrap rate, as compensation's writes also
// had before their TS side was deleted (they are C#-only now). Each hook
// mirrors trpc's useMutation shape ({ onSuccess?, onError? }); MutationOptions is generic over TData
// (like ninebox's/engagement's) because both consumers redirect via `window.location.href = url`
// from the resolved data. Uses {@link platformPostRaw} (NOT the typed platformPost) because all
// three C# endpoints return an anonymous object (`Results.Ok(new { url })` / `{ cancelAtPeriodEnd }`)
// with no `.Produces<T>()` annotation — the generated OpenAPI contract has no typed 200 body for
// these paths, so `PostPaths`/`platformPost` can't accept them (verified in schema.d.ts: `content?:
// never` at 200 for all three operations).
// ---------------------------------------------------------------------------

const BILLING_SELF_SERVE_WRITE_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_SELF_SERVE_WRITE_VIA_CSHARP === 'true';

interface MutationOptions<TData = void> {
  onSuccess?: (data: TData) => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput, TData>(
  mutationFn: (input: TInput) => Promise<TData>,
  options: MutationOptions<TData> | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

interface CreateCheckoutSessionInputShape {
  plan: string;
}

/** STAFF: create a Stripe Checkout session for a self-serve plan (1 call site: billing-plans.tsx). */
export function useBillingCreateCheckoutSession(options?: MutationOptions<CreateCheckoutSessionOutput>) {
  const viaCSharp = isPlatformApiEnabled() && BILLING_SELF_SERVE_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.billing.createCheckoutSession.useMutation(options);
  const csharpMutation = useCSharpMutation(async (input: CreateCheckoutSessionInputShape) => {
    const raw = (await platformPostRaw('/billing/checkout-session', { plan: input.plan })) as { url: string };
    return { url: raw.url } satisfies CreateCheckoutSessionOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

/** STAFF: create a Stripe Billing Portal session (1 call site: settings/billing/page.tsx). */
export function useBillingCreatePortalSession(options?: MutationOptions<CreatePortalSessionOutput>) {
  const viaCSharp = isPlatformApiEnabled() && BILLING_SELF_SERVE_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.billing.createPortalSession.useMutation(options);
  const csharpMutation = useCSharpMutation(async () => {
    const raw = (await platformPostRaw('/billing/portal-session', undefined)) as { url: string };
    return { url: raw.url } satisfies CreatePortalSessionOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

/** STAFF: cancel the subscription at period end (1 call site: settings/billing/page.tsx). */
export function useBillingCancelSubscription(options?: MutationOptions<CancelSubscriptionOutput>) {
  const viaCSharp = isPlatformApiEnabled() && BILLING_SELF_SERVE_WRITE_VIA_CSHARP;
  const trpcMutation = trpc.billing.cancelSubscription.useMutation(options);
  const csharpMutation = useCSharpMutation(async () => {
    await platformPostRaw('/billing/cancel-subscription', undefined);
    return { cancelAtPeriodEnd: true } satisfies CancelSubscriptionOutput;
  }, options);
  return viaCSharp ? csharpMutation : trpcMutation;
}

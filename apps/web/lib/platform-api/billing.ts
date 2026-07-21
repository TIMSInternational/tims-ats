'use client';

// Per-surface read gate for the three billing reads (config / current-plan / usage) — the
// third read surface staged to route to the C# Platform service. DARK by default: unless
// BOTH env vars are set at deploy time, every hook returns the existing tRPC query unchanged
// (byte-identical to today). Merging changes nothing in prod until Federico flips the flag.
//
// Mirrors lib/platform-api/team-intel.ts exactly. The C# useQuery is typed to the EXACT tRPC
// output type (inferRouterOutputs), so each mapper below is compile-time-locked to the live
// contract's shape — including the superjson Date semantics on the getCurrentPlan subscription.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type BillingConfigOutput = RouterOutput['billing']['getBillingConfig'];
type CurrentPlanOutput = RouterOutput['billing']['getCurrentPlan'];
type UsageOutput = RouterOutput['billing']['getUsage'];

// All three live behind the C# `Platform:BillingUsageEnabled` backend flag (verified in
// services/Tims.Platform/src/Tims.Api/Billing/BillingUsageEndpoints.cs — getUsage /getCurrentPlan
// /getBillingConfig are all mapped by MapBillingUsageEndpoints, gated on BillingUsageEnabled), so
// they share ONE FE flag mirroring that backend flag. NEXT_PUBLIC_* so it is inlined for the browser.
const BILLING_USAGE_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP === 'true';

const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

// The C# service serializes every DateTime as a canonical Node-ISO string (…fffZ) via
// NodeIsoDateTimeOffsetConverter; superjson on the tRPC path deserializes the same instants to
// real Date objects. The tRPC output type (Prisma Subscription) declares these fields as Date, so
// the C# path must reconstruct Date objects to be byte-identical at cutover (the billing page does
// `new Date(currentPeriodEnd).toLocaleDateString()` — a Date input clones fine either way, but the
// TYPE must match). The contract types the raw values as `unknown`; narrow null, else parse.
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * Whether Stripe self-serve billing is configured for this deploy. Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP === 'true'`.
 *  - true  → GET /billing/config; false → trpc.billing.getBillingConfig.useQuery (the DEFAULT).
 */
export function useBillingConfig() {
  const viaCSharp = isPlatformApiEnabled() && BILLING_USAGE_VIA_CSHARP;

  const trpcQuery = trpc.billing.getBillingConfig.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<BillingConfigOutput>({
    queryKey: ['platform-api', 'billing', 'config'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/billing/config');
      return { configured: raw.configured };
    },
  });

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * The org's raw Subscription row (full model) or `null` (findUnique parity). Gate as above.
 *  - true  → GET /billing/plan (200 body is the subscription object OR the literal `null`);
 *            ISO date strings are rebuilt into Date objects and the plan/status DB-enum strings
 *            are narrowed to the Prisma enum unions.
 *  - false → trpc.billing.getCurrentPlan.useQuery (the DEFAULT).
 */
export function useBillingCurrentPlan() {
  const viaCSharp = isPlatformApiEnabled() && BILLING_USAGE_VIA_CSHARP;

  const trpcQuery = trpc.billing.getCurrentPlan.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<CurrentPlanOutput>({
    queryKey: ['platform-api', 'billing', 'plan'],
    enabled: viaCSharp,
    queryFn: async () => {
      const raw = await platformGet('/billing/plan');
      if (raw == null) return null;
      return {
        id: raw.id,
        organizationId: raw.organizationId,
        stripeCustomerId: raw.stripeCustomerId,
        stripeSubscriptionId: raw.stripeSubscriptionId,
        // DB-enum strings on the wire → the Prisma OrgPlan / SubscriptionStatus unions the tRPC
        // output declares (the C# service only ever emits valid DB enum values).
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * Usage — real org-scoped counts + entitled-plan limits (honest null storage/apiCalls). Gate as
 * above.
 *  - true  → GET /billing/usage (numeric artifacts coerced; storage/apiCalls stay null; the ISO
 *            period strings pass through as string|null — the same shape buildUsageView emits).
 *  - false → trpc.billing.getUsage.useQuery (the DEFAULT).
 */
export function useBillingUsage() {
  const viaCSharp = isPlatformApiEnabled() && BILLING_USAGE_VIA_CSHARP;

  const trpcQuery = trpc.billing.getUsage.useQuery(undefined, { enabled: !viaCSharp });

  const csharpQuery = useQuery<UsageOutput>({
    queryKey: ['platform-api', 'billing', 'usage'],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

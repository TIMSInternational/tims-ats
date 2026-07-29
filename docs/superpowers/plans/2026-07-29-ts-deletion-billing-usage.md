# TS Deletion: billing-usage (`getBillingConfig`/`getCurrentPlan`/`getUsage`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead TS fallback for billing-usage's 3 read procedures (`getBillingConfig`, `getCurrentPlan`, `getUsage`) — their shared C# cutover flag, `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`, is confirmed live in prod — and truth up every doc/tooling reference that assumed a live TS side existed. This is the 4th domain through this pattern (after reporting, evaluation360, team-intel).

**Architecture:** Same "router + wrapper only" scope as the 3 prior deletions: delete the 3 dead procedures and their FE fallback branches, keep shared kernel helpers (`buildUsageView`, `entitledPlan`, `planLimits` in `@tims/shared`) as an orphaned-but-harmless rollback safety net (a golden-fixture test already covers them directly, independent of the router). Unlike team-intel (1 procedure alone in its wrapper file) and unlike reporting/evaluation360 (whole-router deletions), this is a **partial deletion inside a wrapper file that keeps 5 other hooks alive** — `apps/web/lib/platform-api/billing.ts` also exports `useBillingInvoices`/`useBillingInvoice` (gated on the still-dark `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP`) and 3 self-serve mutation hooks (gated on the still-dark `NEXT_PUBLIC_BILLING_SELF_SERVE_WRITE_VIA_CSHARP`) — none of those 5 are touched.

**Tech Stack:** tRPC (`packages/api`), Next.js/React Query (`apps/web`), TypeScript strict mode, Prisma (`@tims/db`).

## Global Constraints

- Do NOT delete `packages/api/src/routers/billing.ts` itself (`listInvoices`, `getInvoice`, `createCheckoutSession`, `createPortalSession`, `cancelSubscription` stay, all still dark behind other flags).
- Do NOT delete `apps/web/lib/platform-api/billing.ts` itself, and do NOT touch `useBillingInvoices`, `useBillingInvoice`, `useBillingCreateCheckoutSession`, `useBillingCreatePortalSession`, `useBillingCancelSubscription` or any code that exclusively serves them (`RawInvoiceListItem`, `mapInvoiceListItem`, `mapInvoiceSubscription`, `BILLING_INVOICES_VIA_CSHARP`, `BILLING_SELF_SERVE_WRITE_VIA_CSHARP`, `useCSharpMutation`, `MutationOptions`, `CreateCheckoutSessionInputShape`, and the `ListInvoicesOutput`/`InvoiceListItem`/`GetInvoiceOutput`/`InvoiceSubscription`/`CreateCheckoutSessionOutput`/`CreatePortalSessionOutput`/`CancelSubscriptionOutput` type aliases derived from `RouterOutput`).
- Keep `packages/shared/src/constants/index.ts`'s `buildUsageView`/`UsageViewInput`/`UsageView`/`entitledPlan`/`planLimits` exports in place, unmodified — `tests/billing/usage-plan-config-fixtures.test.ts` golden-fixture-tests them directly (imports from `@tims/shared` and `packages/api/src/lib/stripe`, NOT from the router), so it needs zero changes and must still pass.
- `tsc --noEmit` must pass on both `@tims/api` and `@tims/web` after this change.
- Full `npx vitest run` (repo root) must pass, not just `tsc`.
- `.env.example`'s `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP` comment becomes stale after this change (same known gap hit on every prior domain) — this repo's `.claude/settings.json` denies editing `.env.*` files for AI agents, so this task hands Federico the exact patch to apply himself.
- The parity-harness README (`scripts/parity/README.md`) and the cutover README's "worked example" walkthrough (`scripts/deploy/README-cutover.md`) both currently use `billing-usage` as their illustrative example surface — precisely because it was the most recently still-flippable surface when team-intel's own deletion made `team-intel` unusable as an example. This task must swap both to a surface that is NOT part of this deletion wave: use **`compensation`** (its `compensation` surface key covers only the FX-free read subset, status `FLIP_READY`, single clean flag `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP` — not scheduled for deletion until a later task in this same sequence, so it will remain a valid example for the next 2 domains' worth of work).

---

### Task 1: Delete the dead TS code + truth-up parity/cutover tooling + swap the stale worked-example surface

**Files:**

- Modify: `apps/web/lib/platform-api/billing.ts` (remove the 3 dead hooks' tRPC-fallback branches + 3 now-unused `RouterOutput['billing'][...]` type aliases, replaced with hand-declared/reused types; keep everything else in the file untouched)
- Modify: `packages/api/src/routers/billing.ts` (delete `getBillingConfig`/`getCurrentPlan`/`getUsage` + the now-unused `buildUsageView` import)
- Modify: `apps/web/app/(admin)/settings/billing/page.tsx` (remove the dead `utils.billing.getCurrentPlan.invalidate()` belt-and-suspenders call + the now-unused `trpc` import and `utils`/`trpc.useUtils()` variable)
- Modify: `scripts/parity/surfaces.ts` (remove the `'billing-usage'` entry + its doc-comment block)
- Modify: `scripts/parity/surfaces.test.ts` (remove the 2 tests asserting `SURFACES['billing-usage']`'s shape)
- Modify: `scripts/deploy/cutover.sh` (billing-usage's case branch: `verify`/`FLIP_READY` → `NONE`/`TS_DELETED`)
- Modify: `scripts/deploy/README-cutover.md` (table row status change; swap the "worked example" walkthrough from `billing-usage` to `compensation`; update the "why not X" explanatory prose to include billing-usage)
- Modify: `scripts/parity/README.md` (swap its one-line example command from `billing-usage` back... to `compensation` — it currently says `verify billing-usage`, a stale reference left over from team-intel's own fix round, since billing-usage is the surface THIS task deletes)
- Test: `tests/billing/usage-plan-config-fixtures.test.ts` needs ZERO changes (verified — it imports the kernel functions directly from `@tims/shared`/`packages/api/src/lib/stripe`, never from the router); this task relies on `tsc` + the full `vitest run` catching any other regression.

**Interfaces:**

- Consumes: nothing from earlier tasks (first and only task).
- Produces: `useBillingConfig()`, `useBillingCurrentPlan()`, `useBillingUsage()` in `apps/web/lib/platform-api/billing.ts` — same exported names, same return shapes, same `queryKey`s (`['platform-api', 'billing', 'config']` / `['platform-api', 'billing', 'plan']` / `['platform-api', 'billing', 'usage']`) — so `apps/web/app/(admin)/settings/billing/page.tsx`'s 3 call sites (`useBillingConfig()`, `useBillingCurrentPlan()`, `useBillingUsage()`) need zero changes to their own lines (only the separate dead-invalidate-call cleanup below touches that file).

- [ ] **Step 1: Rewrite the 3 dead hooks in the FE wrapper to call the C# service unconditionally**

In `apps/web/lib/platform-api/billing.ts`, first replace the 3 now-obsolete type aliases. Change:

```typescript
type RouterOutput = inferRouterOutputs<AppRouter>;
type BillingConfigOutput = RouterOutput['billing']['getBillingConfig'];
type CurrentPlanOutput = RouterOutput['billing']['getCurrentPlan'];
type UsageOutput = RouterOutput['billing']['getUsage'];
type CreateCheckoutSessionOutput = RouterOutput['billing']['createCheckoutSession'];
type CreatePortalSessionOutput = RouterOutput['billing']['createPortalSession'];
type CancelSubscriptionOutput = RouterOutput['billing']['cancelSubscription'];
type ListInvoicesOutput = RouterOutput['billing']['listInvoices'];
type InvoiceListItem = ListInvoicesOutput['items'][number];
type GetInvoiceOutput = RouterOutput['billing']['getInvoice'];
type InvoiceSubscription = NonNullable<GetInvoiceOutput['subscription']>;
```

to (adding a `UsageView` import from `@tims/shared`, hand-declaring `BillingConfigOutput` and a fresh `Subscription`-shaped `CurrentPlanOutput` — deliberately NOT reusing `InvoiceSubscription`, matching this file's own established convention a few lines below of duplicating rather than cross-wiring unrelated concerns' types):

```typescript
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
```

Then add a new import for `UsageView` (getUsage's output type is the real, already-exported return type of `buildUsageView` — no hand-declaration needed, it's an exact match). Change:

```typescript
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformGetRaw, platformPostRaw } from './client';
```

to:

```typescript
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import type { UsageView } from '@tims/shared';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, platformGetRaw, platformPostRaw } from './client';
```

Then, further down, change `type UsageOutput = RouterOutput['billing']['getUsage'];`-equivalent usage — there is no separate line for it (it was removed above as part of the type-alias block edit); instead, everywhere the file currently reads `UsageOutput` as a type name, use `UsageView` directly. Concretely, change:

```typescript
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
```

to (C#-only, no tRPC branch, using `UsageView` directly as the query's generic):

```typescript
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
```

Change:

```typescript
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
```

to:

```typescript
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
```

Change:

```typescript
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
```

to:

```typescript
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
```

Finally, delete the now-unused `BILLING_USAGE_VIA_CSHARP` constant declaration:

```typescript
// All three live behind the C# `Platform:BillingUsageEnabled` backend flag (verified in
// services/Tims.Platform/src/Tims.Api/Billing/BillingUsageEndpoints.cs — getUsage /getCurrentPlan
// /getBillingConfig are all mapped by MapBillingUsageEndpoints, gated on BillingUsageEnabled), so
// they share ONE FE flag mirroring that backend flag. NEXT_PUBLIC_* so it is inlined for the browser.
const BILLING_USAGE_VIA_CSHARP = process.env.NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP === 'true';
```

— delete this whole block (comment + declaration). Do NOT delete `BILLING_INVOICES_VIA_CSHARP` or `BILLING_SELF_SERVE_WRITE_VIA_CSHARP` (still used by the untouched hooks). `isPlatformApiEnabled` and `trpc` stay imported — both are still used by `useBillingInvoices`/`useBillingInvoice`/the 3 mutation hooks.

- [ ] **Step 2: Delete the 3 dead procedures from the router**

In `packages/api/src/routers/billing.ts`, delete:

```typescript
  // Whether Stripe self-serve billing is configured for this deploy. The UI uses
  // this to show/hide Upgrade/Manage — config presence IS the gate (no flag).
  getBillingConfig: permissionProcedure('billing', 'read').query(() => ({
    configured: billingService.isConfigured(),
  })),

  // Get current subscription / plan
  getCurrentPlan: permissionProcedure('billing', 'read').query(async ({ ctx }) => {
    return db.subscription.findUnique({
      where: { organizationId: ctx.user.organizationId },
    });
  }),

  // Get usage — REAL counts. Plan limits are not modeled yet (null), and
  // storage / API-call metering has no source yet (null) — honest unavailable,
  // never fabricated (rule #4). Limits + Stripe-backed quotas arrive in Wave 2.
  getUsage: permissionProcedure('billing', 'read').query(async ({ ctx }) => {
    const orgId = ctx.user.organizationId;
    const sub = await db.subscription.findUnique({
      where: { organizationId: orgId },
      select: { currentPeriodStart: true, currentPeriodEnd: true, plan: true, status: true },
    });
    const periodStart = sub?.currentPeriodStart ?? null;

    const [employees, vacancies, assessments] = await Promise.all([
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.vacancy.count({
        where: { organizationId: orgId, deletedAt: null, status: { notIn: ['closed', 'cancelled'] } },
      }),
      db.assessmentAssignment.count({
        where: { organizationId: orgId, ...(periodStart ? { assignedAt: { gte: periodStart } } : {}) },
      }),
    ]);

    // The envelope (entitled-plan limits + honest null storage/apiCalls + ISO periods) is built by the
    // pure `buildUsageView` in @tims/shared — the SINGLE source of truth the C# billing port golden-fixtures
    // against (usage-view.json). Keep the counts here (DB); the builder is pure formatting + limits.
    return buildUsageView({
      employees,
      vacancies,
      assessments,
      plan: sub?.plan,
      status: sub?.status,
      periodStart,
      periodEnd: sub?.currentPeriodEnd ?? null,
    });
  }),

```

(everything from the `// Whether Stripe self-serve...` comment through the blank line right after `getUsage`'s closing `}),`, immediately before the `// List invoices` comment that precedes `listInvoices`). `listInvoices`, `getInvoice`, and the 3 write procedures stay untouched.

- [ ] **Step 3: Remove the now-unused `buildUsageView` import from the router**

In `packages/api/src/routers/billing.ts`, change:

```typescript
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { buildUsageView } from '@tims/shared';
import { CHECKOUT_PLANS } from '../lib/stripe';
import { billingService, type BillingAuditActor } from '../services/billing.service';
```

to:

```typescript
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
import { CHECKOUT_PLANS } from '../lib/stripe';
import { billingService, type BillingAuditActor } from '../services/billing.service';
```

(`db` stays — still used by `listInvoices`/`getInvoice`; `billingService` stays — used by the 3 write procedures.)

- [ ] **Step 4: Remove the dead tRPC cache-invalidation call from the billing settings page**

In `apps/web/app/(admin)/settings/billing/page.tsx`, change the `cancel` mutation's `onSuccess`:

```typescript
const cancel = useBillingCancelSubscription({
  onSuccess: () => {
    toast(t.billing.cancelScheduled, { type: 'success' });
    // Refresh the plan panel from BOTH read paths: the tRPC cache and — when the C# read
    // cutover is live (NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP) — the platform-api query key,
    // which the tRPC invalidate above does not reach. Harmless (no-op key) while dark.
    utils.billing.getCurrentPlan.invalidate();
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'billing', 'plan'] });
  },
  onError: () => toast(t.billing.cancelError, { type: 'error' }),
});
```

to:

```typescript
const cancel = useBillingCancelSubscription({
  onSuccess: () => {
    toast(t.billing.cancelScheduled, { type: 'success' });
    // getCurrentPlan's TS tRPC procedure has been deleted — the platform-api query key is
    // the only read path left to invalidate.
    queryClient.invalidateQueries({ queryKey: ['platform-api', 'billing', 'plan'] });
  },
  onError: () => toast(t.billing.cancelError, { type: 'error' }),
});
```

Then remove the now-unused `utils` variable and `trpc` import (grep the file for `utils\.` / `trpc\.` first to confirm these have zero other uses — they should, since `utils.billing.getCurrentPlan.invalidate()` above was the only reference to either). Change:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
```

to:

```typescript
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
```

and change:

```typescript
const utils = trpc.useUtils();
const queryClient = useQueryClient();
```

to:

```typescript
const queryClient = useQueryClient();
```

- [ ] **Step 5: Remove the `billing-usage` parity-harness surface entry**

In `scripts/parity/surfaces.ts`, delete the entire `'billing-usage'` entry (its 3 endpoints' `tsProcedure` fields now point at deleted code):

```typescript
  'billing-usage': {
    key: 'billing-usage',
    flag: 'Platform__BillingUsageEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // org-scoped bypass role — 200 for a normal own-org request, so it exercises
    // tenant scoping as the parity/RLS probe identity (chosen explicitly, not by position).
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'usage',
        csharpPath: '/billing/usage',
        tsProcedure: 'billing.getUsage',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // buildUsageView emits honest `null` storage/apiCalls (+ null period for an org with no
        // sub); tRPC superjson omits null-valued keys where the C# JSON may emit them — drop
        // nullish on both sides so those don't register as false-positive parity diffs.
        normalize: { dropNullish: true },
      },
      {
        name: 'plan',
        csharpPath: '/billing/plan',
        tsProcedure: 'billing.getCurrentPlan',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // getCurrentPlan = the raw Subscription row (nullable stripe ids / trialEndsAt /
        // cancelledAt / lastStripeEventAt) OR top-level `null`. dropNullish reconciles the
        // superjson-omitted vs C#-emitted null columns on the seeded row.
        normalize: { dropNullish: true },
      },
      {
        name: 'config',
        csharpPath: '/billing/config',
        tsProcedure: 'billing.getBillingConfig',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 403, hrbp: 403 },
        // Env-driven `{configured}` — same for every org by design; RLS Mode B would false-flag
        // identical cross-org payloads as a "global leak", so mark it globalScope (RLS reported
        // N/A). Parity (the boolean must still match TS) + RBAC still run.
        globalScope: true,
        normalize: { dropNullish: true },
      },
    ],
  },
```

Also delete the `── billing-usage ──` doc-comment block directly above the `export const SURFACES` line (everything from the `* ── billing-usage ─────...` heading line through the line right before the closing `*/` — keep the generic 2-line "Surface registry — one entry per cutover surface..." intro and the closing `*/` itself, just remove the billing-usage-specific content in between).

- [ ] **Step 6: Remove the 2 dead tests from the parity surfaces test file**

In `scripts/parity/surfaces.test.ts`, delete:

```typescript
it('billing-usage has the three billing reads under one flag + super_admin-only allow', () => {
  const s = SURFACES['billing-usage'];
  expect(s.flag).toBe('Platform__BillingUsageEnabled');
  expect(s.probeRole).toBe('super_admin');
  expect(s.endpoints.map((e) => e.name).sort()).toEqual(['config', 'plan', 'usage']);
  for (const e of s.endpoints) {
    // billing is super-admin-only: exactly one allow, the rest denied.
    expect(e.expectedByRole['super_admin']).toBe(200);
    expect(e.expectedByRole['hr_admin']).toBe(403);
    expect(e.expectedByRole['hrbp']).toBe(403);
  }
});

it('billing-usage marks only /billing/config as globalScope (env-driven, non-tenant)', () => {
  const s = SURFACES['billing-usage'];
  const config = s.endpoints.find((e) => e.name === 'config');
  const usage = s.endpoints.find((e) => e.name === 'usage');
  const plan = s.endpoints.find((e) => e.name === 'plan');
  expect(config?.globalScope).toBe(true);
  // the two org-scoped reads must NOT be globalScope — they carry the real RLS proof.
  expect(usage?.globalScope).toBeUndefined();
  expect(plan?.globalScope).toBeUndefined();
});
```

Do not touch the "the four read surfaces are registered..." test right after these two — it does not reference `SURFACES['billing-usage']` at all (only `compensation`/`ninebox`/`succession`), despite its title.

- [ ] **Step 7: Update `scripts/deploy/cutover.sh`'s billing-usage case branch**

Change:

```bash
    billing-usage)
      echo "read|BillingUsageEnabled|verify|billing-usage|NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #3 (part 2)."
      ;;
```

to:

```bash
    billing-usage)
      echo "read|BillingUsageEnabled|NONE|NONE|NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #3 (part 2). UPDATE 2026-07-29: the TS getBillingConfig/getCurrentPlan/getUsage procedures (packages/api/src/routers/billing.ts) and their FE tRPC fallback (apps/web/lib/platform-api/billing.ts) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'billing-usage' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. NOTE: billing.ts's other 5 hooks (useBillingInvoices, useBillingInvoice, and the 3 self-serve write mutations) are untouched — separate flags, both still dark."
      ;;
```

- [ ] **Step 8: Update `scripts/deploy/README-cutover.md` — table row, worked-example surface swap, and prose**

**Table row** — change:

```
| `billing-usage`       | read  | `BillingUsageEnabled`       | `verify billing-usage`       | `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`       | FLIP-READY  |
```

to:

```
| `billing-usage`       | read  | `BillingUsageEnabled`       | `NONE` (TS router deleted)   | `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`       | TS DELETED     |
```

**Worked-example walkthrough** — the section header and all 4 script invocations currently read `billing-usage`; change every one of them to `compensation`, and change the Vercel-flag mention accordingly. Change:

````
## Worked example: cutting over `billing-usage`

```bash
# 1) Verify — safe, non-mutating, needs scripts/parity/.env populated (see scripts/parity/README.md)
#    and a live, reachable C# service.
./scripts/deploy/cutover.sh billing-usage --verify-only

# 2) Once that's green, flip the backend flag AND re-verify in the same breath — the script
#    refuses to flip unless a verify pass is bundled into the same invocation (see "sequencing
#    safety" below). --yes is what actually executes the AWS CLI call; without it you get a
#    dry-run printout of the exact command.
./scripts/deploy/cutover.sh billing-usage --verify-only --flip-backend --yes

# 3) Canary/monitor per the runbook, then flip the FE flag too (NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP=true
#    in Vercel Production + redeploy) — this script does not touch Vercel; that step stays manual
#    per the runbook (§6: "The flag alone does not move the FE.").

# If anything looks wrong at any point, roll back immediately — no re-verify needed:
./scripts/deploy/cutover.sh billing-usage --rollback --yes
````

```

to:

```

## Worked example: cutting over `compensation`

```bash
# 1) Verify — safe, non-mutating, needs scripts/parity/.env populated (see scripts/parity/README.md)
#    and a live, reachable C# service.
./scripts/deploy/cutover.sh compensation --verify-only

# 2) Once that's green, flip the backend flag AND re-verify in the same breath — the script
#    refuses to flip unless a verify pass is bundled into the same invocation (see "sequencing
#    safety" below). --yes is what actually executes the AWS CLI call; without it you get a
#    dry-run printout of the exact command.
./scripts/deploy/cutover.sh compensation --verify-only --flip-backend --yes

# 3) Canary/monitor per the runbook, then flip the FE flag too (NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP=true
#    in Vercel Production + redeploy) — this script does not touch Vercel; that step stays manual
#    per the runbook (§6: "The flag alone does not move the FE.").

# If anything looks wrong at any point, roll back immediately — no re-verify needed:
./scripts/deploy/cutover.sh compensation --rollback --yes
```

```

**"Why not `reporting`" prose** — change:

```

**Why not `reporting` for this walkthrough (like before)?** As of 2026-07-28 the TS
recruitment-analytics router and its FE tRPC fallback were deleted outright (the C# read path is
the sole implementation now), and the same happened to the TS evaluation360 router (both read AND
write) — see the table below. As of 2026-07-29, the TS `team-intel` `getDashboardKpis` procedure
and its FE tRPC fallback joined this group too. None of `reporting`, `evaluation360` (read), or
`team-intel` has a parity command left to demonstrate; `--verify-only` for any of them is now a
no-op that prints an explanatory notice and exits 0 rather than running a real check.

```

to:

```

**Why not `reporting` for this walkthrough (like before)?** As of 2026-07-28 the TS
recruitment-analytics router and its FE tRPC fallback were deleted outright (the C# read path is
the sole implementation now), and the same happened to the TS evaluation360 router (both read AND
write) — see the table below. As of 2026-07-29, the TS `team-intel` `getDashboardKpis` procedure
and the TS `billing-usage` `getBillingConfig`/`getCurrentPlan`/`getUsage` procedures joined this
group too (each time, only the specific dead procedure(s) were removed — team-intel's and
billing.ts's routers stay alive for their other, still-dark-or-unrelated procedures). None of
`reporting`, `evaluation360` (read), `team-intel`, or `billing-usage` has a parity command left to
demonstrate; `--verify-only` for any of them is now a no-op that prints an explanatory notice and
exits 0 rather than running a real check. `compensation` (FX-free read subset) is this
walkthrough's surface instead — still `FLIP_READY` as of this writing.

```

- [ ] **Step 9: Update `scripts/parity/README.md`'s example command**

Change:

```

This harness validates that the C#/.NET backend and TypeScript backend produce identical output for the same inputs across all major workflows (candidate flows, assessments, evaluations, etc.). Run `cp .env.example .env`, fill in the `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` from the Supabase dashboard, then execute `npx tsx scripts/parity/cli.ts verify billing-usage` to trigger a full parity suite covering Candidate, Team, Intel, and premium assessments. All differences are logged to stdout; the harness exits with code 0 only if both backends agree on every output field.

```

to:

```

This harness validates that the C#/.NET backend and TypeScript backend produce identical output for the same inputs across all major workflows (candidate flows, assessments, evaluations, etc.). Run `cp .env.example .env`, fill in the `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` from the Supabase dashboard, then execute `npx tsx scripts/parity/cli.ts verify compensation` to trigger a full parity suite covering Candidate, Team, Intel, and premium assessments. All differences are logged to stdout; the harness exits with code 0 only if both backends agree on every output field.

````

(Read the file first — this is one sentence inside a longer paragraph; change only the surface name in the command, nothing else.)

- [ ] **Step 10: Update `docs/REMAINING-WORK.md`'s deletion tally**

Read the file first to get the current exact wording (it was last truthed up to say "3 of the now-11 live... surfaces" after team-intel's own deletion — find that sentence and the domain list around it) and update the count from 3 to 4, moving `billing-usage` from the "still have their TS fallback code sitting dead-but-undeleted" list into the deleted-domains list alongside reporting/evaluation360/team-intel.

- [ ] **Step 11: Verify — type-check both packages**

Run:
```bash
cd packages/api && npx tsc --noEmit
````

Expected: PASS, no errors.

Run:

```bash
cd apps/web && npx tsc --noEmit
```

Expected: PASS, no errors (confirms `page.tsx`'s 3 call sites still type-check, and the new hand-declared types compile cleanly).

- [ ] **Step 12: Verify — full test suite**

Run from repo root:

```bash
npx vitest run
```

Expected: PASS. The total test count will drop by exactly 2 (the 2 removed `surfaces.test.ts` cases) versus the pre-task baseline — verify this arithmetic explicitly in your report (get the real pre-task count by running the suite before making any changes, or by reading it from the most recent prior full-suite run in this repo's history if unambiguous) rather than asserting an unchecked round number.

- [ ] **Step 13: Commit**

```bash
git add apps/web/lib/platform-api/billing.ts apps/web/app/\(admin\)/settings/billing/page.tsx packages/api/src/routers/billing.ts scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts scripts/parity/README.md scripts/deploy/cutover.sh scripts/deploy/README-cutover.md docs/REMAINING-WORK.md
git commit -m "refactor(billing-usage): delete dead TS getBillingConfig/getCurrentPlan/getUsage + truth-up cutover tooling

NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP has been live in prod since
before 2026-07-28; these 3 TS procedures and their FE fallback
branches were the only remaining consumer of the tRPC path. Also
swaps the parity README + cutover-doc worked-example surface from
billing-usage to compensation (still FLIP_READY) since this deletion
makes billing-usage unusable as that example, same as team-intel did
to the previous example one task ago.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 14: Hand Federico the `.env.example` patch (do not apply directly — this repo denies AI edits to `.env.*` files)**

Tell Federico the following patch is ready to apply to `.env.example` (around the `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP` line), and to change:

```
# Per-surface flag: route the three billing reads (getBillingConfig / getCurrentPlan /
# getUsage) to the C# service. Mirrors the backend `Platform:BillingUsageEnabled` flag that
# gates all three routes. Requires NEXT_PUBLIC_TIMS_PLATFORM_API_URL to also be set. Anything
# other than the exact string 'true' (including unset) keeps the tRPC path. Default off.
NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP=false
```

to:

```
# Per-surface flag: was route the three billing reads (getBillingConfig / getCurrentPlan /
# getUsage) to the C# service — NOW MOOT. The TS tRPC procedures have been deleted
# (2026-07-29); the C# read path is the sole implementation regardless of this flag's value.
NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP=true
```

## Self-Review

**Spec coverage:** Wrapper edit (Step 1), router procedure + import deletion (Steps 2-3), dead-invalidate-call cleanup (Step 4), parity-harness + test truth-up (Steps 5-6), cutover.sh + README-cutover.md + parity README + REMAINING-WORK.md truth-up including the worked-example surface swap (Steps 7-10), full verification (Steps 11-12), commit (Step 13), `.env.example` hand-off (Step 14) — every constraint at the top has a corresponding step, including the specific worked-example-swap constraint this plan called out up front (learned from team-intel's whole-branch review, which found this exact ripple effect one domain late).

**Placeholder scan:** No TBD/TODO/"add appropriate X" language — every step shows exact before/after code, or (Steps 9-10) explicit instructions to read the file first since those are single-sentence edits inside longer prose where quoting the "before" text verbatim risks a stale match if the file drifted further since this plan was written.

**Type consistency:** `BillingConfigOutput`/`CurrentPlanOutput`/`UsageView` field names and the 3 hooks' `queryKey`s are unchanged from the original wrapper, so the 3 FE call sites in `settings/billing/page.tsx` need no changes to their own lines.

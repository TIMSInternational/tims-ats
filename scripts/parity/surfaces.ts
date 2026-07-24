import type { NormalizeOpts } from './normalize';

export interface EndpointDef {
  name: string;
  csharpPath: string;
  tsProcedure: string;
  input: unknown;
  idScopeKey?: string;
  expectedByRole: Record<string, 200 | 403>;
  normalize?: NormalizeOpts;
  /** Set when this endpoint is NOT tenant-scoped — it returns the same
   *  global / per-deploy payload for every org (e.g. `/billing/config`, whose
   *  `{configured}` boolean is driven by Stripe env vars, not a per-org DB
   *  read). The RLS Mode B heuristic ("both orgs returned identical non-empty
   *  payloads ⇒ possible global leak") is INVERTED for such endpoints —
   *  identical payloads are the CORRECT, expected result — so the RLS check is
   *  reported as a documented N/A (`inconclusive`, rendered `[WEAK]`), never a
   *  spurious FAIL. Parity and RBAC still run unchanged: a global read must
   *  still match TS byte-for-byte and still enforce the same permission gate. */
  globalScope?: boolean;
}

export interface Surface {
  key: string;
  flag: string;
  roles: string[];
  /** The role whose token is used as the org-A/org-B parity+RLS probe identity
   *  — chosen explicitly here rather than implied by `roles[]` array position,
   *  so a future reorder of `roles` can't silently change which role probes
   *  cross-tenant isolation. RLS/parity probes should use an org-scoped role
   *  (one that returns 200 for a normal org-member request, not just a
   *  platform-owner bypass) so the probe actually exercises tenant scoping.
   *  Optional for now — `cli.ts`'s `resolveProbeRole` falls back to
   *  `roles[0]` (with a warning) when unset. */
  probeRole?: string;
  endpoints: EndpointDef[];
}

/**
 * Surface registry — one entry per cutover surface. Later check runners (Task 8 parity,
 * Task 9 RLS, Task 10 RBAC) iterate this map; they never hardcode a surface's routes/roles.
 *
 * ── team-intel ───────────────────────────────────────────────────────────────────────────
 * tRPC procedure confirmed via `grep -rnE "getDashboardKpis|teamIntel" packages/api/src`:
 * router key `teamIntel` (packages/api/src/root.ts:74) + procedure `getDashboardKpis`
 * (packages/api/src/routers/teamIntel.ts:191), gated `permissionProcedure('team_intel', 'read')`
 * + `requireOrgScope(ctx.access)`. C# route `/team-intel/dashboard-kpis` + flag
 * `Platform__TeamIntelReadEnabled` were pre-confirmed (TeamIntelReadEndpoints.cs:251,
 * PlatformOptions.cs:145) — used verbatim.
 *
 * `roles`/`expectedByRole` — a representative 2-allow/1-deny subset (not the full 9-role
 * SYSTEM_ROLES set), each verdict grounded in code:
 *   - `super_admin` → 200, CODE-GUARANTEED in BOTH stacks independent of any seeded
 *     RolePermission/PermissionService row: TS `buildAccessForUser` short-circuits on
 *     `user.roles.includes('super_admin')` (packages/api/src/access/build.ts:21); C#
 *     `PermissionService` has the identical `SuperAdminRole = "super_admin"` bypass
 *     (services/Tims.Platform/src/Tims.Application/Identity/PermissionService.cs:18).
 *   - `hr_admin` → 200 per PRODUCT INTENT: seed-access-matrix.ts MATRIX grants hr_admin
 *     `team_intel` read/create/update/delete at `organization` scope
 *     (packages/db/prisma/seed-access-matrix.ts:44-49). NOT yet code-guaranteed for a
 *     freshly-seeded harness org — see RBAC-matrix flag in task-7-report.md.
 *   - `hrbp` → 403, CONFIRMED: MATRIX's hrbp entry omits `team_intel` from its module list
 *     (only learning/ninebox/succession/engagement/compensation get unit-scope read —
 *     seed-access-matrix.ts:58-76). No other role in the matrix grants team_intel either
 *     (leader is explicitly excluded per the comment at seed-access-matrix.ts:98-103;
 *     recruiter/committee/employee/external/candidate never list the module at all).
 *
 * ── billing-usage ─────────────────────────────────────────────────────────────────────────
 * The three billing READ procedures (`billing.getUsage` / `getCurrentPlan` / `getBillingConfig`,
 * packages/api/src/routers/billing.ts:25/16/11), all `permissionProcedure('billing','read')`.
 * On the C# side all three are mapped by `MapBillingUsageEndpoints` and gated by the single
 * `Platform:BillingUsageEnabled` flag (services/Tims.Platform/src/Tims.Api/Billing/
 * BillingUsageEndpoints.cs) — so ONE flag flip cuts the whole surface over, and the FE mirrors it
 * with one `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP` gate (apps/web/lib/platform-api/billing.ts).
 *
 * `roles`/`expectedByRole` — billing is SUPER-ADMIN-ONLY per the access matrix, so this is a
 * 1-allow/2-deny subset, each verdict grounded in code:
 *   - `super_admin` → 200, CODE-GUARANTEED in BOTH stacks independent of any seeded RolePermission:
 *     TS `buildAccessForUser` short-circuits on `super_admin` (packages/api/src/access/build.ts:21);
 *     C# `PermissionService` has the identical `super_admin` bypass. (RLS/TenantScope still applies —
 *     super_admin is org-scoped / own-org-only, NOT platform-reaching — so it is a valid tenant probe.)
 *   - `hr_admin` → 403: the MATRIX hr_admin module list OMITS `billing` entirely (it lists
 *     vacancy…evaluation360 + dei/monitoring/organization, never billing — seed-access-matrix.ts:44-56;
 *     the header note "hr_admin loses audit + feature_flags" reflects the same deliberate trimming).
 *     The parity seed grants hr_admin ONLY its team_intel:read row, so it definitively lacks billing:read.
 *   - `hrbp` → 403: hrbp's matrix entry (unit-scope) never lists billing either (seed-access-matrix.ts:58-76).
 * Because the only 200 role is the bypass role, NO role_permissions grant needs seeding for this surface
 * (contrast team-intel, which seeds hr_admin's grant to make it a real-grant 200).
 *
 * RLS: `/billing/usage` and `/billing/plan` are org-scoped (Mode B) — the seed inserts ONE
 * `subscriptions` row in org A only, so A vs B return different non-empty payloads. `/billing/plan`
 * is the AIRTIGHT leak detector: it returns the raw sub row for A vs top-level `null` for B, so ANY
 * subscription-table leak makes B echo A's row (identical non-empty ⇒ Mode B FAIL). `/billing/usage`
 * corroborates (A's paid-plan limits/period differ from B's trial-fallback), but its limits differ
 * unconditionally, so it can't by itself distinguish an asymmetric count leak — plan, reading the same
 * table under the same TenantScope/RLS, is what makes the surface RED on any real leak. (No by-id
 * endpoint exists for a strong Mode A probe — this is Mode B's documented limitation, not a gap here.)
 * `/billing/config` is `globalScope` — its `{configured}` boolean is env-driven and identical across
 * orgs by design, so RLS is N/A (parity + RBAC still run).
 */
export const SURFACES: Record<string, Surface> = {
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
  'team-intel': {
    key: 'team-intel',
    flag: 'Platform__TeamIntelReadEnabled',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    // org-scoped (OrgGate) role that returns 200 for parity/RLS identity — chosen
    // explicitly, not by roles[] position; RLS/parity probes should use an
    // org-scoped role.
    probeRole: 'super_admin',
    endpoints: [
      {
        name: 'dashboard-kpis',
        csharpPath: '/team-intel/dashboard-kpis',
        tsProcedure: 'teamIntel.getDashboardKpis',
        input: {},
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
        // tRPC superjson omits null-valued keys; the C# JSON response may still emit them
        // explicitly (e.g. a nullable KPI field with no data yet) — drop nullish on both
        // sides before diffing so that difference doesn't register as a false-positive parity break.
        normalize: { dropNullish: true },
      },
    ],
  },
};

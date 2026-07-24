import type { NormalizeOpts } from './normalize';

export interface EndpointDef {
  name: string;
  csharpPath: string;
  tsProcedure: string;
  input: unknown;
  idScopeKey?: string;
  expectedByRole: Record<string, 200 | 403>;
  normalize?: NormalizeOpts;
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
 */
export const SURFACES: Record<string, Surface> = {
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

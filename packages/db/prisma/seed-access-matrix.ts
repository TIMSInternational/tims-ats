/**
 * packages/db/prisma/seed-access-matrix.ts
 *
 * PURE DATA — the single source of truth for every role's grants.
 * No side effects (no PrismaClient, no main()). Imported by the seed runner
 * (seed-access.ts) AND by tests. Keep Scope in sync with SCOPE_LADDER in
 * packages/api/src/access/types.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// keep in sync with SCOPE_LADDER in packages/api/src/access/types.ts (db→api import would invert dependency direction)
export type Scope = 'own' | 'team' | 'unit' | 'company' | 'organization';
export type Entry = { module: string; actions: string[]; scope: Scope };
export type Triple = { module: string; action: string; scope: Scope };

// ---------------------------------------------------------------------------
// MATRIX — single source of truth for every role's grants in this system.
//
// hr_admin INTENTIONAL changes vs the old code allowlist (product-confirmed Jun 11):
//   loses audit + feature_flags entirely; organization becomes read-only.
//
// external: limited API surface for integrations.
//
// candidate: [] — reconciliation strips any stray candidate grants;
//   candidates use candidateProcedure, never staff RBAC.
// ---------------------------------------------------------------------------
export const MATRIX: Record<string, Entry[]> = {
  super_admin: [
    ...[
      'vacancy', 'pipeline', 'candidate', 'assessment', 'interview', 'offer',
      'onboarding', 'performance', 'learning', 'ninebox', 'succession', 'team_intel',
      'engagement', 'dei', 'compensation', 'monitoring', 'organization', 'user',
      'notification', 'audit', 'feature_flags', 'billing', 'integration', 'fit_engine', 'evaluation360',
    ].map((m) => ({ module: m, actions: ['read', 'create', 'update', 'delete'], scope: 'organization' as Scope })),
    { module: 'vacancy',      actions: ['approve', 'publish'], scope: 'organization' },
    { module: 'offer',        actions: ['approve'],            scope: 'organization' },
    { module: 'compensation', actions: ['approve'],            scope: 'organization' },
    { module: 'audit',        actions: ['export'],             scope: 'organization' },
    { module: 'dei',          actions: ['export'],             scope: 'organization' },
  ],

  hr_admin: [
    ...[
      'vacancy', 'pipeline', 'candidate', 'assessment', 'interview', 'offer',
      'onboarding', 'performance', 'learning', 'ninebox', 'succession', 'team_intel',
      'engagement', 'compensation', 'user', 'notification', 'fit_engine', 'evaluation360',
    ].map((m) => ({ module: m, actions: ['read', 'create', 'update', 'delete'], scope: 'organization' as Scope })),
    { module: 'vacancy',      actions: ['approve', 'publish'],         scope: 'organization' },
    { module: 'offer',        actions: ['approve'],                    scope: 'organization' },
    { module: 'compensation', actions: ['approve'],                    scope: 'organization' },
    { module: 'dei',          actions: ['read', 'export'],             scope: 'organization' },
    { module: 'monitoring',   actions: ['read', 'update'],             scope: 'organization' },
    { module: 'organization', actions: ['read'],                       scope: 'organization' },
  ],

  hrbp: [
    { module: 'vacancy',     actions: ['read', 'create', 'update'], scope: 'unit' }, // spec §2 "gestionar procesos de HR"
    { module: 'pipeline',    actions: ['read', 'update'],           scope: 'unit' },
    { module: 'candidate',   actions: ['read', 'update'],           scope: 'unit' },
    { module: 'assessment',  actions: ['read'],                     scope: 'unit' },
    { module: 'interview',   actions: ['read', 'create'],           scope: 'unit' },
    { module: 'offer',       actions: ['read'],                     scope: 'unit' }, // D1: read-only, no approve
    { module: 'onboarding',  actions: ['read', 'create', 'update'], scope: 'unit' },
    { module: 'performance', actions: ['read', 'update'],           scope: 'unit' },
    ...['learning', 'ninebox', 'succession', 'engagement', 'compensation'].map(
      (m) => ({ module: m, actions: ['read'], scope: 'unit' as Scope }),
    ),
    { module: 'monitoring',   actions: ['read'],  scope: 'unit' }, // spec §2 "monitoreo estratégico de sus áreas"
    { module: 'fit_engine',   actions: ['read'],  scope: 'unit' },
    // evaluation360 deliberately NOT granted: the admin cycle CRUD/read endpoints
    // are org-only (requireOrgScope), so a unit-scoped read grant would be dead/
    // misleading — a unit-scoped hrbp could reach the grant check but then 403 on
    // every call. Scoped unit-level monitoring is deferred to a later slice.
  ],

  recruiter: [
    ...['pipeline', 'candidate', 'interview'].map((m) => ({
      module: m, actions: ['read', 'create', 'update', 'delete'], scope: 'organization' as Scope,
    })),
    { module: 'vacancy',    actions: ['read', 'create', 'update', 'delete', 'publish'], scope: 'organization' }, // +publish: posts to job boards
    { module: 'assessment', actions: ['read', 'create', 'update'],                      scope: 'organization' },
    { module: 'offer',      actions: ['read', 'create'],                                scope: 'organization' }, // +create: spec §2 "crear ofertas"
    { module: 'fit_engine', actions: ['read', 'create'],                                scope: 'organization' },
  ],

  leader: [
    { module: 'vacancy',      actions: ['read', 'create', 'approve'], scope: 'team' }, // +create: spec §2 "solicitar vacantes"
    { module: 'candidate',    actions: ['read'],                      scope: 'team' }, // spec §2 "revisar candidatos finalistas"
    { module: 'pipeline',     actions: ['read', 'update'],            scope: 'team' },
    { module: 'interview',    actions: ['read', 'create', 'update'],  scope: 'team' },
    { module: 'offer',        actions: ['read', 'approve'],           scope: 'team' },
    { module: 'onboarding',   actions: ['read', 'update'],            scope: 'team' },
    { module: 'performance',  actions: ['read', 'create', 'update'],  scope: 'team' },
    { module: 'learning',     actions: ['read'],                      scope: 'team' },
    { module: 'ninebox',      actions: ['read'],                      scope: 'team' },
    // NOTE: succession + team_intel deliberately NOT granted to leader. Both pages
    // (/talent/succession, /talent/team-intelligence) are org-rollup views whose
    // endpoints requireOrgScope → they FORBIDDEN a team-scoped leader on load. They
    // are curated OUT of the leader nav (manifest.test.ts locks their absence), so a
    // read grant would only let a leader URL-reach a page that 403s — incoherent.
    // Both modules are single-use (one page each), so withholding them is isolated.
    { module: 'engagement',   actions: ['read'],                      scope: 'team' },
    { module: 'compensation', actions: ['read'],                      scope: 'team' },
    { module: 'fit_engine',   actions: ['read'],                      scope: 'team' },
    // evaluation360 deliberately NOT granted: same reasoning as hrbp above — the
    // admin endpoints are org-only (requireOrgScope), so a team-scoped read grant
    // would be dead/misleading. Scoped team-level monitoring is deferred.
  ],

  committee: [
    // create = submitScorecard (gated interview:create); slice 3 must add evaluator-ownership enforcement
    { module: 'interview', actions: ['read', 'create', 'update'], scope: 'team' },
    { module: 'ninebox',   actions: ['read', 'update'], scope: 'team' },
  ],

  employee: [
    { module: 'performance', actions: ['read', 'create', 'update'], scope: 'own' },
    { module: 'onboarding',  actions: ['read', 'update'],           scope: 'own' },
    { module: 'learning',    actions: ['read'],                     scope: 'own' },
    { module: 'engagement',  actions: ['read', 'create'],           scope: 'own' },
    { module: 'compensation',actions: ['read'],                     scope: 'own' },
    // evaluation360 deliberately NOT granted: myRaterTasks/submitRatings/
    // myReport/myReportCycles are protectedProcedure (identity-anchored on
    // raterUserId/subjectUserId === ctx.user.id), not RBAC-gated, so
    // self-service needs no grant. Only super_admin/hr_admin hold the
    // evaluation360 grant, for the org-admin cycle CRUD endpoints.
  ],

  external: [
    { module: 'assessment', actions: ['read'], scope: 'organization' },
    { module: 'validation', actions: ['update'], scope: 'organization' },
  ],

  // candidates use candidateProcedure, never staff RBAC — any stray grants stripped.
  candidate: [],
};

// ---------------------------------------------------------------------------
// Flatten matrix to a canonical set of { module, action, scope } triples
// ---------------------------------------------------------------------------
export function flattenEntries(entries: Entry[]): Triple[] {
  return entries.flatMap((e) =>
    e.actions.map((action) => ({ module: e.module, action, scope: e.scope })),
  );
}

/** All { module, action, scope } triples granted to a role slug. */
export function grantsFor(role: string): Triple[] {
  return flattenEntries(MATRIX[role] ?? []);
}

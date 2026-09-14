/**
 * Write-surface registry — the write analog of `SURFACES` (surfaces.ts). Each
 * WriteEndpointDef drives the three write checks (checks/writes.ts): light parity
 * (the single mutating happy-path), write-IDOR (org-A → org-B, denied + no mutation),
 * and write-RBAC-deny (deny role → denied + no mutation). Assertions run against the
 * DB via an injected read-back, so the goldens are code-grounded in the actual rows.
 * See docs/superpowers/specs/2026-07-24-write-verification-harness-design.md.
 *
 * Multi-surface generalization (2026-07-24, evaluation360 rollout):
 * - Each surface owns its `ensurePreconditions` + `resolveResources` hooks (implemented
 *   in seed.ts) so adding surface N never touches surfaces 1..N-1, and each surface's
 *   resolved-id shape (`R extends WriteResolvedBase`) is its own.
 * - `buildIdor` is OPTIONAL — a create whose org is fixed by the caller's context (e.g.
 *   createCycle) has NO cross-org target, so its IDOR check is legitimately N/A.
 * - `idorDeniedStatuses` (default [403,404]) + `rbacDenyStatus` (default 403) let a
 *   surface declare its denial semantics: subject-scope 403, assertScoped 404, guarded
 *   state-transition 409, identity-anchored 404.
 */

import type { HarnessConfig } from './config';
import {
  ensureCompensationWritePreconditions,
  resolveCompensationWriteResources,
  ensureEvaluation360WritePreconditions,
  resolveEvaluation360WriteResources,
  ensureSuccessionWritePreconditions,
  resolveSuccessionWriteResources,
  ensureEngagementWritePreconditions,
  resolveEngagementWriteResources,
  ensureNineBoxWritePreconditions,
  resolveNineBoxWriteResources,
  ensureAccessReviewWritePreconditions,
  resolveAccessReviewWriteResources,
  ensurePlatformOrganizationsWritePreconditions,
  resolvePlatformOrganizationsWriteResources,
  ensurePlatformOrganizationsCreatePreconditions,
  resolvePlatformOrganizationsCreateResources,
  WRITE_ORG_CREATE_SLUG,
  WRITE_ORG_CREATE_NAME,
  WRITE_EVAL_CYCLES,
  WRITE_CYCLE_MARKER,
  WRITE_SUCCESSION_ROLES,
  WRITE_SUCCESSION_CR_MARKER,
  WRITE_ENGAGEMENT,
  WRITE_ENGAGEMENT_SURVEY_MARKER,
  WRITE_ENGAGEMENT_PLAN_MARKER,
  WRITE_NINEBOX,
  WRITE_NINEBOX_CAL_MARKER,
} from './seed';

// Re-export the write-verify fixtures (defined in seed.ts to keep the seed→registry import
// one-directional) so consumers/tests can reference them from the registry too.
export {
  WRITE_EVAL_CYCLES,
  WRITE_CYCLE_MARKER,
  WRITE_SUCCESSION_ROLES,
  WRITE_SUCCESSION_CR_MARKER,
  WRITE_ENGAGEMENT,
  WRITE_ENGAGEMENT_SURVEY_MARKER,
  WRITE_ENGAGEMENT_PLAN_MARKER,
  WRITE_NINEBOX,
  WRITE_NINEBOX_CAL_MARKER,
  WRITE_ORG_CREATE_SLUG,
  WRITE_ORG_CREATE_NAME,
};

/** A deterministic Z-anchored effective date for create bodies (the C# validator
 *  requires a strict Zulu ISO-8601 timestamp; a fixed value keeps runs reproducible). */
export const EFFECTIVE_DATE = '2026-01-15T00:00:00.000Z';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;

export type Row = Record<string, unknown>;

/** Every resolved-resources bag carries the C# base URL; the rest is surface-specific. */
export interface WriteResolvedBase {
  base: string;
}

export interface WriteReadback {
  sql: string;
  params: unknown[];
  /** Returns a failure detail string, or null when the rows match the golden. */
  expect: (rows: Row[]) => string | null;
}

/** An ADDITIONAL non-mutating cross-org denial probe beyond the primary IDOR, for endpoints with more
 *  than one cross-tenant vector (e.g. nine-box's org-A-session + org-B-USER vector, which the no-org_id
 *  member/vote RLS WITH CHECK does not block — only app-code does). Run with the org-A probe token. */
export interface WriteExtraProbe<R extends WriteResolvedBase = WriteResolvedBase> {
  /** short label, appended to the endpoint name in the report (e.g. 'cross-org-user'). */
  label: string;
  build: (r: R) => { path: string; body: unknown };
  deniedStatuses: number[];
  readbackNoMutation: (r: R) => WriteReadback;
}

export interface WriteEndpointDef<R extends WriteResolvedBase = WriteResolvedBase> {
  name: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  /** org-A happy-path (probe light-parity + rbac-deny both use this path/body). */
  buildParity: (r: R) => { path: string; body: unknown };
  /** cross-org IDOR probe (org-A token → an org-B resource/subject). OMITTED when the
   *  endpoint has no cross-org target (the org is fixed by the caller's context, e.g. a
   *  plain create) — the IDOR check is then reported N/A rather than run. */
  buildIdor?: (r: R) => { path: string; body: unknown };
  /** Statuses that count as a correctly-DENIED cross-org write (default [403,404]).
   *  A 200 is always a write leak; a status outside this set fails closed ("cannot
   *  confirm isolation"). Guarded transitions add 409; identity-anchored add 404. */
  idorDeniedStatuses?: number[];
  /** 'allow' = the role may perform the write (probe proves it via light-parity; a
   *  non-probe allow role is live-tested only when `allowRolesLiveTestable`); 'deny' =
   *  the role must be refused (asserted against `rbacDenyStatus`) + no mutation. */
  expectedByRole: Record<string, 'allow' | 'deny'>;
  /** The status a correctly-denied RBAC role returns (default 403 — no grant). Identity-
   *  anchored endpoints use 404 (a non-owner is indistinguishable from a missing row). */
  rbacDenyStatus?: number;
  /** Optional per-role expected substring in the DENY response body — proves the role was denied for
   *  the INTENDED reason (e.g. NotMember, having passed the grant gate) rather than incidentally at the
   *  gate. Distinguishes a membership-403 from a gate-403. */
  denyBodyIncludes?: Record<string, string>;
  /** Additional non-mutating cross-org denial probes beyond the primary IDOR (run with the probe token). */
  extraProbes?: WriteExtraProbe<R>[];
  /** light-parity: validate the success (200) response body shape. */
  expectResponse: (respBody: unknown) => string | null;
  /** light-parity: read back the created/mutated row(s) and assert the golden. */
  readbackMutated: (r: R, respBody: unknown) => WriteReadback;
  /** after a DENIED write, assert the target was NOT mutated. `target` selects org A/B;
   *  `denierRole` (rbac-deny only) identifies who was (correctly) refused. */
  readbackNoMutation: (r: R, target: 'a' | 'b', denierRole?: string) => WriteReadback;
  /** True when the ALLOW (200) roles can be exercised live without consuming a shared
   *  precondition — i.e. an unconditional CREATE, where each allow role inserts its own
   *  row. For state transitions (approve/open/…) leave false: only the probe transitions
   *  the single precondition (a 2nd allow role would need its own fixture — a rollout item),
   *  so those are deny-side + probe only. When true, `readbackAllow` MUST be provided. */
  allowRolesLiveTestable?: boolean;
  /** read-back proving the ALLOW role (not the probe) actually performed the write with its
   *  own grant — used only when `allowRolesLiveTestable`. */
  readbackAllow?: (r: R, role: string, respBody: unknown) => WriteReadback;
}

export interface WriteSurface<R extends WriteResolvedBase = WriteResolvedBase> {
  key: string;
  flag: string;
  probeRole: string;
  roles: string[];
  endpoints: WriteEndpointDef<R>[];
  /** Seeds the write-verify-only preconditions (kept OUT of the shared read seed so they
   *  can't degrade a read RLS check). Idempotent; called before resolveResources. */
  ensurePreconditions: (cfg: HarnessConfig) => Promise<void>;
  /** Read-only resolution of this surface's concrete ids from the seeded DB (no `base`;
   *  cli.ts injects `cfg.csharpBase`). Requires a fresh teardown+seed + ensurePreconditions. */
  resolveResources: (cfg: HarnessConfig) => Promise<Omit<R, 'base'>>;
}

/** The heterogeneous registry element type. Each concrete surface is authored against its
 *  own `R` (full type-safety at definition), then erased here — cli.ts resolves the same
 *  `R` it consumes, so the erasure is internally consistent. */
export type AnyWriteSurface = WriteSurface<WriteResolvedBase>;

/** Erases a strongly-typed surface into the registry element type. The cast is the standard
 *  existential-erasure escape (TS has no existential generics); safe because a surface's
 *  resolveResources returns exactly the `R` its endpoints consume. */
export function defineWriteSurface<R extends WriteResolvedBase>(s: WriteSurface<R>): AnyWriteSurface {
  return s as unknown as AnyWriteSurface;
}

const asObj = (b: unknown): Record<string, unknown> | null =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;

// ─────────────────────────────────────────────────────────────────────────────
// compensation (tracer) — Platform__CompensationWriteEnabled
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids resolved for the compensation tracer (seed.ts resolveCompensationWriteResources). */
export interface CompensationWriteResolved extends WriteResolvedBase {
  /** org-A user id per role (super_admin/hr_admin/hrbp) — for bodies + no-mutation keys. */
  userIdByRole: Record<string, string>;
  /** org-A subject employee (create target / approve-fixture owner). */
  subjectA: string;
  /** org-B subject employee (cross-org target). */
  subjectB: string;
  /** org-A by-id resource (approve target — a pending adjustment). */
  resourceA: string;
  /** org-B by-id resource (approve IDOR target — a pending adjustment in org B). */
  resourceB: string;
}

/** Back-compat alias: the tracer's resolved shape was the harness's original `WriteResolved`. */
export type WriteResolved = CompensationWriteResolved;

const compensationBody = (userId: string) => ({
  userId,
  type: 'merit',
  previousSalary: 60000,
  newSalary: 66000,
  currency: 'USD',
  reason: 'parity',
  effectiveDate: EFFECTIVE_DATE,
});

// 2 writes under ONE flag Platform__CompensationWriteEnabled (Program.cs). createAdjustment =
// permissionProcedure('compensation','create') + assertSubjectInScope (out-of-org subject → 403);
// approveAdjustment = permissionProcedure('compensation','approve') + assertScoped IDOR (out-of-org
// id → 404). super/hr_admin allow, hrbp denied (no create/approve grant). Approve runs a tx:
// salary_adjustments.status pending→approved (+ approved_by_id) AND employee_compensations.current_salary
// = new_salary for the subject.
//
// UPDATE 2026-07-29: the TS tRPC counterparts (compensation.createAdjustment /
// compensation.approveAdjustment) have been DELETED — the permissionProcedure / assertSubjectInScope /
// assertScoped wiring described above is now the C# implementation's, not TypeScript's. This surface is
// UNAFFECTED: it drives literal C# HTTP paths and asserts side effects with raw SQL readbacks, so
// `verify-write compensation` never depended on the TS router. Those readbacks
// (readbackMutated / readbackNoMutation) are now the ONLY automated assertion of the atomic
// pending→approved transition and of the §21 minimal-select no-leak guarantee — see the security note
// in the TS-deletion commit.
const compensationSurface: WriteSurface<CompensationWriteResolved> = {
  key: 'compensation',
  flag: 'Platform__CompensationWriteEnabled',
  probeRole: 'super_admin',
  roles: ['super_admin', 'hr_admin', 'hrbp'],
  ensurePreconditions: ensureCompensationWritePreconditions,
  resolveResources: resolveCompensationWriteResources,
  endpoints: [
    {
      name: 'create-adjustment',
      method: 'POST',
      buildParity: (r) => ({ path: '/compensation/adjustments', body: compensationBody(r.subjectA) }),
      // cross-org: create an adjustment FOR an org-B user → subject out of org-A scope → 403.
      buildIdor: (r) => ({ path: '/compensation/adjustments', body: compensationBody(r.subjectB) }),
      idorDeniedStatuses: [403],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      allowRolesLiveTestable: true, // unconditional insert → each allow role can create its own row
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (o.status !== 'pending') return `expected status 'pending', got ${JSON.stringify(o.status)}`;
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        return null;
      },
      // Self-LOCATE the freshly-created row by our marker (reason='parity', which the seed fixture row
      // has as NULL) rather than trusting the response id, then assert the response id matches it — so a
      // C# bug echoing a stale/other id (e.g. the seed fixture's) is caught, not passed on the fixture row.
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id, status, new_salary, requested_by_id, approved_by_id
                FROM salary_adjustments
                WHERE user_id = $1 AND reason = 'parity' AND status = 'pending' AND requested_by_id = $2
                ORDER BY created_at DESC LIMIT 1`,
          params: [r.subjectA, r.userIdByRole.super_admin],
          expect: (rows) => {
            if (rows.length !== 1) return `no freshly-created (reason='parity') pending row for subjectA by the probe`;
            const row = rows[0];
            if (row.id !== respId)
              return `response id ${JSON.stringify(respId)} != the created row id ${row.id} (stale/wrong id echoed?)`;
            if (Number(row.new_salary) !== 66000) return `created row new_salary ${row.new_salary} != 66000`;
            if (row.approved_by_id !== null) return `approved_by_id should be null on create`;
            return null;
          },
        };
      },
      // M3: an allow role (e.g. hr_admin, a NON-bypass grant) really created a row under its own grant.
      readbackAllow: (r, role, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM salary_adjustments
                WHERE user_id = $1 AND reason = 'parity' AND status = 'pending' AND requested_by_id = $2
                ORDER BY created_at DESC LIMIT 1`,
          params: [r.subjectA, r.userIdByRole[role]],
          expect: (rows) => {
            if (rows.length !== 1) return `allow role '${role}': no row created under its grant`;
            if (rows[0].id !== respId) return `allow role '${role}': response id != created row id`;
            return null;
          },
        };
      },
      // No row must have been inserted by the forbidden attempt: IDOR keys on (subjectB, super_admin);
      // rbac-deny keys on (subjectA, denierRole). The seeded pending rows carry different requesters,
      // so a 0 count here means specifically the forbidden create did NOT insert.
      readbackNoMutation: (r, target, denierRole) => {
        const userId = target === 'b' ? r.subjectB : r.subjectA;
        const requester = target === 'b' ? r.userIdByRole.super_admin : r.userIdByRole[denierRole ?? ''];
        return {
          sql: `SELECT count(*)::int AS n FROM salary_adjustments WHERE user_id = $1 AND requested_by_id = $2`,
          params: [userId, requester],
          expect: (rows) =>
            Number(rows[0]?.n) === 0 ? null : `a forbidden create still inserted ${rows[0]?.n} row(s)`,
        };
      },
    },
    {
      name: 'approve-adjustment',
      method: 'POST',
      buildParity: (r) => ({ path: `/compensation/adjustments/${enc(r.resourceA)}/approve`, body: { approved: true } }),
      // cross-org: approve an org-B adjustment id → assertScoped ScopedNotFound → 404.
      buildIdor: (r) => ({ path: `/compensation/adjustments/${enc(r.resourceB)}/approve`, body: { approved: true } }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (o.status !== 'approved') return `expected status 'approved', got ${JSON.stringify(o.status)}`;
        if (typeof o.id !== 'string') return `missing id in response`;
        return null;
      },
      readbackMutated: (r) => ({
        // the tx flips the adjustment AND writes employee_compensations.current_salary = new_salary.
        sql: `SELECT a.status, a.approved_by_id, c.current_salary
              FROM salary_adjustments a
              LEFT JOIN employee_compensations c
                ON c.user_id = a.user_id AND c.organization_id = a.organization_id
              WHERE a.id = $1`,
        params: [r.resourceA],
        expect: (rows) => {
          if (rows.length !== 1) return `expected the approved row, found ${rows.length}`;
          const row = rows[0];
          if (row.status !== 'approved') return `row status ${row.status} != approved`;
          if (row.approved_by_id !== r.userIdByRole.super_admin) return `approved_by_id != probe (super_admin)`;
          if (Number(row.current_salary) !== 66000)
            return `employee_compensations.current_salary ${row.current_salary} != 66000 (tx side effect missing)`;
          return null;
        },
      }),
      // After a denied approve the target must be UNCHANGED on BOTH sides of the tx: the adjustment
      // still pending AND the subject's employee_compensations.current_salary NOT flipped to new_salary.
      // The comp read is the real cross-tenant write-leak check — a 404 that still ran the comp
      // ExecuteUpdate (a separate, org-keyed statement) would leak org-B's salary while the adjustment
      // stays pending; a status-only check would MISS that (both subjects start at current_salary=60000).
      readbackNoMutation: (r, target) => {
        const id = target === 'b' ? r.resourceB : r.resourceA;
        return {
          sql: `SELECT a.status, a.approved_by_id, c.current_salary
                FROM salary_adjustments a
                LEFT JOIN employee_compensations c
                  ON c.user_id = a.user_id AND c.organization_id = a.organization_id
                WHERE a.id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition adjustment ${id} missing`;
            if (rows[0].status !== 'pending')
              return `a forbidden approve mutated the adjustment → status ${rows[0].status}`;
            if (rows[0].approved_by_id !== null) return `a forbidden approve set approved_by_id`;
            if (Number(rows[0].current_salary) !== 60000)
              return `a forbidden approve LEAKED into employee_compensations.current_salary = ${rows[0].current_salary} (expected unchanged 60000)`;
            return null;
          },
        };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// evaluation360 — Platform__Evaluation360WriteEnabled (6 writes)
// ─────────────────────────────────────────────────────────────────────────────
/** The 6 FRESH-360 competencies (packages/shared EVAL360_COMPETENCIES). submitRatings requires
 *  EXACTLY these six, each once (Zod .length(6) + distinct refine). */
export const EVAL360_COMPETENCIES = [
  'leadership',
  'communication',
  'collaboration',
  'execution',
  'adaptability',
  'integrity',
] as const;

const sixRatings = () => EVAL360_COMPETENCIES.map((competencyKey) => ({ competencyKey, rating: 3, comment: 'parity' }));

/** Concrete ids resolved for the evaluation360 write surface (seed.ts resolveEvaluation360WriteResources). */
export interface Evaluation360WriteResolved extends WriteResolvedBase {
  /** org-A user id per role (super_admin/hr_admin/hrbp). */
  userIdByRole: Record<string, string>;
  /** org-A subject user for assignRaters bodies (a:hr_admin). */
  subjectA: string;
  /** org-A + org-B pending submit assignment ids (rater = super_a / b:super), resolved by
   *  natural key (their gen_random_uuid ids are not fixed). */
  submitAssignA: string;
  submitAssignB: string;
}

/** open/close/publish share one shape: staff gate + a guarded transition. A cross-org cycle
 *  id is invisible under the caller's TenantScope → count 0 → 409 (IDOR-denied); a denied
 *  attempt leaves the cycle in its from-state (no mutation). */
const transitionEndpoint = (
  name: string,
  verb: 'open' | 'close' | 'publish',
  cycleA: string,
  cycleB: string,
  fromStatus: string,
  toStatus: string,
): WriteEndpointDef<Evaluation360WriteResolved> => ({
  name,
  method: 'POST',
  buildParity: () => ({ path: `/evaluation360/cycles/${cycleA}/${verb}`, body: {} }),
  buildIdor: () => ({ path: `/evaluation360/cycles/${cycleB}/${verb}`, body: {} }),
  idorDeniedStatuses: [409], // cross-org row invisible → guarded ExecuteUpdate count 0 → 409
  expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp lacks evaluation360:update
  rbacDenyStatus: 403,
  expectResponse: (b) => {
    const o = asObj(b);
    if (!o) return 'response is not an object';
    if (o.status !== toStatus) return `expected status '${toStatus}', got ${JSON.stringify(o.status)}`;
    if (o.cycleId !== cycleA) return `expected cycleId ${cycleA}, got ${JSON.stringify(o.cycleId)}`;
    return null;
  },
  readbackMutated: () => ({
    sql: `SELECT status FROM review_cycles WHERE id = $1`,
    params: [cycleA],
    expect: (rows) => {
      if (rows.length !== 1) return `cycle ${cycleA} missing`;
      if (rows[0].status !== toStatus)
        return `cycle status ${rows[0].status} != ${toStatus} (transition did not apply)`;
      return null;
    },
  }),
  // A denied transition (IDOR org-B, or rbac-deny org-A) must leave the cycle in its from-state.
  readbackNoMutation: (_r, target) => {
    const id = target === 'b' ? cycleB : cycleA;
    return {
      sql: `SELECT status FROM review_cycles WHERE id = $1`,
      params: [id],
      expect: (rows) => {
        if (rows.length !== 1) return `precondition cycle ${id} missing`;
        if (rows[0].status !== fromStatus)
          return `a forbidden ${verb} mutated the cycle → status ${rows[0].status} (expected ${fromStatus})`;
        return null;
      },
    };
  },
});

const evaluation360Surface: WriteSurface<Evaluation360WriteResolved> = {
  key: 'evaluation360',
  flag: 'Platform__Evaluation360WriteEnabled',
  probeRole: 'super_admin',
  roles: ['super_admin', 'hr_admin', 'hrbp'],
  ensurePreconditions: ensureEvaluation360WritePreconditions,
  resolveResources: resolveEvaluation360WriteResources,
  endpoints: [
    // ── createCycle — unconditional create; NO IDOR (org fixed by caller context). ──────
    {
      name: 'create-cycle',
      method: 'POST',
      buildParity: () => ({ path: '/evaluation360/cycles', body: { name: WRITE_CYCLE_MARKER } }),
      // no buildIdor: createCycle has no cross-org target (the org comes from the JWT context).
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp lacks evaluation360:create
      rbacDenyStatus: 403,
      allowRolesLiveTestable: true, // unconditional insert; each allow role creates its own cycle
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (o.status !== 'draft') return `expected status 'draft', got ${JSON.stringify(o.status)}`;
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        if (o.name !== WRITE_CYCLE_MARKER)
          return `expected name ${JSON.stringify(WRITE_CYCLE_MARKER)}, got ${JSON.stringify(o.name)}`;
        return null;
      },
      // Self-locate the freshly-created draft cycle by (created_by = probe, marker name) and assert
      // the response id matches — a C# bug echoing a stale/other id is caught, not passed.
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id, status FROM review_cycles
                WHERE created_by_id = $1 AND name = $2 AND status = 'draft'
                ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole.super_admin, WRITE_CYCLE_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `no freshly-created draft cycle by the probe`;
            if (rows[0].id !== respId)
              return `response id ${JSON.stringify(respId)} != created cycle id ${rows[0].id} (stale/wrong id echoed?)`;
            return null;
          },
        };
      },
      readbackAllow: (r, role, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM review_cycles
                WHERE created_by_id = $1 AND name = $2 AND status = 'draft'
                ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole[role], WRITE_CYCLE_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `allow role '${role}': no cycle created under its grant`;
            if (rows[0].id !== respId) return `allow role '${role}': response id != created cycle id`;
            return null;
          },
        };
      },
      // rbac-deny (hrbp): no cycle must exist created by the denied role with the marker name.
      readbackNoMutation: (r, _target, denierRole) => ({
        sql: `SELECT count(*)::int AS n FROM review_cycles WHERE created_by_id = $1 AND name = $2`,
        params: [r.userIdByRole[denierRole ?? ''], WRITE_CYCLE_MARKER],
        expect: (rows) =>
          Number(rows[0]?.n) === 0 ? null : `a forbidden createCycle still inserted ${rows[0]?.n} cycle(s)`,
      }),
    },

    // ── open / close / publish — guarded state transitions (cross-org → 409). ───────────
    transitionEndpoint('open-cycle', 'open', WRITE_EVAL_CYCLES.draftA, WRITE_EVAL_CYCLES.draftB, 'draft', 'open'),
    transitionEndpoint('close-cycle', 'close', WRITE_EVAL_CYCLES.openA, WRITE_EVAL_CYCLES.openB, 'open', 'closed'),
    transitionEndpoint(
      'publish-cycle',
      'publish',
      WRITE_EVAL_CYCLES.closedA,
      WRITE_EVAL_CYCLES.closedB,
      'closed',
      'published',
    ),

    // ── assignRaters — create-grant; cross-org cycle → cycleNotOpen 409. ────────────────
    {
      name: 'assign-raters',
      method: 'POST',
      // subject a:hr_admin, rater a:hrbp (both org-A) → a valid in-org assignment into the org-A cycle.
      buildParity: (r) => ({
        path: `/evaluation360/cycles/${WRITE_EVAL_CYCLES.assignA}/raters`,
        body: { assignments: [{ subjectUserId: r.subjectA, raterUserId: r.userIdByRole.hrbp, relationship: 'peer' }] },
      }),
      // cross-org: org-A token → an org-B cycle id → the in-tx cycle re-check finds no such cycle
      // in org A (RLS hides org B) → cycleNotOpen → 409. The org-A users in the body are moot (the
      // cycle check fails first) — the tenant-isolation target is the CYCLE.
      buildIdor: (r) => ({
        path: `/evaluation360/cycles/${WRITE_EVAL_CYCLES.assignB}/raters`,
        body: { assignments: [{ subjectUserId: r.subjectA, raterUserId: r.userIdByRole.hrbp, relationship: 'peer' }] },
      }),
      idorDeniedStatuses: [409],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp lacks evaluation360:create
      rbacDenyStatus: 403,
      // Not live-tested for the non-probe allow role: rater_assignments has no requester column to
      // attribute a second insert, and hr_admin assigning into the same cycle risks a unique-key
      // clash. The probe covers the allow path; hrbp covers deny.
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        // Fresh seed (ensurePreconditions clears prior assignments) → exactly 1 created.
        if (o.created !== 1) return `expected created=1, got ${JSON.stringify(o.created)}`;
        return null;
      },
      readbackMutated: (r) => ({
        sql: `SELECT count(*)::int AS n FROM rater_assignments
              WHERE cycle_id = $1 AND subject_user_id = $2 AND rater_user_id = $3`,
        params: [WRITE_EVAL_CYCLES.assignA, r.subjectA, r.userIdByRole.hrbp],
        expect: (rows) =>
          Number(rows[0]?.n) === 1 ? null : `assignRaters did not create the assignment (found ${rows[0]?.n})`,
      }),
      // Denied assign (IDOR org-B cycle, or rbac-deny before the probe inserted): no assignment
      // exists for that (cycle, subject, rater).
      readbackNoMutation: (r, target) => {
        const cycleId = target === 'b' ? WRITE_EVAL_CYCLES.assignB : WRITE_EVAL_CYCLES.assignA;
        return {
          sql: `SELECT count(*)::int AS n FROM rater_assignments
                WHERE cycle_id = $1 AND subject_user_id = $2 AND rater_user_id = $3`,
          params: [cycleId, r.subjectA, r.userIdByRole.hrbp],
          expect: (rows) =>
            Number(rows[0]?.n) === 0 ? null : `a forbidden assignRaters still inserted ${rows[0]?.n} assignment(s)`,
        };
      },
    },

    // ── submitRatings — IDENTITY-anchored; non-owner (any role) or cross-org → 404. ─────
    {
      name: 'submit-ratings',
      method: 'POST',
      buildParity: (r) => ({
        path: `/evaluation360/assignments/${enc(r.submitAssignA)}/ratings`,
        body: { ratings: sixRatings() },
      }),
      // cross-org: org-A super → an org-B assignment id → the ownership pre-fetch {id, org=A,
      // rater=super_a} finds nothing → 404 (id/org/rater mismatch is indistinguishable from outside).
      buildIdor: (r) => ({
        path: `/evaluation360/assignments/${enc(r.submitAssignB)}/ratings`,
        body: { ratings: sixRatings() },
      }),
      idorDeniedStatuses: [404],
      // The load-bearing invariant: authorization is raterUserId === caller, NOT a grant. hr_admin
      // and hrbp are NOT the rater of submitAssignA → 404, no forged feedback. rbacDenyStatus = 404.
      expectedByRole: { super_admin: 'allow', hr_admin: 'deny', hrbp: 'deny' },
      rbacDenyStatus: 404,
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (o.status !== 'submitted') return `expected status 'submitted', got ${JSON.stringify(o.status)}`;
        if (typeof o.assignmentId !== 'string') return `missing assignmentId in response`;
        return null;
      },
      readbackMutated: (r) => ({
        // the claim tx flips the assignment AND inserts the 6 rater_responses — both or neither.
        sql: `SELECT a.status,
                     (SELECT count(*)::int FROM rater_responses WHERE assignment_id = a.id) AS n
              FROM rater_assignments a WHERE a.id = $1`,
        params: [r.submitAssignA],
        expect: (rows) => {
          if (rows.length !== 1) return `submit assignment ${r.submitAssignA} missing`;
          if (rows[0].status !== 'submitted') return `assignment status ${rows[0].status} != submitted`;
          if (Number(rows[0].n) !== 6) return `expected 6 rater_responses, found ${rows[0].n}`;
          return null;
        },
      }),
      // Denied submit (IDOR org-B assignment, or rbac-deny non-owner on org-A assignment): the
      // assignment stays pending AND has zero responses (no forged feedback written).
      readbackNoMutation: (r, target) => {
        const id = target === 'b' ? r.submitAssignB : r.submitAssignA;
        return {
          sql: `SELECT a.status,
                       (SELECT count(*)::int FROM rater_responses WHERE assignment_id = a.id) AS n
                FROM rater_assignments a WHERE a.id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition assignment ${id} missing`;
            if (rows[0].status !== 'pending')
              return `a forbidden submit mutated the assignment → status ${rows[0].status}`;
            if (Number(rows[0].n) !== 0) return `a forbidden submit wrote ${rows[0].n} forged response(s)`;
            return null;
          },
        };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// succession — Platform__SuccessionWriteEnabled (5 writes)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the succession write surface (seed.ts resolveSuccessionWriteResources).
 *  The fixed parent-role ids live in WRITE_SUCCESSION_ROLES (referenced directly); the successor
 *  ids (gen_random_uuid) are resolved by natural key. */
export interface SuccessionWriteResolved extends WriteResolvedBase {
  /** org-A user id per role (super_admin/hr_admin/hrbp). */
  userIdByRole: Record<string, string>;
  /** org-A subject user (addCriticalRole holder + addSuccessor subject). */
  subjectA: string;
  /** org-B subject user (cross-org holder / successor — the createAdjustment-class H1 target). */
  subjectB: string;
  successorRemoveA: string;
  successorRemoveB: string;
  successorReadinessA: string;
  successorReadinessB: string;
}

const idPresent = (b: unknown): string | null => {
  const o = asObj(b);
  if (!o) return 'response is not an object';
  if (typeof o.id !== 'string' || o.id.length === 0) return `missing id in response`;
  return null;
};

// NOTE 2026-08-03 (#58): the TS procedure names below (addCriticalRole, removeSuccessor,
// updateSuccessorReadiness, …) are now HISTORICAL LABELS ONLY — packages/api/src/routers/succession.ts
// is deleted and C# is the sole implementation. This surface is unaffected: it drives the C# HTTP
// endpoints directly via raw SQL read-backs and has no tsProcedure field, so it never depended on the
// TS side existing. The scope mechanics described are the C# endpoints' own behaviour, verified by
// SuccessionWriteEndpointAuthTests.cs.
//
// 5 writes under ONE flag Platform__SuccessionWriteEnabled. addCriticalRole (requireOrgScope create;
// cross-org holder → 400) + addSuccessor (assertScoped(criticalRole) 404 THEN assertSubjectInScope +
// H1 SubjectNotInOrg → 403 for a cross-org userId) + removeSuccessor (delete, assertScoped 404) +
// updateSuccessorReadiness (patch, assertScoped 404) + updateCriticalRoleBand (patch, assertScoped 404).
// hrbp is read-only → every write 403 at the gate. NO allow-live: critical_roles has no caller-stamped
// column and the shared-body harness can't mint a distinct 2nd create (successors' unique key clashes),
// so the non-bypass allow role isn't independently live-proven here (probe covers the happy path + the
// H1/reference guards; hrbp-deny proves the gate). A documented coverage nuance, not a false-green.
const successionSurface: WriteSurface<SuccessionWriteResolved> = {
  key: 'succession',
  flag: 'Platform__SuccessionWriteEnabled',
  probeRole: 'super_admin',
  roles: ['super_admin', 'hr_admin', 'hrbp'],
  ensurePreconditions: ensureSuccessionWritePreconditions,
  resolveResources: resolveSuccessionWriteResources,
  endpoints: [
    // ── addCriticalRole — requireOrgScope create; cross-org holder → 400 (H2 reference guard). ──
    {
      name: 'add-critical-role',
      method: 'POST',
      buildParity: (r) => ({
        path: '/succession/critical-roles',
        body: { title: WRITE_SUCCESSION_CR_MARKER, criticality: 'high', currentHolderId: r.subjectA },
      }),
      // cross-org: an org-B currentHolderId → not in the caller's org → 400 invalid_reference (no INSERT).
      // NB: 400 is also the malformed-body status, so it is NOT isolation-specific on its own — the IDOR
      // body here is well-formed (valid uuid holder), so it genuinely reaches the reference guard, and the
      // no-mutation read-back (no row with that org-B holder) is the LOAD-BEARING proof, not the status.
      buildIdor: (r) => ({
        path: '/succession/critical-roles',
        body: { title: WRITE_SUCCESSION_CR_MARKER, criticality: 'high', currentHolderId: r.subjectB },
      }),
      idorDeniedStatuses: [400],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no succession:create → 403
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM critical_roles WHERE id = $1 AND title = $2 AND current_holder_id = $3`,
          params: [respId, WRITE_SUCCESSION_CR_MARKER, r.subjectA],
          expect: (rows) =>
            rows.length === 1 ? null : `no created marker critical role matching the response id + org-A holder`,
        };
      },
      // IDOR: no role created with the org-B holder. deny (hrbp, runs before parity): no marker role
      // with the org-A holder yet. Both key on current_holder_id so they don't see each other's rows.
      readbackNoMutation: (r, target) => {
        const holder = target === 'b' ? r.subjectB : r.subjectA;
        return {
          sql: `SELECT count(*)::int AS n FROM critical_roles WHERE title = $1 AND current_holder_id = $2`,
          params: [WRITE_SUCCESSION_CR_MARKER, holder],
          expect: (rows) =>
            Number(rows[0]?.n) === 0 ? null : `a forbidden addCriticalRole still inserted ${rows[0]?.n} row(s)`,
        };
      },
    },

    // ── addSuccessor — assertScoped(criticalRole) 404 THEN cross-org userId → 403 (H1 SubjectNotInOrg). ──
    {
      name: 'add-successor',
      method: 'POST',
      buildParity: (r) => ({
        path: `/succession/critical-roles/${WRITE_SUCCESSION_ROLES.addA}/successors`,
        body: { userId: r.subjectA, readiness: 'ready_now', type: 'internal' },
      }),
      // cross-org: a valid org-A parent role + an org-B userId → assertSubjectInScope no-ops for org
      // scope → the H1 org-membership guard rejects → 403 (the createAdjustment-class hole, both-stacks-fixed).
      buildIdor: (r) => ({
        path: `/succession/critical-roles/${WRITE_SUCCESSION_ROLES.addA}/successors`,
        body: { userId: r.subjectB, readiness: 'ready_now', type: 'internal' },
      }),
      idorDeniedStatuses: [403],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM successors WHERE critical_role_id = $1 AND user_id = $2`,
          params: [WRITE_SUCCESSION_ROLES.addA, r.subjectA],
          expect: (rows) => {
            if (rows.length !== 1) return `addSuccessor did not create the successor (found ${rows.length})`;
            if (rows[0].id !== respId) return `response id != created successor id`;
            return null;
          },
        };
      },
      // IDOR: no successor for the org-B userId. deny: no successor added_by the denier (hrbp).
      readbackNoMutation: (r, target, denierRole) =>
        target === 'b'
          ? {
              sql: `SELECT count(*)::int AS n FROM successors WHERE critical_role_id = $1 AND user_id = $2`,
              params: [WRITE_SUCCESSION_ROLES.addA, r.subjectB],
              expect: (rows) =>
                Number(rows[0]?.n) === 0 ? null : `a forbidden addSuccessor inserted a cross-org successor`,
            }
          : {
              sql: `SELECT count(*)::int AS n FROM successors WHERE critical_role_id = $1 AND added_by_id = $2`,
              params: [WRITE_SUCCESSION_ROLES.addA, r.userIdByRole[denierRole ?? '']],
              expect: (rows) =>
                Number(rows[0]?.n) === 0 ? null : `a forbidden addSuccessor inserted ${rows[0]?.n} row(s)`,
            },
    },

    // ── removeSuccessor — DELETE by-id; assertScoped(successor) 404. ─────────────────────────────
    {
      name: 'remove-successor',
      method: 'DELETE',
      buildParity: (r) => ({ path: `/succession/successors/${enc(r.successorRemoveA)}`, body: null }),
      buildIdor: (r) => ({ path: `/succession/successors/${enc(r.successorRemoveB)}`, body: null }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no succession:delete
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: (r) => ({
        sql: `SELECT count(*)::int AS n FROM successors WHERE id = $1`,
        params: [r.successorRemoveA],
        expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `removeSuccessor did not delete the row`),
      }),
      // A denied delete must leave the target intact (org-B for IDOR, org-A for rbac-deny).
      readbackNoMutation: (r, target) => {
        const id = target === 'b' ? r.successorRemoveB : r.successorRemoveA;
        return {
          sql: `SELECT count(*)::int AS n FROM successors WHERE id = $1`,
          params: [id],
          expect: (rows) => (Number(rows[0]?.n) === 1 ? null : `a forbidden removeSuccessor deleted the row`),
        };
      },
    },

    // ── updateSuccessorReadiness — PATCH by-id; assertScoped(successor) 404. ─────────────────────
    {
      name: 'update-successor-readiness',
      method: 'PATCH',
      buildParity: (r) => ({
        path: `/succession/successors/${enc(r.successorReadinessA)}/readiness`,
        body: { readiness: 'ready_now' },
      }),
      buildIdor: (r) => ({
        path: `/succession/successors/${enc(r.successorReadinessB)}/readiness`,
        body: { readiness: 'ready_now' },
      }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no succession:update
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: (r) => ({
        sql: `SELECT readiness FROM successors WHERE id = $1`,
        params: [r.successorReadinessA],
        expect: (rows) => {
          if (rows.length !== 1) return `successor ${r.successorReadinessA} missing`;
          if (rows[0].readiness !== 'ready_now')
            return `readiness ${rows[0].readiness} != ready_now (update did not apply)`;
          return null;
        },
      }),
      // A denied update leaves the from-state 'developing'.
      readbackNoMutation: (r, target) => {
        const id = target === 'b' ? r.successorReadinessB : r.successorReadinessA;
        return {
          sql: `SELECT readiness FROM successors WHERE id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition successor ${id} missing`;
            if (rows[0].readiness !== 'developing')
              return `a forbidden update mutated readiness → ${rows[0].readiness}`;
            return null;
          },
        };
      },
    },

    // ── updateCriticalRoleBand — PATCH by-id; assertScoped(criticalRole) 404. ────────────────────
    {
      name: 'update-critical-role-band',
      method: 'PATCH',
      buildParity: () => ({
        path: `/succession/critical-roles/${WRITE_SUCCESSION_ROLES.bandA}/band`,
        body: { targetBandLevel: 'PARITY-BAND' },
      }),
      buildIdor: () => ({
        path: `/succession/critical-roles/${WRITE_SUCCESSION_ROLES.bandB}/band`,
        body: { targetBandLevel: 'PARITY-BAND' },
      }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: (b) => {
        const idErr = idPresent(b);
        if (idErr) return idErr;
        const o = asObj(b)!;
        if (o.targetBandLevel !== 'PARITY-BAND')
          return `expected targetBandLevel 'PARITY-BAND', got ${JSON.stringify(o.targetBandLevel)}`;
        return null;
      },
      readbackMutated: () => ({
        sql: `SELECT target_band_level FROM critical_roles WHERE id = $1`,
        params: [WRITE_SUCCESSION_ROLES.bandA],
        expect: (rows) => {
          if (rows.length !== 1) return `critical role ${WRITE_SUCCESSION_ROLES.bandA} missing`;
          if (rows[0].target_band_level !== 'PARITY-BAND')
            return `target_band_level ${rows[0].target_band_level} != PARITY-BAND`;
          return null;
        },
      }),
      // A denied band update leaves the from-state: org-A = NULL, org-B = the seeded 'ORGB-BAND'.
      readbackNoMutation: (_r, target) => {
        const id = target === 'b' ? WRITE_SUCCESSION_ROLES.bandB : WRITE_SUCCESSION_ROLES.bandA;
        const expected = target === 'b' ? 'ORGB-BAND' : null;
        return {
          sql: `SELECT target_band_level FROM critical_roles WHERE id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition critical role ${id} missing`;
            if ((rows[0].target_band_level ?? null) !== expected)
              return `a forbidden band update mutated target_band_level → ${JSON.stringify(rows[0].target_band_level)} (expected ${JSON.stringify(expected)})`;
            return null;
          },
        };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// engagement — Platform__EngagementWriteEnabled (5 writes)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the engagement write surface (seed.ts resolveEngagementWriteResources). All
 *  survey/action-plan ids are fixed constants (WRITE_ENGAGEMENT); only the user ids are dynamic. */
export interface EngagementWriteResolved extends WriteResolvedBase {
  /** org-A user id per role (super_admin/hr_admin/hrbp). */
  userIdByRole: Record<string, string>;
  /** org-A subject (createActionPlan responsibleId). */
  subjectA: string;
  /** org-B subject (createActionPlan cross-org responsibleId — the H1 target). */
  subjectB: string;
}

const surveyBody = () => ({
  title: WRITE_ENGAGEMENT_SURVEY_MARKER,
  type: 'pulse',
  questions: [{ text: 'Parity Q', type: 'scale' }],
});

// 5 writes under ONE flag Platform__EngagementWriteEnabled (COEXISTENCE, not a flip — TS monitoring/dei/
// alert-cron still read these tables). createSurvey (grant-only; created_by attributed → allow-live) +
// activateSurvey (by-id draft→active; cross-org → 404) + submitSurveyResponse (identity userId=caller +
// create grant; cross-org survey → 404; user_id attributed → allow-live) + createActionPlan (assertSubject
// InScope + H1 cross-org responsibleId → 403) + updateActionPlan (assertScoped by-id → 404). hrbp is
// ungranted → every write 403 at the gate.
//
// UPDATE 2026-07-29: the TS counterparts of createSurvey / activateSurvey / submitSurveyResponse were
// DELETED (the FE write flag is confirmed live in prod; C# is the sole implementation). This surface is
// UNAFFECTED — it hits the C# HTTP endpoints directly and never went through the TS router — but the
// readbacks below are now the ONLY automated assertion of provenance stamping (created_by_id = caller),
// identity anchoring (user_id = caller, never an input) and the duplicate-response 409 CONFLICT, outside
// the C# integration tests. Treat them as security-load-bearing; do not weaken them.
// UPDATE 2026-08-05 (#56): this note used to end "createActionPlan / updateActionPlan still have live TS
// twins (zero-FE-consumer dead code, deliberately retained), so those two rows continue to describe a
// genuine two-stack surface." Both TS twins are now DELETED — `action_plans` has ZERO TS writers — so the
// action-plan rows below describe a SINGLE-stack surface like the other three. The rows themselves need no
// change (they always drove the C# endpoints and asserted with raw SQL), but they are now the only
// automated assertion of the H1 cross-org `responsibleId` denial and the assertScoped by-id 404 outside
// the C# integration tests. Same warning as above: security-load-bearing, do not weaken.
const engagementSurface: WriteSurface<EngagementWriteResolved> = {
  key: 'engagement',
  flag: 'Platform__EngagementWriteEnabled',
  probeRole: 'super_admin',
  roles: ['super_admin', 'hr_admin', 'hrbp'],
  ensurePreconditions: ensureEngagementWritePreconditions,
  resolveResources: resolveEngagementWriteResources,
  endpoints: [
    // ── createSurvey — grant-only create; NO IDOR (org from ctx); created_by → allow-live. ──────
    {
      name: 'create-survey',
      method: 'POST',
      buildParity: () => ({ path: '/engagement/surveys', body: surveyBody() }),
      // no buildIdor: the org is fixed by the caller's context; targetGroups are stored opaque (not a
      // cross-org write target — a documented LOW in the C# port), so there is no IDOR surface.
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no engagement:create → 403
      rbacDenyStatus: 403,
      allowRolesLiveTestable: true, // created_by_id attributes each allow role's own survey
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id, status FROM surveys WHERE created_by_id = $1 AND title = $2 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole.super_admin, WRITE_ENGAGEMENT_SURVEY_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `no freshly-created draft survey by the probe`;
            if (rows[0].id !== respId)
              return `response id ${JSON.stringify(respId)} != created survey id ${rows[0].id}`;
            return null;
          },
        };
      },
      readbackAllow: (r, role, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM surveys WHERE created_by_id = $1 AND title = $2 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole[role], WRITE_ENGAGEMENT_SURVEY_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `allow role '${role}': no survey created under its grant`;
            if (rows[0].id !== respId) return `allow role '${role}': response id != created survey id`;
            return null;
          },
        };
      },
      readbackNoMutation: (r, _target, denierRole) => ({
        sql: `SELECT count(*)::int AS n FROM surveys WHERE created_by_id = $1 AND title = $2`,
        params: [r.userIdByRole[denierRole ?? ''], WRITE_ENGAGEMENT_SURVEY_MARKER],
        expect: (rows) =>
          Number(rows[0]?.n) === 0 ? null : `a forbidden createSurvey still inserted ${rows[0]?.n} survey(s)`,
      }),
    },

    // ── activateSurvey — by-id draft→active; cross-org survey → 404. ─────────────────────────────
    {
      name: 'activate-survey',
      method: 'POST',
      buildParity: () => ({ path: `/engagement/surveys/${WRITE_ENGAGEMENT.activateSurveyA}/activate`, body: null }),
      buildIdor: () => ({ path: `/engagement/surveys/${WRITE_ENGAGEMENT.activateSurveyB}/activate`, body: null }),
      idorDeniedStatuses: [404], // findFirst {id, org=A} on an org-B survey → null → 404
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: () => ({
        sql: `SELECT status FROM surveys WHERE id = $1`,
        params: [WRITE_ENGAGEMENT.activateSurveyA],
        expect: (rows) => {
          if (rows.length !== 1) return `survey ${WRITE_ENGAGEMENT.activateSurveyA} missing`;
          if (rows[0].status !== 'active') return `survey status ${rows[0].status} != active (activate did not apply)`;
          return null;
        },
      }),
      // A denied activate leaves the survey in its 'draft' from-state.
      readbackNoMutation: (_r, target) => {
        const id = target === 'b' ? WRITE_ENGAGEMENT.activateSurveyB : WRITE_ENGAGEMENT.activateSurveyA;
        return {
          sql: `SELECT status FROM surveys WHERE id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition survey ${id} missing`;
            if (rows[0].status !== 'draft') return `a forbidden activate mutated the survey → status ${rows[0].status}`;
            return null;
          },
        };
      },
    },

    // ── submitSurveyResponse — identity (userId=caller) + create grant; cross-org survey → 404. ──
    {
      name: 'submit-survey-response',
      method: 'POST',
      buildParity: () => ({
        path: `/engagement/surveys/${WRITE_ENGAGEMENT.submitSurveyA}/responses`,
        body: { answers: { q1: 'yes' } },
      }),
      // cross-org: an org-B survey id → findFirst {id, org=A, active} → null → SurveyNotActive 404.
      buildIdor: () => ({
        path: `/engagement/surveys/${WRITE_ENGAGEMENT.submitSurveyB}/responses`,
        body: { answers: { q1: 'yes' } },
      }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no engagement:create → 403
      rbacDenyStatus: 403,
      allowRolesLiveTestable: true, // user_id (=caller) attributes each allow role's own response
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM survey_responses WHERE survey_id = $1 AND user_id = $2`,
          params: [WRITE_ENGAGEMENT.submitSurveyA, r.userIdByRole.super_admin],
          expect: (rows) => {
            if (rows.length !== 1) return `submitSurveyResponse did not create the response (found ${rows.length})`;
            if (rows[0].id !== respId) return `response id != created row id`;
            return null;
          },
        };
      },
      readbackAllow: (r, role) => ({
        sql: `SELECT id FROM survey_responses WHERE survey_id = $1 AND user_id = $2`,
        params: [WRITE_ENGAGEMENT.submitSurveyA, r.userIdByRole[role]],
        expect: (rows) => (rows.length === 1 ? null : `allow role '${role}': no response created under its grant`),
      }),
      // IDOR: no response for the org-B survey by the probe. deny: no response for the org-A survey by the denier.
      readbackNoMutation: (r, target, denierRole) => {
        const surveyId = target === 'b' ? WRITE_ENGAGEMENT.submitSurveyB : WRITE_ENGAGEMENT.submitSurveyA;
        const userId = target === 'b' ? r.userIdByRole.super_admin : r.userIdByRole[denierRole ?? ''];
        return {
          sql: `SELECT count(*)::int AS n FROM survey_responses WHERE survey_id = $1 AND user_id = $2`,
          params: [surveyId, userId],
          expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden submit inserted ${rows[0]?.n} response(s)`),
        };
      },
    },

    // ── createActionPlan — assertSubjectInScope + H1 cross-org responsibleId → 403. ──────────────
    {
      name: 'create-action-plan',
      method: 'POST',
      buildParity: (r) => ({
        path: '/engagement/action-plans',
        body: { title: WRITE_ENGAGEMENT_PLAN_MARKER, responsibleId: r.subjectA },
      }),
      // cross-org: an org-B responsibleId → assertSubjectInScope no-ops for org scope → H1 in-org backstop → 403.
      buildIdor: (r) => ({
        path: '/engagement/action-plans',
        body: { title: WRITE_ENGAGEMENT_PLAN_MARKER, responsibleId: r.subjectB },
      }),
      idorDeniedStatuses: [403],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' },
      rbacDenyStatus: 403,
      // Not allow-live: action_plans has no caller-stamped column, so a 2nd concurrent create by hr_admin
      // (same responsibleId) would pollute the deny no-mutation. hr_admin's create grant is already proven
      // live by createSurvey + submitSurveyResponse (both allow-live).
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM action_plans WHERE title = $1 AND responsible_id = $2`,
          params: [WRITE_ENGAGEMENT_PLAN_MARKER, r.subjectA],
          expect: (rows) => {
            if (rows.length !== 1) return `createActionPlan did not create the plan (found ${rows.length})`;
            if (rows[0].id !== respId) return `response id != created plan id`;
            return null;
          },
        };
      },
      // IDOR keys on the org-B responsibleId; deny keys on the org-A responsibleId (deny runs before the
      // single parity create, and there is no allow-live create to pollute it).
      readbackNoMutation: (r, target) => {
        const responsible = target === 'b' ? r.subjectB : r.subjectA;
        return {
          sql: `SELECT count(*)::int AS n FROM action_plans WHERE title = $1 AND responsible_id = $2`,
          params: [WRITE_ENGAGEMENT_PLAN_MARKER, responsible],
          expect: (rows) =>
            Number(rows[0]?.n) === 0 ? null : `a forbidden createActionPlan still inserted ${rows[0]?.n} plan(s)`,
        };
      },
    },

    // ── updateActionPlan — assertScoped by-id → 404. ────────────────────────────────────────────
    {
      name: 'update-action-plan',
      method: 'PATCH',
      buildParity: () => ({
        path: `/engagement/action-plans/${WRITE_ENGAGEMENT.actionPlanA}`,
        body: { status: 'in_progress' },
      }),
      buildIdor: () => ({
        path: `/engagement/action-plans/${WRITE_ENGAGEMENT.actionPlanB}`,
        body: { status: 'in_progress' },
      }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no engagement:update → 403
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: () => ({
        sql: `SELECT status FROM action_plans WHERE id = $1`,
        params: [WRITE_ENGAGEMENT.actionPlanA],
        expect: (rows) => {
          if (rows.length !== 1) return `action plan ${WRITE_ENGAGEMENT.actionPlanA} missing`;
          if (rows[0].status !== 'in_progress') return `status ${rows[0].status} != in_progress (update did not apply)`;
          return null;
        },
      }),
      // A denied update leaves the 'pending' from-state.
      readbackNoMutation: (_r, target) => {
        const id = target === 'b' ? WRITE_ENGAGEMENT.actionPlanB : WRITE_ENGAGEMENT.actionPlanA;
        return {
          sql: `SELECT status FROM action_plans WHERE id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition action plan ${id} missing`;
            if (rows[0].status !== 'pending') return `a forbidden update mutated the plan → status ${rows[0].status}`;
            return null;
          },
        };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// nine-box — Platform__NineBoxWriteEnabled (5 calibration writes)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the nine-box write surface (seed.ts resolveNineBoxWriteResources). Sessions are
 *  fixed constants (WRITE_NINEBOX); only the user ids are dynamic. */
export interface NineBoxWriteResolved extends WriteResolvedBase {
  /** org-A user id per role (super_admin/hr_admin/hrbp). */
  userIdByRole: Record<string, string>;
  /** org-B user (createCalibration cross-org memberId — the H1 target; removeMember IDOR target). */
  subjectB: string;
}

// 5 calibration writes under ONE flag Platform__NineBoxWriteEnabled. createCalibration (create +
// requireOrgScope; cross-org memberId → 400; created_by → allow-live) + submitCalibrationVote
// (MEMBERSHIP+IDENTITY: voter=caller must be a committee member — an hr_admin WITH ninebox:update but
// NOT a member → 403 NotMember, the load-bearing anchor; cross-org session → 404) + addCalibrationMember
// (requireOrgScope; cross-org session → 404) + removeCalibrationMember (DELETE by-id; cross-org → 404) +
// finalizeCalibration (unconditional {id,org}; cross-org → 404). hrbp read-only → every write 403 at the gate.
const nineboxSurface: WriteSurface<NineBoxWriteResolved> = {
  key: 'ninebox',
  flag: 'Platform__NineBoxWriteEnabled',
  probeRole: 'super_admin',
  roles: ['super_admin', 'hr_admin', 'hrbp'],
  ensurePreconditions: ensureNineBoxWritePreconditions,
  resolveResources: resolveNineBoxWriteResources,
  endpoints: [
    // ── createCalibration — create + requireOrgScope; cross-org memberId → 400. ─────────────────
    {
      name: 'create-calibration',
      method: 'POST',
      buildParity: () => ({ path: '/ninebox/calibrations', body: { period: WRITE_NINEBOX_CAL_MARKER } }),
      // cross-org: a memberId that is an org-B user → MemberNotInOrg → 400, nothing written (H1 hardening).
      buildIdor: (r) => ({
        path: '/ninebox/calibrations',
        body: { period: WRITE_NINEBOX_CAL_MARKER, memberIds: [r.subjectB] },
      }),
      idorDeniedStatuses: [400],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no ninebox:create → 403
      rbacDenyStatus: 403,
      allowRolesLiveTestable: true, // created_by_id attributes each allow role's own session
      expectResponse: idPresent,
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM calibration_sessions WHERE created_by_id = $1 AND period = $2 ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole.super_admin, WRITE_NINEBOX_CAL_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `no freshly-created marker session by the probe`;
            if (rows[0].id !== respId)
              return `response id ${JSON.stringify(respId)} != created session id ${rows[0].id}`;
            return null;
          },
        };
      },
      readbackAllow: (r, role, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id FROM calibration_sessions WHERE created_by_id = $1 AND period = $2 ORDER BY created_at DESC LIMIT 1`,
          params: [r.userIdByRole[role], WRITE_NINEBOX_CAL_MARKER],
          expect: (rows) => {
            if (rows.length !== 1) return `allow role '${role}': no session created under its grant`;
            if (rows[0].id !== respId) return `allow role '${role}': response id != created session id`;
            return null;
          },
        };
      },
      // IDOR (target 'b'): the probe's cross-org-member attempt created NO session. deny (target 'a'):
      // the denier created none. Both key on created_by, and the IDOR/deny run BEFORE the single parity create.
      readbackNoMutation: (r, target, denierRole) => {
        const creator = target === 'b' ? r.userIdByRole.super_admin : r.userIdByRole[denierRole ?? ''];
        return {
          sql: `SELECT count(*)::int AS n FROM calibration_sessions WHERE created_by_id = $1 AND period = $2`,
          params: [creator, WRITE_NINEBOX_CAL_MARKER],
          expect: (rows) =>
            Number(rows[0]?.n) === 0 ? null : `a forbidden createCalibration still inserted ${rows[0]?.n} session(s)`,
        };
      },
    },

    // ── submitCalibrationVote — MEMBERSHIP+IDENTITY; non-member (even w/ grant) → 403; cross-org → 404. ──
    {
      name: 'submit-calibration-vote',
      method: 'POST',
      buildParity: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.voteA}/votes`,
        body: { evaluatedUserId: r.userIdByRole.hrbp, quadrant: 'core_player' },
      }),
      // cross-org: an org-B session id → session lookup RLS-hidden → SessionNotFound → 404.
      buildIdor: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.voteB}/votes`,
        body: { evaluatedUserId: r.userIdByRole.hrbp, quadrant: 'core_player' },
      }),
      idorDeniedStatuses: [404],
      // hr_admin HAS ninebox:update but is NOT a member of voteA → 403 NotMember (the membership anchor);
      // hrbp has no update grant → 403 at the gate. Both deny at 403.
      expectedByRole: { super_admin: 'allow', hr_admin: 'deny', hrbp: 'deny' },
      rbacDenyStatus: 403,
      // Prove hr_admin's 403 is specifically NotMember (it passed the grant gate → the membership check
      // is what denied it) — self-substantiating the anchor + implicitly proving hr_admin's :update resolved.
      denyBodyIncludes: { hr_admin: 'miembro del comite' },
      // The no-org_id tenancy-quirk vector: an org-A session + an org-B EVALUATED user. RLS WITH CHECK
      // validates only the session org, so the in-org evaluated check is app-code — probe it (super IS a
      // member of voteA, so control reaches the evaluated-in-org check → EvaluatedNotFound 404).
      extraProbes: [
        {
          label: 'cross-org-evaluated',
          build: (r) => ({
            path: `/ninebox/calibrations/${WRITE_NINEBOX.voteA}/votes`,
            body: { evaluatedUserId: r.subjectB, quadrant: 'core_player' },
          }),
          deniedStatuses: [404],
          readbackNoMutation: (r) => ({
            sql: `SELECT count(*)::int AS n FROM calibration_votes WHERE session_id = $1 AND evaluated_user_id = $2`,
            params: [WRITE_NINEBOX.voteA, r.subjectB],
            expect: (rows) =>
              Number(rows[0]?.n) === 0 ? null : `a cross-org-evaluated vote was written into an org-A session`,
          }),
        },
      ],
      expectResponse: idPresent,
      readbackMutated: (r) => ({
        sql: `SELECT quadrant FROM calibration_votes WHERE session_id = $1 AND evaluated_user_id = $2 AND voter_id = $3`,
        params: [WRITE_NINEBOX.voteA, r.userIdByRole.hrbp, r.userIdByRole.super_admin],
        expect: (rows) => {
          if (rows.length !== 1) return `submitCalibrationVote did not create the vote (found ${rows.length})`;
          if (rows[0].quadrant !== 'core_player') return `vote quadrant ${rows[0].quadrant} != core_player`;
          return null;
        },
      }),
      // IDOR: no vote by the probe in the org-B session. deny: no vote by the denier in voteA (a non-member
      // can't forge a vote — the load-bearing invariant).
      readbackNoMutation: (r, target, denierRole) => {
        const sessionId = target === 'b' ? WRITE_NINEBOX.voteB : WRITE_NINEBOX.voteA;
        const voter = target === 'b' ? r.userIdByRole.super_admin : r.userIdByRole[denierRole ?? ''];
        return {
          sql: `SELECT count(*)::int AS n FROM calibration_votes WHERE session_id = $1 AND voter_id = $2`,
          params: [sessionId, voter],
          expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden vote was cast (${rows[0]?.n})`),
        };
      },
    },

    // ── addCalibrationMember — requireOrgScope; cross-org session → 404. ─────────────────────────
    {
      name: 'add-calibration-member',
      method: 'POST',
      // add hr_admin (an org-A user not already a member of memberA) — a distinct user from the hrbp denier.
      buildParity: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.memberA}/members`,
        body: { userId: r.userIdByRole.hr_admin },
      }),
      buildIdor: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.memberB}/members`,
        body: { userId: r.userIdByRole.hr_admin },
      }),
      idorDeniedStatuses: [404], // cross-org session → SessionNotFound
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no ninebox:update → 403
      rbacDenyStatus: 403,
      // The no-org_id tenancy-quirk vector: an org-A session + an org-B USER. RLS WITH CHECK validates only
      // the session org, so the in-org user check is app-code — probe it (org-A memberA + org-B subjectB →
      // UserNotFound 404, no member written).
      extraProbes: [
        {
          label: 'cross-org-user',
          build: (r) => ({
            path: `/ninebox/calibrations/${WRITE_NINEBOX.memberA}/members`,
            body: { userId: r.subjectB },
          }),
          deniedStatuses: [404],
          readbackNoMutation: (r) => ({
            sql: `SELECT count(*)::int AS n FROM calibration_members WHERE session_id = $1 AND user_id = $2`,
            params: [WRITE_NINEBOX.memberA, r.subjectB],
            expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a cross-org user was added to an org-A session`),
          }),
        },
      ],
      // Not allow-live: calibration_members has no caller-stamped column, and a 2nd add of the same userId
      // (shared body) would 409 (dup). hr_admin's ninebox:create is proven by createCalibration.
      expectResponse: idPresent,
      readbackMutated: (r) => ({
        sql: `SELECT count(*)::int AS n FROM calibration_members WHERE session_id = $1 AND user_id = $2`,
        params: [WRITE_NINEBOX.memberA, r.userIdByRole.hr_admin],
        expect: (rows) =>
          Number(rows[0]?.n) === 1 ? null : `addCalibrationMember did not add the member (found ${rows[0]?.n})`,
      }),
      // IDOR: no member added to the org-B session. deny: no member added to memberA by the denied attempt.
      readbackNoMutation: (r, target) => {
        const sessionId = target === 'b' ? WRITE_NINEBOX.memberB : WRITE_NINEBOX.memberA;
        return {
          sql: `SELECT count(*)::int AS n FROM calibration_members WHERE session_id = $1 AND user_id = $2`,
          params: [sessionId, r.userIdByRole.hr_admin],
          expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden addCalibrationMember inserted a member`),
        };
      },
    },

    // ── removeCalibrationMember — DELETE by-id; cross-org session → 404. ─────────────────────────
    {
      name: 'remove-calibration-member',
      method: 'DELETE',
      buildParity: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.removeA}/members/${enc(r.userIdByRole.hr_admin)}`,
        body: null,
      }),
      buildIdor: (r) => ({
        path: `/ninebox/calibrations/${WRITE_NINEBOX.removeB}/members/${enc(r.subjectB)}`,
        body: null,
      }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no ninebox:update → 403
      rbacDenyStatus: 403,
      // removeCalibrationMember returns { success: true } (no id), so assert success rather than idPresent.
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (o.success !== true) return `expected { success: true }, got ${JSON.stringify(o.success)}`;
        return null;
      },
      readbackMutated: (r) => ({
        sql: `SELECT count(*)::int AS n FROM calibration_members WHERE session_id = $1 AND user_id = $2`,
        params: [WRITE_NINEBOX.removeA, r.userIdByRole.hr_admin],
        expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `removeCalibrationMember did not delete the member`),
      }),
      // A denied remove leaves the member in place (org-B for IDOR, org-A for rbac-deny).
      readbackNoMutation: (r, target) => {
        const [sessionId, userId] =
          target === 'b' ? [WRITE_NINEBOX.removeB, r.subjectB] : [WRITE_NINEBOX.removeA, r.userIdByRole.hr_admin];
        return {
          sql: `SELECT count(*)::int AS n FROM calibration_members WHERE session_id = $1 AND user_id = $2`,
          params: [sessionId, userId],
          expect: (rows) =>
            Number(rows[0]?.n) === 1 ? null : `a forbidden removeCalibrationMember deleted the member`,
        };
      },
    },

    // ── finalizeCalibration — unconditional {id,org} update; cross-org → 404. ────────────────────
    {
      name: 'finalize-calibration',
      method: 'POST',
      buildParity: () => ({ path: `/ninebox/calibrations/${WRITE_NINEBOX.finalizeA}/finalize`, body: null }),
      buildIdor: () => ({ path: `/ninebox/calibrations/${WRITE_NINEBOX.finalizeB}/finalize`, body: null }),
      idorDeniedStatuses: [404],
      expectedByRole: { super_admin: 'allow', hr_admin: 'allow', hrbp: 'deny' }, // hrbp: no ninebox:update → 403
      rbacDenyStatus: 403,
      expectResponse: idPresent,
      readbackMutated: () => ({
        sql: `SELECT status FROM calibration_sessions WHERE id = $1`,
        params: [WRITE_NINEBOX.finalizeA],
        expect: (rows) => {
          if (rows.length !== 1) return `session ${WRITE_NINEBOX.finalizeA} missing`;
          if (rows[0].status !== 'finalized') return `status ${rows[0].status} != finalized (finalize did not apply)`;
          return null;
        },
      }),
      // A denied finalize leaves the 'draft' from-state.
      readbackNoMutation: (_r, target) => {
        const id = target === 'b' ? WRITE_NINEBOX.finalizeB : WRITE_NINEBOX.finalizeA;
        return {
          sql: `SELECT status FROM calibration_sessions WHERE id = $1`,
          params: [id],
          expect: (rows) => {
            if (rows.length !== 1) return `precondition session ${id} missing`;
            if (rows[0].status !== 'draft')
              return `a forbidden finalize mutated the session → status ${rows[0].status}`;
            return null;
          },
        };
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// access-review — Platform__AccessReviewWriteEnabled (1 write: attest)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the access-review write surface (seed.ts resolveAccessReviewWriteResources). */
export interface AccessReviewWriteResolved extends WriteResolvedBase {
  /** org-A id — the attest target (must be a real org; see the AccessReviewWriteResources doc). */
  orgA: string;
  /** org-A `org_admin` user id — the denied role, for the no-mutation read-back. */
  orgAdminUserId: string;
}

const ACCESS_REVIEW_NOTES_MARKER = 'parity';

// Coverage-audit addition (2026-07-27): 1 write under Platform__AccessReviewWriteEnabled.
// `attest` = PlatformOwnerGate + an unconditional insert into `access_reviews`. (This comment used to
// point at "the access-review READ surface in surfaces.ts" for the gate rationale; that surface was
// REMOVED on 2026-07-31 (18282f96) and the pointer dangled until #195, which repointed it at the
// `organization` read surface. As of 2026-08-11 the access-review READ surface is back, C#-only, so
// the original pointer is valid again — see SURFACES['access-review'] in surfaces.ts.) UNLIKE every other
// write surface here, this one has NO cross-org IDOR concept: a platform owner is INTENTIONALLY
// cross-org (they attest ANY org's access review by design — the same reason the read surface's
// RLS check is `globalScope` rather than a leak signal), so `buildIdor` is correctly omitted —
// the same documented precedent as createCycle/createSurvey/createCalibration (an endpoint whose
// org is fixed by context, not the caller's tenant). org_admin (an ordinary org-scoped role, no
// platform-owner bit) is denied at the gate BEFORE any org lookup or body parsing, so its 403 is
// gate-level, not a grant/scope nuance.
const accessReviewSurface: WriteSurface<AccessReviewWriteResolved> = {
  key: 'access-review',
  flag: 'Platform__AccessReviewWriteEnabled',
  probeRole: 'platform_owner',
  roles: ['platform_owner', 'org_admin'],
  ensurePreconditions: ensureAccessReviewWritePreconditions,
  resolveResources: resolveAccessReviewWriteResources,
  endpoints: [
    {
      name: 'attest',
      method: 'POST',
      buildParity: (r) => ({
        path: '/access-review/attest',
        body: { organizationId: r.orgA, notes: ACCESS_REVIEW_NOTES_MARKER },
      }),
      // no buildIdor: see the surface-level comment above — platform-owner attestation has no
      // cross-tenant boundary to probe.
      expectedByRole: { platform_owner: 'allow', org_admin: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        if (typeof o.userCount !== 'number') return `expected numeric userCount, got ${JSON.stringify(o.userCount)}`;
        return null;
      },
      // Self-LOCATE the freshly-created row by our marker notes + org A, then assert the response
      // id matches it — a C# bug echoing a stale/other id is caught, not passed on a prior row.
      readbackMutated: (r, b) => {
        const respId = asObj(b)?.id;
        return {
          sql: `SELECT id, organization_id, reviewer_id, notes
                FROM access_reviews
                WHERE organization_id = $1 AND notes = $2
                ORDER BY created_at DESC LIMIT 1`,
          params: [r.orgA, ACCESS_REVIEW_NOTES_MARKER],
          expect: (rows) => {
            if (rows.length !== 1)
              return `no freshly-created (notes='${ACCESS_REVIEW_NOTES_MARKER}') access_reviews row for org A`;
            const row = rows[0];
            if (row.id !== respId)
              return `response id ${JSON.stringify(respId)} != the created row id ${row.id} (stale/wrong id echoed?)`;
            return null;
          },
        };
      },
      // rbac-deny (org_admin): no access_reviews row must exist attributed to the denied user.
      readbackNoMutation: (r) => ({
        sql: `SELECT count(*)::int AS n FROM access_reviews WHERE organization_id = $1 AND reviewer_id = $2`,
        params: [r.orgA, r.orgAdminUserId],
        expect: (rows) =>
          Number(rows[0]?.n) === 0 ? null : `a forbidden attest by org_admin still inserted ${rows[0]?.n} row(s)`,
      }),
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// platform organizations — Platform__PlatformOrganizationsWriteEnabled (2 writes)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the platform-organizations write surface (seed.ts). */
export interface PlatformOrganizationsWriteResolved extends WriteResolvedBase {
  /** org-A id — the update/suspend target. */
  orgA: string;
  /** org-A `org_admin` user id — the denied role, for the no-mutation read-back. */
  orgAdminUserId: string;
  /** the seeded platform owner — the actor every ALLOWED write must be attributed to. */
  platformOwnerUserId: string;
}

const ORG_WRITE_NAME_MARKER = 'Parity Org Write Marker';

// Registered 2026-08-10 (#195) for Phase-5 slice 20 (PR #202). Like access-review above, this surface
// has NO cross-org IDOR concept — a platform owner updates ANY org by design — so `buildIdor` is
// correctly omitted. `org_admin` is refused by PlatformOwnerGate BEFORE any body parse, so its 403 is
// gate-level.
//
// TWO DELIBERATE SAFETY CHOICES, because this surface mutates the org every OTHER surface runs on:
//
//  1. `suspend` sends `{ suspend: false }` (ACTIVATE), never `true`. Suspending org A would set
//     is_active=false on the tenant that every other parity surface authenticates into, turning one
//     surface's write check into a cross-surface outage. Activating an already-active org still
//     exercises the whole path — gate, TenantScope transaction, the fail-closed audit INSERT, the
//     response shape — and still writes an `org_activated` audit row, which is what the read-back
//     asserts. The only thing it does not cover is the notify fan-out, which fires solely on
//     suspend=true (organizations.ts:299); that stays uncovered here on purpose.
//  2. `update` writes only `name`, never `slug`. Every other surface resolves org A BY SLUG
//     (seed.ts orgIdBySlug), so renaming is inert for them while still being a real, readable-back
//     column write.
//
// Both writes are idempotent, so re-running `verify-write organization` needs no teardown.
const platformOrganizationsSurface: WriteSurface<PlatformOrganizationsWriteResolved> = {
  key: 'organization',
  flag: 'Platform__PlatformOrganizationsWriteEnabled',
  probeRole: 'platform_owner',
  roles: ['platform_owner', 'org_admin'],
  ensurePreconditions: ensurePlatformOrganizationsWritePreconditions,
  resolveResources: resolvePlatformOrganizationsWriteResources,
  endpoints: [
    {
      name: 'update',
      method: 'PATCH',
      buildParity: (r) => ({ path: `/platform/organizations/${r.orgA}`, body: { name: ORG_WRITE_NAME_MARKER } }),
      // no buildIdor: platform-owner update has no cross-tenant boundary to probe (see above).
      expectedByRole: { platform_owner: 'allow', org_admin: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        if (o.name !== ORG_WRITE_NAME_MARKER)
          return `expected name ${ORG_WRITE_NAME_MARKER}, got ${JSON.stringify(o.name)}`;
        return null;
      },
      // The column write AND the fail-closed audit row, together — the audit is the half a
      // response-shape assertion cannot see, and #76's whole divergence lives in it.
      readbackMutated: (r) => ({
        sql: `SELECT o.name,
                     (SELECT count(*)::int FROM audit_logs a
                       WHERE a.organization_id = o.id AND a.action = 'org_updated' AND a.actor_id = $2) AS audits
                FROM organizations o WHERE o.id = $1`,
        params: [r.orgA, r.platformOwnerUserId],
        expect: (rows) => {
          const row = rows[0];
          if (!row) return 'org A not found on read-back';
          if (row.name !== ORG_WRITE_NAME_MARKER) return `name is ${JSON.stringify(row.name)}, expected the marker`;
          if (Number(row.audits) < 1) return 'no org_updated audit row attributed to the platform owner';
          return null;
        },
      }),
      // rbac-deny (org_admin): the gate must refuse BEFORE the transaction, so no audit row may carry
      // the denied user as actor. Asserting on the audit rather than the name is deliberate — the name
      // is already the marker from the allow case, so it could not distinguish a leak.
      readbackNoMutation: (r) => ({
        sql: `SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1 AND actor_id = $2`,
        params: [r.orgA, r.orgAdminUserId],
        expect: (rows) =>
          Number(rows[0]?.n) === 0 ? null : `a forbidden update by org_admin still wrote ${rows[0]?.n} audit row(s)`,
      }),
    },
    {
      name: 'suspend',
      method: 'POST',
      // `suspend: false` — ACTIVATE. See the surface comment: suspending org A would break every
      // other surface's authentication.
      buildParity: (r) => ({ path: `/platform/organizations/${r.orgA}/suspend`, body: { suspend: false } }),
      expectedByRole: { platform_owner: 'allow', org_admin: 'deny' },
      rbacDenyStatus: 403,
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        if (o.isActive !== true) return `expected isActive true after activate, got ${JSON.stringify(o.isActive)}`;
        return null;
      },
      readbackMutated: (r) => ({
        sql: `SELECT o.is_active,
                     (SELECT count(*)::int FROM audit_logs a
                       WHERE a.organization_id = o.id AND a.action = 'org_activated' AND a.actor_id = $2) AS audits
                FROM organizations o WHERE o.id = $1`,
        params: [r.orgA, r.platformOwnerUserId],
        expect: (rows) => {
          const row = rows[0];
          if (!row) return 'org A not found on read-back';
          if (row.is_active !== true) return `is_active is ${JSON.stringify(row.is_active)}, expected true`;
          // The action name is the ONLY thing distinguishing activate from suspend — TS picks it from
          // the flag (organizations.ts:313) and so must C#.
          if (Number(row.audits) < 1) return 'no org_activated audit row attributed to the platform owner';
          return null;
        },
      }),
      readbackNoMutation: (r) => ({
        sql: `SELECT count(*)::int AS n FROM audit_logs
               WHERE organization_id = $1 AND actor_id = $2 AND action IN ('org_suspended', 'org_activated')`,
        params: [r.orgA, r.orgAdminUserId],
        expect: (rows) =>
          Number(rows[0]?.n) === 0 ? null : `a forbidden suspend by org_admin still wrote ${rows[0]?.n} audit row(s)`,
      }),
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// platform organizations CREATE — Platform__PlatformOrganizationsCreateEnabled (1 write)
// ─────────────────────────────────────────────────────────────────────────────
/** Concrete ids for the platform-organizations CREATE surface (seed.ts). No `orgA`: the org this
 *  surface writes is manufactured by the call, not addressed by it. */
export interface PlatformOrganizationsCreateResolved extends WriteResolvedBase {
  /** org-A `org_admin` user id — the denied role. */
  orgAdminUserId: string;
  /** the seeded platform owner — the actor the `org_created` audit row must be attributed to. */
  platformOwnerUserId: string;
}

// Registered 2026-08-11, resolving #208. A SEPARATE surface key from `organization` above, for two
// independently sufficient reasons — appending a third endpoint there would be wrong on both counts:
//
//  1. `WriteSurface.flag` is a single string, and create ships behind its OWN flag
//     `Platform__PlatformOrganizationsCreateEnabled`, deliberately not the write flag: "riding the
//     update flag would make one canary decision cover two wildly different blast radii"
//     (PlatformOptions.cs:469-472). One surface cannot declare two flags.
//  2. The mounted-route preflight probes `surface.endpoints[0]` ONLY (cli.ts:452-459). Appended here,
//     the preflight would keep probing `update` and never check Create's flag at all — the exact
//     false-green that preflight exists to prevent.
//
// WHY REGISTERING IT IS SAFE ENOUGH TO DO (#208 was filed asking precisely this):
//
//  - BLAST RADIUS IS ONE CREATE PER RUN. The probe is the only 'allow' role and `allowRolesLiveTestable`
//    is unset, so runWriteRbac (checks/writes.ts:145) skips every non-probe allow. Per run: 1
//    organizations, 1 companies, 1 business_units, 1 teams, 7 org_entitlements (ATS_BASE_MODULES),
//    1 roles, 1 subscriptions, 1 audit_logs, and 1 notifications per real platform owner.
//  - IT IS A DIFFERENCE OF DEGREE, NOT KIND, ON ROWS. `compensation` already inserts 2
//    salary_adjustments per run with no start-of-run cleanup, and `access-review` inserts an
//    access_reviews row per run behind an explicitly no-op ensurePreconditions. Registered writes
//    already leave rows behind; this one leaves more of them.
//  - IT IS A DIFFERENCE OF KIND ON SCOPE, and that part is closed. `teardown` resolves everything it
//    deletes from `organizations WHERE slug = ANY(...)`, so a NEW TENANT would be outside every
//    existing sweep. `WRITE_ORG_CREATE_SLUG` is now in that slug list, and
//    `ensurePlatformOrganizationsCreatePreconditions` deletes the prior run's org before each run.
//  - WITHOUT REGISTRATION SLICE 21 HAS NO STEP-5 VERIFICATION PATH AT ALL — the same argument
//    surfaces.ts:206-210 already makes for the read side ("not Federico-gated but UNRUNNABLE BY ANYONE").
//
// THE ONE RESIDUAL FEDERICO SHOULD KNOW ABOUT, because it cannot be engineered away: the platform-owner
// notify fan-out is UNCONDITIONAL in both stacks (organizations.ts:220 has no branch and no catch;
// PlatformOwnerNotifier queries an unfiltered `WHERE is_platform_owner`). Every run therefore puts one
// "Nueva organizacion creada: …" notification in every REAL platform owner's bell. The cleanup deletes
// them on the next run; it cannot prevent them. This is the same cost the `organization` surface above
// deliberately AVOIDED by sending `{ suspend: false }` — create has no equivalent lever. Judged worth it
// against a domain that is otherwise unverifiable by anyone; veto by deleting this surface and replacing
// it with the omission comment #208 describes.
//
// Second, smaller residual: the LAST run's org persists until the next run's ensurePreconditions or an
// explicit `seed --teardown` — one marker org at the top of /platform/organizations (listOrganizations
// applies no exclusion filter and orders createdAt desc) and +1 on the KPI tile. Bounded at exactly one;
// it never accumulates.
//
// A NOTE ON THAT ESCAPE HATCH, because the argument above leans on it. When this surface was first
// registered, `seed --teardown` was BROKEN in the common case: it never deleted `access_reviews`, whose
// `reviewer_id` FK is ON DELETE RESTRICT and points at `parity+a-platform_owner@tims.test`, so after any
// `verify-write access-review` run the users delete threw and teardown aborted BEFORE the organizations
// delete — leaving a half-swept database and the marker org intact. Fixed in the same change that this
// note ships with (seed.ts's teardown now deletes `access_reviews` before the users delete). Stated here
// rather than only in the issue, because "run `seed --teardown`" is the mitigation this surface's
// registration was approved on, and a mitigation that throws is not one.
const platformOrganizationsCreateSurface: WriteSurface<PlatformOrganizationsCreateResolved> = {
  key: 'organization-create',
  // NOT PlatformOrganizationsWriteEnabled — see reason 1 above (PlatformOptions.cs:463-490).
  flag: 'Platform__PlatformOrganizationsCreateEnabled',
  probeRole: 'platform_owner',
  roles: ['platform_owner', 'org_admin'],
  ensurePreconditions: ensurePlatformOrganizationsCreatePreconditions,
  resolveResources: resolvePlatformOrganizationsCreateResources,
  endpoints: [
    {
      name: 'create',
      method: 'POST',
      // Fixed body: the slug is `@unique`, so it must be the marker the cleanup keys on. `plan: 'trial'`
      // is the cheapest branch (subscriptions.status = 'trialing', trial_ends_at set) and exercises the
      // same seven-table transaction as any other plan.
      buildParity: () => ({
        path: '/platform/organizations',
        body: {
          name: WRITE_ORG_CREATE_NAME,
          slug: WRITE_ORG_CREATE_SLUG,
          plan: 'trial',
          adminEmail: 'parity+create@tims.test',
        },
      }),
      // no buildIdor: a plain create has no cross-org target — the org is MANUFACTURED by the call, not
      // addressed by it, so there is no org-B resource to aim at. Reported N/A per the documented rule
      // at :97-99 (same disposition as createCycle and access-review attest).
      expectedByRole: { platform_owner: 'allow', org_admin: 'deny' },
      // PlatformOwnerGate refuses org_admin BEFORE any body parse, so this 403 is gate-level.
      rbacDenyStatus: 403,
      expectResponse: (b) => {
        const o = asObj(b);
        if (!o) return 'response is not an object';
        if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return `expected a uuid id, got ${JSON.stringify(o.id)}`;
        if (o.name !== WRITE_ORG_CREATE_NAME)
          return `expected name ${WRITE_ORG_CREATE_NAME}, got ${JSON.stringify(o.name)}`;
        if (o.slug !== WRITE_ORG_CREATE_SLUG)
          return `expected slug ${WRITE_ORG_CREATE_SLUG}, got ${JSON.stringify(o.slug)}`;
        return null;
      },
      // THE SEVEN-TABLE TRANSACTION, not just the organizations row. The entitlement bundle, the default
      // Company/BusinessUnit/Team chain and the fail-closed audit row are the half a response-shape
      // assertion cannot see — and they are where a provisioning port actually diverges.
      readbackMutated: (r) => ({
        sql: `SELECT o.id, o.is_active,
                     (SELECT count(*)::int FROM companies       c WHERE c.organization_id = o.id) AS companies,
                     (SELECT count(*)::int FROM business_units  b WHERE b.organization_id = o.id) AS units,
                     (SELECT count(*)::int FROM teams           t WHERE t.organization_id = o.id) AS teams,
                     (SELECT count(*)::int FROM org_entitlements e WHERE e.organization_id = o.id) AS entitlements,
                     (SELECT count(*)::int FROM roles           rl WHERE rl.organization_id = o.id) AS roles,
                     (SELECT count(*)::int FROM subscriptions   s WHERE s.organization_id = o.id) AS subs,
                     (SELECT count(*)::int FROM audit_logs      a
                       WHERE a.organization_id = o.id AND a.action = 'org_created' AND a.actor_id = $2) AS audits,
                     (SELECT count(*)::int FROM plan_modules   pm WHERE pm.plan_code = 'ats-base') AS ats_base_modules
                FROM organizations o WHERE o.slug = $1`,
        params: [WRITE_ORG_CREATE_SLUG, r.platformOwnerUserId],
        expect: (rows) => {
          const row = rows[0];
          if (!row) return `no organization with slug '${WRITE_ORG_CREATE_SLUG}' after a 200 create`;
          if (row.is_active !== true)
            return `is_active is ${JSON.stringify(row.is_active)}, expected the DB default true`;
          // ENTITLEMENTS ARE DB-DERIVED, NOT CODE-DERIVED. `provisionOrgEntitlements`
          // (org-provisioning.ts) does `planModule.findMany({ where: { planCode: 'ats-base' } })` and
          // inserts ONE row per result; the C# counterpart runs the same query, and
          // PlatformOrganizationsCreateRepository.cs documents that N = 0 is a valid outcome that
          // commits. So the expected count is whatever `plan_modules` holds for `ats-base` in the
          // TARGET database — 7 on a seeded one (ATS_BASE_MODULES, seed-entitlements.ts), but that
          // constant is read only by the SEED, never by either create path.
          //
          // This was hard-coded `entitlements: 7` with a comment attributing it to a constant no
          // runtime path reads. Against an unseeded or edited catalogue, the C# create would succeed
          // exactly as designed and the harness would print a red write-parity line saying "expected 7
          // entitlements" — a fixture failure a reader would attribute to a port divergence. Deriving
          // it in the same query makes the assertion mean what its comment claims: one entitlement row
          // per ats-base plan module, no more and no fewer.
          const atsBaseModules = Number(row.ats_base_modules);
          // NON-VACUITY. A derived expectation of 0 would make the entitlement assertion pass against a
          // create that granted nothing, which is exactly the silence this read-back exists to break.
          // An unseeded catalogue is an ENVIRONMENT fault, so say that rather than tick green.
          if (atsBaseModules === 0)
            return "plan_modules has no 'ats-base' rows, so the entitlement read-back would prove nothing — seed the entitlement catalogue (packages/db/prisma/seed-entitlements.ts) before running this surface";
          const want: Record<string, number> = {
            companies: 1,
            units: 1,
            teams: 1,
            entitlements: atsBaseModules,
            roles: 1,
            subs: 1,
          };
          for (const [k, n] of Object.entries(want)) {
            if (Number(row[k]) !== n)
              return `expected ${n} ${k} row(s) for the created org, got ${JSON.stringify(row[k])}`;
          }
          // Fail-closed in C# (inside the transaction), best-effort in TS — either way a committed org
          // with no audit row is the divergence #76 cares about.
          if (Number(row.audits) < 1) return 'no org_created audit row attributed to the platform owner';
          return null;
        },
      }),
      // `organizations` has no caller-stamped column, so the deny proof keys on the row's ABSENCE.
      // ORDERING DEPENDENCY: cmdVerifyWrite runs idor → extraProbes → rbac → parity (cli.ts:470-477),
      // so the deny runs BEFORE the allow-path create and "0 rows" is correct. If that order ever
      // changes, this assertion inverts — the allow-path row would then already exist and a genuine
      // leak would be indistinguishable from it.
      readbackNoMutation: () => ({
        sql: `SELECT count(*)::int AS n FROM organizations WHERE slug = $1`,
        params: [WRITE_ORG_CREATE_SLUG],
        expect: (rows) =>
          Number(rows[0]?.n) === 0
            ? null
            : `a forbidden create by org_admin still produced ${rows[0]?.n} organization row(s)`,
      }),
    },
  ],
};

export const WRITE_SURFACES: Record<string, AnyWriteSurface> = {
  compensation: defineWriteSurface(compensationSurface),
  evaluation360: defineWriteSurface(evaluation360Surface),
  succession: defineWriteSurface(successionSurface),
  engagement: defineWriteSurface(engagementSurface),
  ninebox: defineWriteSurface(nineboxSurface),
  'access-review': defineWriteSurface(accessReviewSurface),
  organization: defineWriteSurface(platformOrganizationsSurface),
  'organization-create': defineWriteSurface(platformOrganizationsCreateSurface),
};

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
  WRITE_EVAL_CYCLES,
  WRITE_CYCLE_MARKER,
} from './seed';

// Re-export the write-verify cycle fixtures (defined in seed.ts to keep the seed→registry
// import one-directional) so consumers/tests can reference them from the registry too.
export { WRITE_EVAL_CYCLES, WRITE_CYCLE_MARKER };

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

export interface WriteEndpointDef<R extends WriteResolvedBase = WriteResolvedBase> {
  name: string;
  method: 'POST' | 'PATCH';
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
            if (row.id !== respId) return `response id ${JSON.stringify(respId)} != the created row id ${row.id} (stale/wrong id echoed?)`;
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
          expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden create still inserted ${rows[0]?.n} row(s)`),
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
          if (Number(row.current_salary) !== 66000) return `employee_compensations.current_salary ${row.current_salary} != 66000 (tx side effect missing)`;
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
            if (rows[0].status !== 'pending') return `a forbidden approve mutated the adjustment → status ${rows[0].status}`;
            if (rows[0].approved_by_id !== null) return `a forbidden approve set approved_by_id`;
            if (Number(rows[0].current_salary) !== 60000) return `a forbidden approve LEAKED into employee_compensations.current_salary = ${rows[0].current_salary} (expected unchanged 60000)`;
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
  'leadership', 'communication', 'collaboration', 'execution', 'adaptability', 'integrity',
] as const;

const sixRatings = () =>
  EVAL360_COMPETENCIES.map((competencyKey) => ({ competencyKey, rating: 3, comment: 'parity' }));

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
      if (rows[0].status !== toStatus) return `cycle status ${rows[0].status} != ${toStatus} (transition did not apply)`;
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
        if (rows[0].status !== fromStatus) return `a forbidden ${verb} mutated the cycle → status ${rows[0].status} (expected ${fromStatus})`;
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
        if (o.name !== WRITE_CYCLE_MARKER) return `expected name ${JSON.stringify(WRITE_CYCLE_MARKER)}, got ${JSON.stringify(o.name)}`;
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
            if (rows[0].id !== respId) return `response id ${JSON.stringify(respId)} != created cycle id ${rows[0].id} (stale/wrong id echoed?)`;
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
        expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden createCycle still inserted ${rows[0]?.n} cycle(s)`),
      }),
    },

    // ── open / close / publish — guarded state transitions (cross-org → 409). ───────────
    transitionEndpoint('open-cycle', 'open', WRITE_EVAL_CYCLES.draftA, WRITE_EVAL_CYCLES.draftB, 'draft', 'open'),
    transitionEndpoint('close-cycle', 'close', WRITE_EVAL_CYCLES.openA, WRITE_EVAL_CYCLES.openB, 'open', 'closed'),
    transitionEndpoint('publish-cycle', 'publish', WRITE_EVAL_CYCLES.closedA, WRITE_EVAL_CYCLES.closedB, 'closed', 'published'),

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
        expect: (rows) => (Number(rows[0]?.n) === 1 ? null : `assignRaters did not create the assignment (found ${rows[0]?.n})`),
      }),
      // Denied assign (IDOR org-B cycle, or rbac-deny before the probe inserted): no assignment
      // exists for that (cycle, subject, rater).
      readbackNoMutation: (r, target) => {
        const cycleId = target === 'b' ? WRITE_EVAL_CYCLES.assignB : WRITE_EVAL_CYCLES.assignA;
        return {
          sql: `SELECT count(*)::int AS n FROM rater_assignments
                WHERE cycle_id = $1 AND subject_user_id = $2 AND rater_user_id = $3`,
          params: [cycleId, r.subjectA, r.userIdByRole.hrbp],
          expect: (rows) => (Number(rows[0]?.n) === 0 ? null : `a forbidden assignRaters still inserted ${rows[0]?.n} assignment(s)`),
        };
      },
    },

    // ── submitRatings — IDENTITY-anchored; non-owner (any role) or cross-org → 404. ─────
    {
      name: 'submit-ratings',
      method: 'POST',
      buildParity: (r) => ({ path: `/evaluation360/assignments/${enc(r.submitAssignA)}/ratings`, body: { ratings: sixRatings() } }),
      // cross-org: org-A super → an org-B assignment id → the ownership pre-fetch {id, org=A,
      // rater=super_a} finds nothing → 404 (id/org/rater mismatch is indistinguishable from outside).
      buildIdor: (r) => ({ path: `/evaluation360/assignments/${enc(r.submitAssignB)}/ratings`, body: { ratings: sixRatings() } }),
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
            if (rows[0].status !== 'pending') return `a forbidden submit mutated the assignment → status ${rows[0].status}`;
            if (Number(rows[0].n) !== 0) return `a forbidden submit wrote ${rows[0].n} forged response(s)`;
            return null;
          },
        };
      },
    },
  ],
};

export const WRITE_SURFACES: Record<string, AnyWriteSurface> = {
  compensation: defineWriteSurface(compensationSurface),
  evaluation360: defineWriteSurface(evaluation360Surface),
};

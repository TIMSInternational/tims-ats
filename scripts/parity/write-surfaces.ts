/**
 * Write-surface registry — the write analog of `SURFACES` (surfaces.ts). Each
 * WriteEndpointDef drives the three write checks (checks/writes.ts): light parity
 * (the single mutating happy-path), write-IDOR (org-A → org-B, denied + no mutation),
 * and write-RBAC-deny (deny role → 403 + no mutation). Assertions run against the DB
 * via an injected read-back, so the goldens are code-grounded in the actual rows.
 * See docs/superpowers/specs/2026-07-24-write-verification-harness-design.md.
 */

/** A deterministic Z-anchored effective date for create bodies (the C# validator
 *  requires a strict Zulu ISO-8601 timestamp; a fixed value keeps runs reproducible). */
export const EFFECTIVE_DATE = '2026-01-15T00:00:00.000Z';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;

export type Row = Record<string, unknown>;

/** Concrete ids resolved from the seeded DB (seed.ts `resolveWriteResources`). */
export interface WriteResolved {
  base: string;
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

export interface WriteReadback {
  sql: string;
  params: unknown[];
  /** Returns a failure detail string, or null when the rows match the golden. */
  expect: (rows: Row[]) => string | null;
}

export interface WriteEndpointDef {
  name: string;
  method: 'POST' | 'PATCH';
  /** org-A happy-path (probe light-parity + rbac-deny both use this path/body). */
  buildParity: (r: WriteResolved) => { path: string; body: unknown };
  /** cross-org IDOR probe (org-A token → an org-B resource/subject). */
  buildIdor: (r: WriteResolved) => { path: string; body: unknown };
  /** 200 = allow (the probe proves it via light-parity), 403 = deny (run live, no mutation). */
  expectedByRole: Record<string, 200 | 403>;
  /** light-parity: validate the success (200) response body shape. */
  expectResponse: (respBody: unknown) => string | null;
  /** light-parity: read back the created/mutated row(s) and assert the golden. */
  readbackMutated: (r: WriteResolved, respBody: unknown) => WriteReadback;
  /** after a DENIED write, assert the target was NOT mutated. `target` selects org A/B;
   *  `denierRole` (rbac-deny only) identifies who was (correctly) refused. */
  readbackNoMutation: (r: WriteResolved, target: 'a' | 'b', denierRole?: string) => WriteReadback;
  /** True when the ALLOW (200) roles can be exercised live without consuming a shared
   *  precondition — i.e. an unconditional CREATE, where each allow role inserts its own
   *  row. For state transitions (approve/activate/…) leave false: only the probe transitions
   *  the single precondition (a 2nd allow role would need its own fixture — a rollout item),
   *  so those are deny-side + probe only. When true, `readbackAllow` MUST be provided. */
  allowRolesLiveTestable?: boolean;
  /** read-back proving the ALLOW role (not the probe) actually performed the write with its
   *  own grant — used only when `allowRolesLiveTestable`. */
  readbackAllow?: (r: WriteResolved, role: string, respBody: unknown) => WriteReadback;
}

export interface WriteSurface {
  key: string;
  flag: string;
  probeRole: string;
  roles: string[];
  endpoints: WriteEndpointDef[];
}

const asObj = (b: unknown): Record<string, unknown> | null =>
  b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;

const compensationBody = (userId: string) => ({
  userId,
  type: 'merit',
  previousSalary: 60000,
  newSalary: 66000,
  currency: 'USD',
  reason: 'parity',
  effectiveDate: EFFECTIVE_DATE,
});

export const WRITE_SURFACES: Record<string, WriteSurface> = {
  // ── compensation (tracer) ──────────────────────────────────────────────────────────────────
  // 2 writes under ONE flag Platform__CompensationWriteEnabled (Program.cs). createAdjustment =
  // permissionProcedure('compensation','create') + assertSubjectInScope (out-of-org subject → 403);
  // approveAdjustment = permissionProcedure('compensation','approve') + assertScoped IDOR (out-of-org
  // id → 404). super/hr_admin allow, hrbp denied (no create/approve grant). Approve runs a tx:
  // salary_adjustments.status pending→approved (+ approved_by_id) AND employee_compensations.current_salary
  // = new_salary for the subject.
  compensation: {
    key: 'compensation',
    flag: 'Platform__CompensationWriteEnabled',
    probeRole: 'super_admin',
    roles: ['super_admin', 'hr_admin', 'hrbp'],
    endpoints: [
      {
        name: 'create-adjustment',
        method: 'POST',
        buildParity: (r) => ({ path: '/compensation/adjustments', body: compensationBody(r.subjectA) }),
        // cross-org: create an adjustment FOR an org-B user → subject out of org-A scope → 403.
        buildIdor: (r) => ({ path: '/compensation/adjustments', body: compensationBody(r.subjectB) }),
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
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
        expectedByRole: { super_admin: 200, hr_admin: 200, hrbp: 403 },
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
  },
};

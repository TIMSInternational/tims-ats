import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';

// ── §21 +AUDIT coverage for the DSAR right-of-access export ──────────────────
// `exportSubjectData` is the only statutory-compliance surface in the product and
// until now had ZERO behavioural tests. It reads three CLASSIFICATION entities at
// confidential-or-above (employeeCompensation = restricted, employeeDemographics =
// confidential, assessmentResult = restricted headline / confidential here) and
// wrote no `data_access_logs` row for any of them — the only audit was a
// fail-OPEN `audit_logs` insert to a DIFFERENT table.
//
// These tests pin the behaviour, not the source text: a grep-only pin would tick
// green against a call that never runs.
//
// We mock `@tims/db` and `../trpc` (so `protectedProcedure` is a pass-through and
// the REAL `platformProcedure` owner gate still runs), and keep the REAL access
// barrel so the fail-closed/fail-soft policy is derived from the real registry.

const findMany = {
  user: vi.fn(),
  candidate: vi.fn(),
  application: vi.fn(),
  interview: vi.fn(),
  offer: vi.fn(),
  assessmentAssignment: vi.fn(),
  employeeDemographics: vi.fn(),
  employeeCompensation: vi.fn(),
};
const dataAccessCreateMany = vi.fn();
const auditLogCreate = vi.fn();
const loggerWarn = vi.fn();

vi.mock('@tims/db', () => ({
  db: {
    user: { findMany: (...a: unknown[]) => findMany.user(...a) },
    candidate: { findMany: (...a: unknown[]) => findMany.candidate(...a) },
    application: { findMany: (...a: unknown[]) => findMany.application(...a) },
    interview: { findMany: (...a: unknown[]) => findMany.interview(...a) },
    offer: { findMany: (...a: unknown[]) => findMany.offer(...a) },
    assessmentAssignment: { findMany: (...a: unknown[]) => findMany.assessmentAssignment(...a) },
    employeeDemographics: { findMany: (...a: unknown[]) => findMany.employeeDemographics(...a) },
    employeeCompensation: { findMany: (...a: unknown[]) => findMany.employeeCompensation(...a) },
    dataAccessLog: { createMany: (...a: unknown[]) => dataAccessCreateMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
  },
  // audit.ts binds to tenantDb at module load; never exercised on this path.
  tenantDb: {},
}));

vi.mock('@tims/shared', async () => {
  const actual = await vi.importActual<typeof import('@tims/shared')>('@tims/shared');
  return { ...actual, logger: { ...actual.logger, warn: (...a: unknown[]) => loggerWarn(...a) } };
});

vi.mock('../../packages/api/src/trpc', () => {
  const t = initTRPC
    .context<{
      user: { id: string; organizationId: string; isPlatformOwner: boolean; impersonatorId?: string | null };
      headers: Headers;
    }>()
    .create();
  return { router: t.router, protectedProcedure: t.procedure };
});

import { dataRequestsRouter } from '../../packages/api/src/routers/platform/data-requests';
import { dataClassOf } from '../../packages/api/src/access';

const t = initTRPC
  .context<{
    user: { id: string; organizationId: string; isPlatformOwner: boolean; impersonatorId?: string | null };
    headers: Headers;
  }>()
  .create();
const createCaller = t.createCallerFactory(
  dataRequestsRouter as unknown as Parameters<typeof t.createCallerFactory>[0],
);

interface DsarCaller {
  exportSubjectData(input: { email: string }): Promise<{ json: string; counts: Record<string, number> }>;
}

// The SUBJECT's org — deliberately different from the operator's, because that
// divergence is the whole reason this cannot go through tenantDb/logDataAccess.
const SUBJECT_ORG = '22222222-2222-4222-8222-222222222222';
const OPERATOR_ORG = '99999999-9999-4999-8999-999999999999';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_ID = '66666666-6666-4666-8666-666666666666';
const COMP_ID = '33333333-3333-4333-8333-333333333333';
const DEMO_ID = '44444444-4444-4444-8444-444444444444';
const RESULT_ID = '55555555-5555-4555-8555-555555555555';

const caller = (operatorOrg = OPERATOR_ORG, impersonatorId?: string) =>
  createCaller({
    user: { id: 'operator-1', organizationId: operatorOrg, isPlatformOwner: true, impersonatorId },
    headers: new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'jest-ua/1.0' }),
  }) as unknown as DsarCaller;

/** Rows returned by each mocked read. `sensitive: false` = no confidential+ rows. */
function seed(opts: { sensitive?: boolean } = {}) {
  const sensitive = opts.sensitive ?? true;
  findMany.user.mockResolvedValue([
    { id: USER_ID, email: 'a@b.com', firstName: 'A', lastName: 'B', organizationId: SUBJECT_ORG },
  ]);
  // A candidate row is required for the recruitment-side reads to run at all:
  // applications/interviews/offers/assessments are gated on `candidateIds.length`.
  findMany.candidate.mockResolvedValue([
    { id: CANDIDATE_ID, email: 'a@b.com', firstName: 'A', lastName: 'B', organizationId: SUBJECT_ORG },
  ]);
  findMany.application.mockResolvedValue([]);
  findMany.interview.mockResolvedValue([]);
  findMany.offer.mockResolvedValue([]);
  findMany.assessmentAssignment.mockResolvedValue(
    sensitive
      ? [{ id: 'asg-1', status: 'done', result: { id: RESULT_ID, organizationId: SUBJECT_ORG, normalizedScore: 71 } }]
      : [],
  );
  findMany.employeeDemographics.mockResolvedValue(
    sensitive ? [{ id: DEMO_ID, organizationId: SUBJECT_ORG, gender: 'female', dateOfBirth: null }] : [],
  );
  findMany.employeeCompensation.mockResolvedValue(
    sensitive ? [{ id: COMP_ID, organizationId: SUBJECT_ORG, currentSalary: 100, currency: 'COP' }] : [],
  );
}

/** All data_access_logs rows written, flattened across the per-entity createMany calls. */
function writtenRows(): Array<Record<string, unknown>> {
  return dataAccessCreateMany.mock.calls.flatMap((c) => (c[0] as { data: Array<Record<string, unknown>> }).data);
}

beforeEach(() => {
  vi.clearAllMocks();
  dataAccessCreateMany.mockResolvedValue({ count: 1 });
  auditLogCreate.mockResolvedValue({});
  seed();
});

describe('DSAR export — §21 data_access_logs rows', () => {
  it('writes one row per exposed sensitive record, for all three registered entities', async () => {
    await caller().exportSubjectData({ email: 'a@b.com' });
    const rows = writtenRows();
    expect(rows.map((r) => r.dataType).sort()).toEqual([
      'assessmentResult',
      'employeeCompensation',
      'employeeDemographics',
    ]);
  });

  it('keys each row to the RECORD’s org, never the operator’s', async () => {
    await caller(OPERATOR_ORG).exportSubjectData({ email: 'a@b.com' });
    const orgs = new Set(writtenRows().map((r) => r.organizationId));
    expect(orgs).toEqual(new Set([SUBJECT_ORG]));
    expect(orgs.has(OPERATOR_ORG)).toBe(false);
  });

  it('records the record id as recordId (a real uuid), not the email or the user id', async () => {
    await caller().exportSubjectData({ email: 'a@b.com' });
    const byType = Object.fromEntries(writtenRows().map((r) => [r.dataType, r.recordId]));
    expect(byType.employeeCompensation).toBe(COMP_ID);
    expect(byType.employeeDemographics).toBe(DEMO_ID);
    expect(byType.assessmentResult).toBe(RESULT_ID);
    expect(Object.values(byType)).not.toContain('a@b.com');
    expect(Object.values(byType)).not.toContain(USER_ID);
  });

  it('stamps action=export plus the caller ip / user-agent', async () => {
    await caller().exportSubjectData({ email: 'a@b.com' });
    for (const r of writtenRows()) {
      expect(r.action).toBe('export');
      expect(r.ipAddress).toBe('203.0.113.7');
      expect(r.userAgent).toBe('jest-ua/1.0');
    }
  });

  it('attributes to the impersonator when the session is impersonating', async () => {
    await caller(OPERATOR_ORG, 'real-admin-9').exportSubjectData({ email: 'a@b.com' });
    for (const r of writtenRows()) expect(r.actorId).toBe('real-admin-9');
  });

  it('writes nothing when the subject has no confidential-or-above records', async () => {
    seed({ sensitive: false });
    await caller().exportSubjectData({ email: 'a@b.com' });
    expect(dataAccessCreateMany).not.toHaveBeenCalled();
  });
});

describe('DSAR export — failure policy is derived from the classification registry', () => {
  /** Reject only the createMany carrying `dataType`; resolve every other entity. */
  const failOnly = (dataType: string) =>
    dataAccessCreateMany.mockImplementation((args: { data: Array<{ dataType: string }> }) =>
      args.data[0]?.dataType === dataType
        ? Promise.reject(new Error('audit write failed'))
        : Promise.resolve({ count: args.data.length }),
    );

  it('employeeCompensation is restricted → fail-CLOSED: the export aborts and returns no data', async () => {
    failOnly('employeeCompensation');
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toBeInstanceOf(TRPCError);
  });

  it('employeeDemographics is confidential → fail-SOFT: the export still returns', async () => {
    failOnly('employeeDemographics');
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    expect(out.counts.demographics).toBe(1);
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('assessmentResult is fail-SOFT here via the documented mixed-class override', async () => {
    // Headline dataClass is `restricted` (raw psychometrics), so without the
    // explicit `{ failClosed: false }` this would abort — the bundle exposes only
    // the confidential `normalizedScore`.
    expect(dataClassOf('assessmentResult')).toBe('restricted');
    failOnly('assessmentResult');
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    expect(out.counts.assessments).toBe(1);
  });

  it('the registry entries the policy is derived from still exist', () => {
    // dataClassOf() falls back to 'internal' for an UNREGISTERED entity, so deleting
    // either entry would silently downgrade compensation from fail-closed to
    // fail-soft with no tsc error and no runtime warning. This is that tripwire.
    expect(dataClassOf('employeeCompensation')).toBe('restricted');
    expect(dataClassOf('employeeDemographics')).toBe('confidential');
  });
});

describe('DSAR export — the §21 rows do not replace the export-event audit', () => {
  it('still writes the data_subject_export audit_logs row, keyed to the subject org', async () => {
    await caller().exportSubjectData({ email: 'a@b.com' });
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const arg = auditLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data.action).toBe('data_subject_export');
    expect(arg.data.organizationId).toBe(SUBJECT_ORG);
  });

  it('the §21 write happens BEFORE the export-event row, so a fail-closed abort leaves no false receipt', async () => {
    dataAccessCreateMany.mockRejectedValue(new Error('audit write failed'));
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toBeInstanceOf(TRPCError);
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});

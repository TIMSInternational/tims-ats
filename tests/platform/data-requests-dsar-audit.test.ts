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
  assessmentConsent: vi.fn(),
  proctoringSession: vi.fn(),
  proctoringEvent: vi.fn(),
  proctoringEvidence: vi.fn(),
  proctoringFinding: vi.fn(),
  proctoringCandidateExplanation: vi.fn(),
  employeeDemographics: vi.fn(),
  employeeCompensation: vi.fn(),
};
const dataAccessCreateMany = vi.fn();
const auditLogCreate = vi.fn();
const loggerWarn = vi.fn();
const queryRaw = vi.fn();
const transaction = vi.fn(async (callback: (tx: { dataAccessLog: { createMany: typeof dataAccessCreateMany } }) => Promise<unknown>) =>
  callback({ dataAccessLog: { createMany: dataAccessCreateMany } }));

vi.mock('@tims/db', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
    join: (parts: unknown[]) => ({ parts }),
  },
  db: {
    user: { findMany: (...a: unknown[]) => findMany.user(...a) },
    candidate: { findMany: (...a: unknown[]) => findMany.candidate(...a) },
    application: { findMany: (...a: unknown[]) => findMany.application(...a) },
    interview: { findMany: (...a: unknown[]) => findMany.interview(...a) },
    offer: { findMany: (...a: unknown[]) => findMany.offer(...a) },
    assessmentAssignment: { findMany: (...a: unknown[]) => findMany.assessmentAssignment(...a) },
    assessmentConsent: { findMany: (...a: unknown[]) => findMany.assessmentConsent(...a) },
    proctoringSession: { findMany: (...a: unknown[]) => findMany.proctoringSession(...a) },
    proctoringEvent: { findMany: (...a: unknown[]) => findMany.proctoringEvent(...a) },
    proctoringEvidence: { findMany: (...a: unknown[]) => findMany.proctoringEvidence(...a) },
    proctoringFinding: { findMany: (...a: unknown[]) => findMany.proctoringFinding(...a) },
    proctoringCandidateExplanation: { findMany: (...a: unknown[]) => findMany.proctoringCandidateExplanation(...a) },
    employeeDemographics: { findMany: (...a: unknown[]) => findMany.employeeDemographics(...a) },
    employeeCompensation: { findMany: (...a: unknown[]) => findMany.employeeCompensation(...a) },
    dataAccessLog: { createMany: (...a: unknown[]) => dataAccessCreateMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditLogCreate(...a) },
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    $transaction: (...a: unknown[]) => transaction(a[0] as Parameters<typeof transaction>[0]),
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
      ? [{ id: 'asg-1', candidateId: CANDIDATE_ID, organizationId: SUBJECT_ORG, status: 'done', result: { id: RESULT_ID, organizationId: SUBJECT_ORG, normalizedScore: 71 } }]
      : [],
  );
  findMany.assessmentConsent.mockResolvedValue([]);
  findMany.proctoringSession.mockResolvedValue([]);
  findMany.proctoringEvent.mockResolvedValue([]);
  findMany.proctoringEvidence.mockResolvedValue([]);
  findMany.proctoringFinding.mockResolvedValue([]);
  findMany.proctoringCandidateExplanation.mockResolvedValue([]);
  queryRaw.mockResolvedValue([]);
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

describe('DSAR export — cases the first round of these tests did not cover', () => {
  it('keys rows per-record when one subject spans TWO orgs — the reason logDataAccess cannot be used', async () => {
    // A user in org A and a same-email candidate in org B is reachable, and it is
    // the entire justification for writing through the privileged client with an
    // explicit per-row org. A single-org fixture cannot prove it.
    const ORG_B = '77777777-7777-4777-8777-777777777777';
    findMany.employeeCompensation.mockResolvedValue([
      { id: COMP_ID, organizationId: SUBJECT_ORG, currentSalary: 100 },
      { id: '88888888-8888-4888-8888-888888888888', organizationId: ORG_B, currentSalary: 200 },
    ]);
    await caller().exportSubjectData({ email: 'a@b.com' });
    const comp = writtenRows().filter((r) => r.dataType === 'employeeCompensation');
    expect(comp).toHaveLength(2);
    expect(new Set(comp.map((r) => r.organizationId))).toEqual(new Set([SUBJECT_ORG, ORG_B]));
  });

  it('audits a candidate-only subject (no User row) — the common ATS case', async () => {
    findMany.user.mockResolvedValue([]);
    findMany.employeeDemographics.mockResolvedValue([]);
    findMany.employeeCompensation.mockResolvedValue([]);
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    expect(out.counts.candidates).toBe(1);
    // The user-side reads are skipped entirely, so only the assessment result remains.
    expect(writtenRows().map((r) => r.dataType)).toEqual(['assessmentResult']);
  });

  it('writes no assessmentResult row for an assignment that was never completed', async () => {
    findMany.assessmentAssignment.mockResolvedValue([
      { id: 'asg-1', candidateId: CANDIDATE_ID, organizationId: SUBJECT_ORG, status: 'pending', result: null },
      { id: 'asg-2', candidateId: CANDIDATE_ID, organizationId: SUBJECT_ORG, status: 'done', result: { id: RESULT_ID, organizationId: SUBJECT_ORG, normalizedScore: 71 } },
    ]);
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    expect(out.counts.assessments).toBe(2);
    expect(writtenRows().filter((r) => r.dataType === 'assessmentResult')).toHaveLength(1);
  });

  it('rejects a non-platform-owner — the owner gate this harness keeps real', async () => {
    const outsider = createCaller({
      user: { id: 'staff-1', organizationId: SUBJECT_ORG, isPlatformOwner: false },
      headers: new Headers(),
    }) as unknown as DsarCaller;
    await expect(outsider.exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(dataAccessCreateMany).not.toHaveBeenCalled();
  });

  it('derives ipAddress from the LAST x-forwarded-for hop, not the attacker-chosen first', async () => {
    const c = createCaller({
      user: { id: 'operator-1', organizationId: OPERATOR_ORG, isPlatformOwner: true },
      headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.9' }),
    }) as unknown as DsarCaller;
    await c.exportSubjectData({ email: 'a@b.com' });
    for (const r of writtenRows()) expect(r.ipAddress).toBe('10.0.0.9');
  });

  it('prefers x-real-ip over x-forwarded-for entirely', async () => {
    const c = createCaller({
      user: { id: 'operator-1', organizationId: OPERATOR_ORG, isPlatformOwner: true },
      headers: new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.9' }),
    }) as unknown as DsarCaller;
    await c.exportSubjectData({ email: 'a@b.com' });
    for (const r of writtenRows()) expect(r.ipAddress).toBe('10.0.0.9');
  });
});

describe('DSAR export — a fail-closed abort must leave no residue', () => {
  it('writes NO fail-soft rows when the fail-closed compensation audit fails', async () => {
    // data_access_logs is append-only (BEFORE DELETE OR UPDATE trigger), so a row
    // written before the abort can never be corrected. Concurrent writes would leave
    // permanent rows asserting an export that in fact threw and returned nothing.
    dataAccessCreateMany.mockImplementation((args: { data: Array<{ dataType: string }> }) =>
      args.data[0]?.dataType === 'employeeCompensation'
        ? Promise.reject(new Error('audit write failed'))
        : Promise.resolve({ count: args.data.length }),
    );
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toBeInstanceOf(TRPCError);
    expect(writtenRows().filter((r) => r.dataType !== 'employeeCompensation')).toHaveLength(0);
  });

  it('aborts with INTERNAL_SERVER_ERROR, not a code the UI echoes to the browser', async () => {
    // data-requests.tsx surfaces NOT_FOUND messages verbatim; anything else is
    // collapsed to generic copy. A drift to NOT_FOUND would leak internals.
    dataAccessCreateMany.mockRejectedValue(new Error('audit write failed'));
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('DSAR export — the bundle shape is pinned', () => {
  it('exposes exactly the documented key set per section', async () => {
    // The product's only statutory-disclosure surface. Nothing pinned the bundle
    // before, so a future select adding an SSN or password column was caught by
    // zero tests.
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const bundle = JSON.parse(out.json);
    expect(Object.keys(bundle).sort()).toEqual(['generatedAt', 'hr', 'identity', 'proctoring', 'recruitment', 'subject']);
    expect(Object.keys(bundle.identity).sort()).toEqual(['candidates', 'users']);
    expect(Object.keys(bundle.recruitment).sort()).toEqual(['applications', 'assessments', 'interviews', 'offers']);
    expect(Object.keys(bundle.hr).sort()).toEqual(['compensation', 'demographics']);
    expect(Object.keys(bundle.proctoring).sort()).toEqual([
      'assessmentConsents', 'events', 'evidence', 'explanations', 'findings', 'legacyEventsJsonIncluded', 'limits',
      'manualAccessNotice', 'manualAccessRequired', 'physicalMediaIncluded',
      'physicalMediaManualAccessRequired', 'sessions', 'truncated',
    ]);
    expect(bundle.recruitment.assessments[0]).not.toHaveProperty('candidateId');
    expect(bundle.recruitment.assessments[0]).not.toHaveProperty('organizationId');
    expect(bundle.subject).toBe('a@b.com');
  });
});

describe('DSAR export — proctoring metadata', () => {
  const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const CONSENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const EVIDENCE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const FINDING_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const EXPLANATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('scopes every privileged read through matched assignment and organization IDs', async () => {
    // A corrupted cross-org assignment must never become a proctoring scope.
    findMany.assessmentAssignment.mockResolvedValue([
      { id: 'asg-good', candidateId: CANDIDATE_ID, organizationId: SUBJECT_ORG, result: null },
      { id: 'asg-wrong-org', candidateId: CANDIDATE_ID, organizationId: OPERATOR_ORG, result: null },
    ]);
    await caller().exportSubjectData({ email: 'a@b.com' });

    for (const table of [findMany.assessmentConsent, findMany.proctoringSession]) {
      const query = table.mock.calls[0][0] as { where: { OR: unknown[] }; select: Record<string, boolean>; take: number };
      const expectedScope: Record<string, unknown> = {
        organizationId: SUBJECT_ORG,
        assignmentId: { in: ['asg-good'] },
      };
      if (table === findMany.assessmentConsent) expectedScope.candidateId = { in: [CANDIDATE_ID] };
      expect(query.where.OR).toEqual([expectedScope]);
      expect(query.select.id).toBe(true);
      expect(query.select.organizationId).toBe(true);
      expect(query.take).toBeGreaterThan(1);
    }
    const eventQuery = findMany.proctoringEvent.mock.calls[0][0] as {
      where: { OR: unknown[] }; select: Record<string, boolean>; take: number;
    };
    expect(eventQuery.where.OR).toEqual([{
      organizationId: SUBJECT_ORG,
      session: { is: { organizationId: SUBJECT_ORG, assignmentId: { in: ['asg-good'] } } },
    }]);
    expect(eventQuery.select.type).toBe(true);
    expect(eventQuery.take).toBe(10_001);
    const evidenceQuery = findMany.proctoringEvidence.mock.calls[0][0] as {
      where: { OR: unknown[] }; select: Record<string, boolean>; take: number;
    };
    expect(evidenceQuery.where.OR).toEqual([{
      organizationId: SUBJECT_ORG, assignmentId: { in: ['asg-good'] },
    }]);
    expect(evidenceQuery.select).toHaveProperty('mediaType', true);
    expect(evidenceQuery.take).toBe(1_001);
    const findingQuery = findMany.proctoringFinding.mock.calls[0][0] as {
      where: { OR: unknown[] }; select: Record<string, boolean>; take: number;
    };
    expect(findingQuery.where.OR).toEqual([{
      organizationId: SUBJECT_ORG,
      evidence: { is: { organizationId: SUBJECT_ORG, assignmentId: { in: ['asg-good'] } } },
    }]);
    expect(findingQuery.select).toHaveProperty('resultKind', true);
    expect(findingQuery.take).toBe(10_001);
    const explanationQuery = findMany.proctoringCandidateExplanation.mock.calls[0][0] as {
      where: { OR: unknown[] }; select: Record<string, boolean>; take: number;
    };
    expect(explanationQuery.where.OR).toEqual([{
      organizationId: SUBJECT_ORG,
      assignmentId: { in: ['asg-good'] },
      candidateId: { in: [CANDIDATE_ID] },
    }]);
    expect(explanationQuery.select).toMatchObject({ id: true, text: true, organizationId: true });
    expect(explanationQuery.select).not.toHaveProperty('submissionId');
    expect(explanationQuery.take).toBe(1_001);
  });

  it('skips all proctoring reads when the subject has no matching assignments', async () => {
    findMany.assessmentAssignment.mockResolvedValue([]);
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const proctoring = JSON.parse(out.json).proctoring;
    expect(findMany.assessmentConsent).not.toHaveBeenCalled();
    expect(findMany.proctoringSession).not.toHaveBeenCalled();
    expect(findMany.proctoringEvent).not.toHaveBeenCalled();
    expect(findMany.proctoringEvidence).not.toHaveBeenCalled();
    expect(findMany.proctoringFinding).not.toHaveBeenCalled();
    expect(findMany.proctoringCandidateExplanation).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
    expect(proctoring).toMatchObject({
      assessmentConsents: [], sessions: [], events: [], evidence: [], findings: [], explanations: [],
      manualAccessRequired: false, physicalMediaIncluded: false, physicalMediaManualAccessRequired: false,
      truncated: { assessmentConsents: false, sessions: false, events: false, evidence: false, findings: false, explanations: false },
    });
  });

  it('keeps two same-email candidate organizations paired to their own assignments', async () => {
    const ORG_B = '77777777-7777-4777-8777-777777777777';
    const CANDIDATE_B = '88888888-8888-4888-8888-888888888888';
    findMany.candidate.mockResolvedValue([
      { id: CANDIDATE_ID, email: 'a@b.com', organizationId: SUBJECT_ORG },
      { id: CANDIDATE_B, email: 'a@b.com', organizationId: ORG_B },
    ]);
    findMany.assessmentAssignment.mockResolvedValue([
      { id: 'asg-a', candidateId: CANDIDATE_ID, organizationId: SUBJECT_ORG, result: null },
      { id: 'asg-b', candidateId: CANDIDATE_B, organizationId: ORG_B, result: null },
    ]);
    await caller().exportSubjectData({ email: 'a@b.com' });
    const consentQuery = findMany.assessmentConsent.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(consentQuery.where.OR).toEqual([
      { organizationId: SUBJECT_ORG, assignmentId: { in: ['asg-a'] }, candidateId: { in: [CANDIDATE_ID] } },
      { organizationId: ORG_B, assignmentId: { in: ['asg-b'] }, candidateId: { in: [CANDIDATE_B] } },
    ]);
    const evidenceQuery = findMany.proctoringEvidence.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(evidenceQuery.where.OR).toEqual([
      { organizationId: SUBJECT_ORG, assignmentId: { in: ['asg-a'] } },
      { organizationId: ORG_B, assignmentId: { in: ['asg-b'] } },
    ]);
  });

  it('includes consent, review, and normalized event metadata while marking legacy JSON for manual access', async () => {
    findMany.assessmentConsent.mockResolvedValue([{
      id: CONSENT_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1', candidateId: CANDIDATE_ID,
      consentType: 'assessment', textVersion: 'v1', agreedAt: '2026-09-24T10:00:00Z',
      ipAddress: '203.0.113.4', userAgent: 'browser',
    }]);
    findMany.proctoringSession.mockResolvedValue([{
      id: SESSION_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1',
      startedAt: '2026-09-24T10:00:00Z', endedAt: '2026-09-24T10:30:00Z',
      flagCount: 1, severity: 'low', consentedAt: '2026-09-24T10:00:00Z', consentVersion: 'v1',
      lastHeartbeatAt: '2026-09-24T10:29:00Z', reviewStatus: 'reviewed',
      reviewNotes: 'Human review completed', reviewedAt: '2026-09-24T11:00:00Z', reviewedById: USER_ID,
      events: [{ description: 'Legacy free text must not appear in the automated export' }],
    }]);
    findMany.proctoringEvent.mockResolvedValue([{
      id: EVENT_ID, organizationId: SUBJECT_ORG, sessionId: SESSION_ID,
      clientEventId: EVENT_ID, type: 'face_absent', source: 'on_device', severity: 'low',
      clientAt: '2026-09-24T10:12:00Z', occurredAt: '2026-09-24T10:12:01Z',
    }]);
    queryRaw.mockResolvedValue([{ id: SESSION_ID, has_legacy_events: true }]);

    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.assessmentConsents[0]).toMatchObject({ id: CONSENT_ID, ipAddress: '203.0.113.4' });
    expect(p.sessions[0]).toMatchObject({
      id: SESSION_ID, reviewNotes: 'Human review completed',
      legacyEventsManualAccessRequired: true,
    });
    expect(p.sessions[0]).not.toHaveProperty('events');
    expect(p.events[0]).toMatchObject({ id: EVENT_ID, type: 'face_absent' });
    expect(p.legacyEventsJsonIncluded).toBe(false);
    expect(p.manualAccessRequired).toBe(true);
    expect(p.manualAccessNotice).toContain('incompleta');
    expect(out.counts).toMatchObject({ proctoringConsents: 1, proctoringSessions: 1, proctoringEvents: 1 });
    const proctoringAudits = writtenRows().filter((row) =>
      ['assessmentConsent', 'proctoringSession', 'proctoringEvent'].includes(String(row.dataType)));
    expect(proctoringAudits.map((row) => [row.dataType, row.recordId])).toEqual([
      ['assessmentConsent', CONSENT_ID],
      ['proctoringSession', SESSION_ID],
      ['proctoringEvent', EVENT_ID],
    ]);
    expect(proctoringAudits.every((row) => row.organizationId === SUBJECT_ORG && row.action === 'export')).toBe(true);
    const sessionQuery = findMany.proctoringSession.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(sessionQuery.select).not.toHaveProperty('events');
    // The boolean probe itself remains tied to the subject org and exported session ID.
    expect(JSON.stringify(queryRaw.mock.calls[0][0])).toContain(SUBJECT_ORG);
    expect(JSON.stringify(queryRaw.mock.calls[0][0])).toContain(SESSION_ID);
    expect(JSON.stringify(queryRaw.mock.calls[0][0])).not.toContain(OPERATOR_ORG);
  });

  it('marks capped metadata as incomplete instead of silently returning a partial export', async () => {
    findMany.assessmentConsent.mockResolvedValue(
      Array.from({ length: 1_001 }, (_, i) => ({ id: `consent-${i}`, organizationId: SUBJECT_ORG })),
    );
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.assessmentConsents).toHaveLength(1_000);
    expect(p.truncated.assessmentConsents).toBe(true);
    expect(p.manualAccessRequired).toBe(true);
    expect(p.limits.assessmentConsents).toBe(1_000);
    expect(out.counts.proctoringConsents).toBe(1_000);
    expect((findMany.assessmentConsent.mock.calls[0][0] as { take: number }).take).toBe(1_001);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(writtenRows().filter((row) => row.dataType === 'assessmentConsent')).toHaveLength(1_000);
    expect(dataAccessCreateMany.mock.calls.slice(0, 3).map((call) => (call[0] as { data: unknown[] }).data.length))
      .toEqual([500, 500, 1]);
  });

  it('exports only selected evidence and finding metadata, audits each record, and requires manual media follow-up', async () => {
    findMany.proctoringEvidence.mockResolvedValue([{
      id: EVIDENCE_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1',
      sessionId: SESSION_ID, mediaType: 'camera', captureReason: 'periodic',
      captureSlot: 1, status: 'ready', byteSize: 1234,
    }]);
    findMany.proctoringFinding.mockResolvedValue([{
      id: FINDING_ID, organizationId: SUBJECT_ORG, evidenceId: EVIDENCE_ID,
      detector: 'rekognition', resultKind: 'observation', label: 'multiple_faces',
      confidence: 0.81, detectedCount: 2,
    }]);
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.evidence[0]).toMatchObject({ id: EVIDENCE_ID, mediaType: 'camera', status: 'ready' });
    expect(p.findings[0]).toMatchObject({ id: FINDING_ID, evidenceId: EVIDENCE_ID, label: 'multiple_faces' });
    expect(p.physicalMediaIncluded).toBe(false);
    expect(p.physicalMediaManualAccessRequired).toBe(true);
    expect(p.manualAccessRequired).toBe(true);
    expect(p.manualAccessNotice).toContain('imágenes de proctoring');
    expect(out.counts).toMatchObject({ proctoringEvidence: 1, proctoringFindings: 1 });
    const evidenceSelect = (findMany.proctoringEvidence.mock.calls[0][0] as { select: Record<string, boolean> }).select;
    for (const forbidden of ['stagingObjectKey', 'sealedObjectKey', 'sha256', 'stagingEtag', 'sealedEtag', 'clientCaptureId']) {
      expect(evidenceSelect).not.toHaveProperty(forbidden);
    }
    const rows = writtenRows().filter((row) =>
      ['proctoringEvidence', 'proctoringFinding'].includes(String(row.dataType)));
    expect(rows.map((row) => [row.dataType, row.recordId, row.organizationId, row.action])).toEqual([
      ['proctoringEvidence', EVIDENCE_ID, SUBJECT_ORG, 'export'],
      ['proctoringFinding', FINDING_ID, SUBJECT_ORG, 'export'],
    ]);
  });

  it('marks truncated evidence and findings for manual access and audits only exported rows', async () => {
    findMany.proctoringEvidence.mockResolvedValue(Array.from({ length: 1_001 }, (_, i) => ({
      id: `evidence-${i}`, organizationId: SUBJECT_ORG,
    })));
    findMany.proctoringFinding.mockResolvedValue(Array.from({ length: 10_001 }, (_, i) => ({
      id: `finding-${i}`, organizationId: SUBJECT_ORG,
    })));
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.evidence).toHaveLength(1_000);
    expect(p.findings).toHaveLength(10_000);
    expect(p.truncated).toMatchObject({ evidence: true, findings: true });
    expect(p.manualAccessRequired).toBe(true);
    expect(writtenRows().filter((row) => row.dataType === 'proctoringEvidence')).toHaveLength(1_000);
    expect(writtenRows().filter((row) => row.dataType === 'proctoringFinding')).toHaveLength(10_000);
  });

  it('exports a candidate explanation with fail-closed audit and no idempotency token', async () => {
    findMany.proctoringCandidateExplanation.mockResolvedValue([{
      id: EXPLANATION_ID, organizationId: SUBJECT_ORG,
      assignmentId: 'asg-1', sessionId: SESSION_ID, candidateId: CANDIDATE_ID,
      text: 'My camera froze for a moment.', submittedAt: new Date('2026-09-24T10:00:00Z'),
      expiresAt: new Date('2026-10-01T10:00:00Z'),
    }]);
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.explanations).toHaveLength(1);
    expect(p.explanations[0]).toMatchObject({ id: EXPLANATION_ID, text: 'My camera froze for a moment.' });
    expect(p.explanations[0]).not.toHaveProperty('submissionId');
    expect(out.counts.proctoringExplanations).toBe(1);
    expect(writtenRows()).toContainEqual(expect.objectContaining({
      dataType: 'proctoringCandidateExplanation', recordId: EXPLANATION_ID,
      organizationId: SUBJECT_ORG, action: 'export',
    }));

    dataAccessCreateMany.mockRejectedValueOnce(new Error('explanation audit failed'));
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });

  it('marks a capped explanation export for manual completion', async () => {
    findMany.proctoringCandidateExplanation.mockResolvedValue(Array.from({ length: 1_001 }, (_, i) => ({
      id: `explanation-${i}`, organizationId: SUBJECT_ORG,
      assignmentId: 'asg-1', candidateId: CANDIDATE_ID, text: `Statement ${i}`,
    })));
    const out = await caller().exportSubjectData({ email: 'a@b.com' });
    const p = JSON.parse(out.json).proctoring;
    expect(p.explanations).toHaveLength(1_000);
    expect(p.truncated.explanations).toBe(true);
    expect(p.manualAccessRequired).toBe(true);
    expect(out.counts.proctoringExplanations).toBe(1_000);
    expect(writtenRows().filter((row) => row.dataType === 'proctoringCandidateExplanation')).toHaveLength(1_000);
  });

  it('aborts before any export receipt when a media metadata audit fails', async () => {
    findMany.proctoringEvidence.mockResolvedValue([{
      id: EVIDENCE_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1',
    }]);
    dataAccessCreateMany.mockImplementation((args: { data: Array<{ dataType: string }> }) =>
      args.data.some((row) => row.dataType === 'proctoringEvidence')
        ? Promise.reject(new Error('media audit write failed'))
        : Promise.resolve({ count: args.data.length }),
    );
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('aborts before any fail-soft or export-event audit if a proctoring audit insert fails', async () => {
    findMany.assessmentConsent.mockResolvedValue([{
      id: CONSENT_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1', candidateId: CANDIDATE_ID,
    }]);
    dataAccessCreateMany.mockImplementation((args: { data: Array<{ dataType: string }> }) =>
      args.data.some((row) => row.dataType === 'assessmentConsent')
        ? Promise.reject(new Error('proctoring audit write failed'))
        : Promise.resolve({ count: args.data.length }),
    );
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(dataAccessCreateMany).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('fails instead of claiming no manual legacy access when the presence probe is incomplete', async () => {
    findMany.proctoringSession.mockResolvedValue([{
      id: SESSION_ID, organizationId: SUBJECT_ORG, assignmentId: 'asg-1',
    }]);
    queryRaw.mockResolvedValue([]);
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(auditLogCreate).not.toHaveBeenCalled();
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

  it('names the SAME actor on both audit rows under impersonation', async () => {
    // Previously data_access_logs used `impersonatorId ?? id` while audit_logs used a
    // bare ctx.user.id, so one export produced two rows blaming two different people.
    await caller(OPERATOR_ORG, 'real-admin-9').exportSubjectData({ email: 'a@b.com' });
    const auditArg = auditLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(auditArg.data.actorId).toBe('real-admin-9');
    for (const r of writtenRows()) expect(r.actorId).toBe(auditArg.data.actorId);
  });

  it('stamps ip / user-agent on the export-event row too', async () => {
    await caller().exportSubjectData({ email: 'a@b.com' });
    const auditArg = auditLogCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(auditArg.data.ipAddress).toBe('203.0.113.7');
    expect(auditArg.data.userAgent).toBe('jest-ua/1.0');
  });

  it('the §21 write happens BEFORE the export-event row, so a fail-closed abort leaves no false receipt', async () => {
    dataAccessCreateMany.mockRejectedValue(new Error('audit write failed'));
    await expect(caller().exportSubjectData({ email: 'a@b.com' })).rejects.toBeInstanceOf(TRPCError);
    expect(auditLogCreate).not.toHaveBeenCalled();
  });
});

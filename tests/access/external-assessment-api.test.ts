import { describe, it, expect, vi } from 'vitest';
import { fieldsVisibleTo } from '../../packages/api/src/access/classification';
import { selectFor } from '../../packages/api/src/access/select-for';
import { toExternalAssessmentResultV1 } from '../../packages/api/src/dto/external-assessment';

describe('classification — external reads the full assessment profile (Federico Jun 15)', () => {
  it('external sees every assessmentResult score field', () => {
    const fields = fieldsVisibleTo(['external'], 'assessmentResult');
    for (const f of ['normalizedScore', 'percentile', 'interpretation', 'breakdown', 'rawScore', 'modelVersion']) {
      expect(fields).toContain(f);
    }
  });

  it('selectFor(external) includes anchors + all score fields', () => {
    const sel = selectFor(['external'], 'assessmentResult');
    expect(sel).toMatchObject({
      id: true,
      organizationId: true,
      assignmentId: true,
      normalizedScore: true,
      percentile: true,
      interpretation: true,
      breakdown: true,
      rawScore: true,
      modelVersion: true,
    });
  });

  it('does NOT widen any OTHER entity for external', () => {
    expect(fieldsVisibleTo(['external'], 'employeeCompensation')).toEqual([]);
    expect(fieldsVisibleTo(['external'], 'employeeDemographics')).toEqual([]);
    expect(fieldsVisibleTo(['external'], 'surveyResponse')).toEqual([]);
  });
});

describe('external assessment DTO v1 (stable contract)', () => {
  const row = {
    id: 'res-1',
    organizationId: 'org-1',
    assignmentId: 'asg-1',
    rawScore: 50,
    normalizedScore: 72.5,
    percentile: 84,
    breakdown: { verbal: 80 },
    interpretation: { band: 'high' },
    modelVersion: 'v3',
    scoredAt: new Date('2026-06-10T00:00:00Z'),
    assignment: {
      candidateId: 'cand-1',
      vacancyId: 'vac-1',
      status: 'completed',
      assignedAt: new Date('2026-06-01T00:00:00Z'),
      startedAt: new Date('2026-06-02T00:00:00Z'),
      completedAt: new Date('2026-06-03T00:00:00Z'),
      expiresAt: null,
      assessmentType: { name: 'Cognitive Battery' },
    },
  };

  it('maps to the v1 shape with schemaVersion and a flat analysis payload', () => {
    const dto = toExternalAssessmentResultV1(row);
    expect(dto).toEqual({
      schemaVersion: 'v1',
      assignmentId: 'asg-1',
      candidateId: 'cand-1',
      vacancyId: 'vac-1',
      assessmentType: 'Cognitive Battery',
      status: 'completed',
      assignedAt: row.assignment.assignedAt,
      startedAt: row.assignment.startedAt,
      completedAt: row.assignment.completedAt,
      expiresAt: null,
      scoredAt: row.scoredAt,
      rawScore: 50,
      normalizedScore: 72.5,
      percentile: 84,
      interpretation: { band: 'high' },
      breakdown: { verbal: 80 },
      modelVersion: 'v3',
    });
  });

  it('tolerates a missing assessmentType name', () => {
    const dto = toExternalAssessmentResultV1({ ...row, assignment: { ...row.assignment, assessmentType: null } });
    expect(dto.assessmentType).toBeNull();
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';
const RR = join(__dirname, '../..');
const rd = (p: string) => readFileSync(join(RR, p), 'utf8');

describe('external-assessment repository scoping', () => {
  const REPO = rd('packages/api/src/repositories/external-assessment.repository.ts');
  it('reads through tenantDb (RLS), never the privileged db', () => {
    expect(REPO).toContain('tenantDb');
    expect(REPO).not.toMatch(/import\s*\{\s*db\s*\}\s*from\s*'@tims\/db'/);
  });
  it('projects result fields via selectFor(external) — no hand-rolled score select', () => {
    expect(REPO).toMatch(/selectFor\(\s*\[\s*'external'\s*\]\s*,\s*'assessmentResult'\s*\)/);
  });
  it('composes scopeWhereFor for assessmentAssignment (AND, never spread)', () => {
    expect(REPO).toMatch(/scopeWhereFor\(\s*'assessmentAssignment'/);
    expect(REPO).toMatch(/AND:\s*\[/);
  });
  it('bounds the page and orders deterministically for cursor pagination', () => {
    expect(REPO).toMatch(/take:/);
    expect(REPO).toMatch(/orderBy:/);
  });
});

describe('external-assessment repository — behavioral (select includes scoredAt)', () => {
  it('listExternalResults selects scoredAt + all score fields and scopes via AND', async () => {
    vi.resetModules();
    const findMany = vi.fn().mockResolvedValue([]);
    vi.doMock('@tims/db', () => ({
      tenantDb: { assessmentResult: { findMany, findFirst: vi.fn() } },
    }));
    const { listExternalResults } = await import('../../packages/api/src/repositories/external-assessment.repository');
    // Org-scope access → scopeWhereFor returns {} without touching anchors.
    const access = { allowed: true as const, scope: 'organization' as const, roles: ['external'], anchors: null };
    await listExternalResults(access, 'org-1', 'key-1', 10);
    const arg = findMany.mock.calls[0][0];
    // The bug: scoredAt was missing from select.
    expect(arg.select.scoredAt).toBe(true);
    expect(arg.select.normalizedScore).toBe(true);
    expect(arg.select.breakdown).toBe(true);
    expect(arg.select.assignment.select.completedAt).toBe(true);
    expect(arg.select.assignment.select.assessmentType.select.name).toBe(true);
    // Scope composed via AND (never spread).
    expect(Array.isArray(arg.where.AND)).toBe(true);
    // Defense-in-depth: explicit organizationId predicate must be present.
    expect(JSON.stringify(arg.where)).toContain('"organizationId":"org-1"');
    expect(arg.take).toBe(11); // take + 1 probe
    expect(arg.orderBy).toEqual([{ scoredAt: 'desc' }, { assignmentId: 'asc' }]);
    vi.doUnmock('@tims/db');
  });

  it('getExternalResult gates on completed assignment (lifecycle parity with list)', async () => {
    vi.resetModules();
    const findFirst = vi.fn().mockResolvedValue(null);
    vi.doMock('@tims/db', () => ({ tenantDb: { assessmentResult: { findFirst, findMany: vi.fn() } } }));
    const { getExternalResult } = await import('../../packages/api/src/repositories/external-assessment.repository');
    const access = { allowed: true as const, scope: 'organization' as const, roles: ['external'], anchors: null };
    await getExternalResult(access, 'org-1', 'key-1', '11111111-1111-1111-1111-111111111111');
    const where = JSON.stringify(findFirst.mock.calls[0][0].where);
    expect(where).toContain('"status":"completed"');
    expect(where).toContain('"organizationId":"org-1"');
    vi.doUnmock('@tims/db');
  });
});

describe('external-assessment service — fail-closed audited export', () => {
  const sampleRow = {
    id: 'res-1',
    assignmentId: 'asg-1',
    rawScore: 1,
    normalizedScore: 2,
    percentile: 3,
    interpretation: {},
    breakdown: {},
    modelVersion: 'v1',
    scoredAt: new Date('2026-06-10T00:00:00Z'),
    assignment: {
      candidateId: 'c1',
      vacancyId: 'v1',
      status: 'completed',
      assignedAt: new Date('2026-06-01T00:00:00Z'),
      startedAt: null,
      completedAt: new Date('2026-06-03T00:00:00Z'),
      expiresAt: null,
      assessmentType: { name: 'Battery' },
    },
  };

  async function load(opts: { rows?: unknown[]; one?: unknown; auditThrows?: boolean }) {
    vi.resetModules();
    const logDataAccess = vi.fn(async (_e: unknown, o?: { failClosed?: boolean }) => {
      if (opts.auditThrows && o?.failClosed) throw new Error('audit down');
    });
    vi.doMock('../../packages/api/src/access/audit', () => ({ logDataAccess, auditRequiredFor: () => true }));
    vi.doMock('../../packages/api/src/repositories/external-assessment.repository', () => ({
      listExternalResults: vi.fn(async () => ({ rows: opts.rows ?? [], nextCursor: undefined })),
      getExternalResult: vi.fn(async () => opts.one ?? null),
    }));
    const mod = await import('../../packages/api/src/services/external-assessment.service');
    return { mod, logDataAccess };
  }

  const access = { allowed: true as const, scope: 'organization' as const, roles: ['external'], anchors: null };
  const meta = { organizationId: 'org-1', apiKeyId: 'key-1', ipAddress: '1.2.3.4', userAgent: 'ua' };
  // Inert for these tests — EXTERNAL_VENDOR_READ_VIA_CSHARP defaults unset, so list()/getOne()
  // always take the Prisma fallback path below and never read this value. Only exercised once
  // the C#-proxy dark-cutover path is flag-enabled (see external-assessment.service.ts).
  const authHeader = 'Bearer tims_test_key';

  it('list audits every record fail-closed (actorId=apiKeyId, entity=assessmentResult) then maps to v1', async () => {
    const { mod, logDataAccess } = await load({ rows: [sampleRow] });
    const out = await mod.externalAssessmentService.list(access, meta, 10, undefined, authHeader);
    expect(logDataAccess).toHaveBeenCalledTimes(1);
    const [event, options] = logDataAccess.mock.calls[0];
    expect(event).toMatchObject({
      organizationId: 'org-1',
      actorId: 'key-1',
      entity: 'assessmentResult',
      recordId: 'res-1',
    });
    expect(options).toEqual({ failClosed: true });
    expect(out.items[0]).toMatchObject({ schemaVersion: 'v1', assignmentId: 'asg-1', normalizedScore: 2 });
    vi.doUnmock('../../packages/api/src/access/audit');
    vi.doUnmock('../../packages/api/src/repositories/external-assessment.repository');
  });

  it('list aborts (throws) if a fail-closed audit write fails — no data returned', async () => {
    const { mod } = await load({ rows: [sampleRow], auditThrows: true });
    await expect(mod.externalAssessmentService.list(access, meta, 10, undefined, authHeader)).rejects.toThrow();
    vi.doUnmock('../../packages/api/src/access/audit');
    vi.doUnmock('../../packages/api/src/repositories/external-assessment.repository');
  });

  it('getOne throws NOT_FOUND when the repo returns null (no audit)', async () => {
    const { mod, logDataAccess } = await load({ one: null });
    await expect(mod.externalAssessmentService.getOne(access, meta, 'missing', authHeader)).rejects.toThrow();
    expect(logDataAccess).not.toHaveBeenCalled();
    vi.doUnmock('../../packages/api/src/access/audit');
    vi.doUnmock('../../packages/api/src/repositories/external-assessment.repository');
  });

  it('getOne audits fail-closed then returns the v1 DTO', async () => {
    const { mod, logDataAccess } = await load({ one: sampleRow });
    const dto = await mod.externalAssessmentService.getOne(access, meta, 'asg-1', authHeader);
    expect(logDataAccess).toHaveBeenCalledTimes(1);
    expect(logDataAccess.mock.calls[0][1]).toEqual({ failClosed: true });
    expect(dto).toMatchObject({ schemaVersion: 'v1', assignmentId: 'asg-1' });
    vi.doUnmock('../../packages/api/src/access/audit');
    vi.doUnmock('../../packages/api/src/repositories/external-assessment.repository');
  });
});

describe('external router', () => {
  const ROUTER = rd('packages/api/src/routers/external.ts');
  it('gates every endpoint with externalPermissionProcedure (assessment:read)', () => {
    const procs = [...ROUTER.matchAll(/(\w+):\s*(externalPermissionProcedure|ASSESSMENT_READ)/g)].map((m) => m[2]);
    expect(procs.length).toBeGreaterThan(0);
    expect(ROUTER).toMatch(/externalPermissionProcedure\(\s*'assessment'\s*,\s*'read'/);
  });
  it('never accepts the api key as input (read from header only)', () => {
    expect(ROUTER).not.toMatch(/key:\s*z\./);
    expect(ROUTER).not.toMatch(/apiKey:\s*z\./);
  });
  it('passes ip/user-agent from headers to the audit meta', () => {
    expect(ROUTER).toMatch(/ctx\.headers\.get\(/);
    expect(ROUTER).toMatch(/apiKeyId:\s*ctx\.externalAuth/);
  });
  it('bounds the list page size (<=25)', () => {
    expect(ROUTER).toMatch(/\.max\(25\)/);
  });
  it('is registered in root.ts', () => {
    const ROOT = rd('packages/api/src/root.ts');
    expect(ROOT).toMatch(/external:\s*externalRouter/);
  });
});

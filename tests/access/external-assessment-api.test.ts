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

// TS-deletion (2026-07-31): `EXTERNAL_VENDOR_READ_VIA_CSHARP` is confirmed live in prod, so the
// Prisma-backed fallback (packages/api/src/repositories/external-assessment.repository.ts) was
// deleted as provably dead code — list()/getOne() now proxy unconditionally to the C# service.
// The repository-scoping + repository-behavioral suites that used to live here tested that
// deleted file directly and have no replacement target; DTO-mapping coverage for
// toExternalAssessmentResultV1 (the row -> v1 remap) still lives above in this file and in
// tests/external-vendor/assessment-result-v1-fixtures.test.ts (golden-fixture parity with the C#
// mapper), both of which are untouched since dto/external-assessment.ts still exports it for
// those independent consumers.

describe('external-assessment service — unconditional C# proxy (read cutover live)', () => {
  const access = { allowed: true as const, scope: 'organization' as const, roles: ['external'], anchors: null };
  const meta = { organizationId: 'org-1', apiKeyId: 'key-1', ipAddress: '1.2.3.4', userAgent: 'ua' };
  const authHeader = 'Bearer tims_test_key';

  const rawRow = {
    schemaVersion: 'v1',
    assignmentId: 'asg-1',
    candidateId: 'c1',
    vacancyId: 'v1',
    assessmentType: 'Battery',
    status: 'completed',
    assignedAt: '2026-06-01T00:00:00.000Z',
    startedAt: null,
    completedAt: '2026-06-03T00:00:00.000Z',
    expiresAt: null,
    scoredAt: '2026-06-10T00:00:00.000Z',
    rawScore: 1,
    normalizedScore: 2,
    percentile: 3,
    interpretation: {},
    breakdown: {},
    modelVersion: 'v1',
  };

  async function load() {
    vi.resetModules();
    const platformGetWithAuth = vi.fn();
    vi.doMock('../../packages/api/src/lib/platform-api-client', () => ({ platformGetWithAuth }));
    const mod = await import('../../packages/api/src/services/external-assessment.service');
    return { mod, platformGetWithAuth };
  }

  it('list proxies to /external/assessment-results with take/cursor and maps items to v1', async () => {
    const { mod, platformGetWithAuth } = await load();
    platformGetWithAuth.mockResolvedValue({ status: 200, body: { items: [rawRow], nextCursor: 'asg-1' } });
    const out = await mod.externalAssessmentService.list(access, meta, 10, 'cursor-0', authHeader);
    expect(platformGetWithAuth).toHaveBeenCalledWith('/external/assessment-results', authHeader, {
      take: 10,
      cursor: 'cursor-0',
    });
    expect(out.items[0]).toMatchObject({ schemaVersion: 'v1', assignmentId: 'asg-1', normalizedScore: 2 });
    expect(out.nextCursor).toBe('asg-1');
    vi.doUnmock('../../packages/api/src/lib/platform-api-client');
  });

  it('list maps a non-200 proxy response to the corresponding tRPC error', async () => {
    const { mod, platformGetWithAuth } = await load();
    platformGetWithAuth.mockResolvedValue({ status: 401, body: null });
    await expect(mod.externalAssessmentService.list(access, meta, 10, undefined, authHeader)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    vi.doUnmock('../../packages/api/src/lib/platform-api-client');
  });

  it('getOne proxies to the by-id endpoint and returns the v1 DTO on 200', async () => {
    const { mod, platformGetWithAuth } = await load();
    platformGetWithAuth.mockResolvedValue({ status: 200, body: rawRow });
    const dto = await mod.externalAssessmentService.getOne(access, meta, 'asg-1', authHeader);
    expect(platformGetWithAuth).toHaveBeenCalledWith('/external/assessment-results/asg-1', authHeader);
    expect(dto).toMatchObject({ schemaVersion: 'v1', assignmentId: 'asg-1' });
    vi.doUnmock('../../packages/api/src/lib/platform-api-client');
  });

  it('getOne throws NOT_FOUND on a proxy 404', async () => {
    const { mod, platformGetWithAuth } = await load();
    platformGetWithAuth.mockResolvedValue({ status: 404, body: null });
    await expect(mod.externalAssessmentService.getOne(access, meta, 'missing', authHeader)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    vi.doUnmock('../../packages/api/src/lib/platform-api-client');
  });

  it('getOne maps a non-200/404 proxy response to INTERNAL_SERVER_ERROR', async () => {
    const { mod, platformGetWithAuth } = await load();
    platformGetWithAuth.mockResolvedValue({ status: 500, body: null });
    await expect(mod.externalAssessmentService.getOne(access, meta, 'asg-1', authHeader)).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
    vi.doUnmock('../../packages/api/src/lib/platform-api-client');
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

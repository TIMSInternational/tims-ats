import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const candidateFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    candidate: {
      findMany: (...args: unknown[]) => candidateFindMany(...args),
    },
  },
}));

import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

describe('candidateRepository.findForExport', () => {
  beforeEach(() => {
    candidateFindMany.mockReset();
    candidateFindMany.mockResolvedValue([]);
  });

  it('composes organizationId, deletedAt: null, and scopeWhere via AND (never spread)', async () => {
    const scopeWhere = { __marker: 'scope-fragment' };
    await candidateRepository.findForExport('org-1', scopeWhere as never, {}, 5000);

    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ organizationId: 'org-1', deletedAt: null });
    expect(call.where.AND).toContainEqual(scopeWhere);
  });

  it('adds a poolType filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { poolType: 'active' }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ poolType: 'active' });
  });

  it('adds a tags filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { tags: ['vip'] }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ tags: { some: { tag: { in: ['vip'] } } } });
  });

  it('requests one extra row beyond the limit (truncation detection)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.take).toBe(5001);
  });

  it('selects only the export columns (no full-record leak)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.select).toEqual({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      poolType: true,
      currentTitle: true,
      currentCompany: true,
      yearsExperience: true,
      location: true,
      tags: { select: { tag: true } },
      createdAt: true,
    });
  });
});

import { candidateService } from '../../packages/api/src/services/candidate.service';
import * as candidateRepositoryModule from '../../packages/api/src/repositories/candidate.repository';

describe('candidateService.exportPool', () => {
  let findForExportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findForExportSpy = vi.spyOn(candidateRepositoryModule.candidateRepository, 'findForExport');
  });

  afterEach(() => {
    findForExportSpy.mockRestore();
  });

  it('builds a CSV header + one row per candidate', async () => {
    findForExportSpy.mockResolvedValue([
      {
        firstName: 'Ana',
        lastName: 'Diaz',
        email: 'ana@x.com',
        phone: '555-1',
        source: 'referral',
        poolType: 'active',
        currentTitle: 'Engineer',
        currentCompany: 'Acme',
        yearsExperience: 5,
        location: 'Bogota',
        tags: [{ tag: 'vip' }, { tag: 'senior' }],
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    const lines = result.csv.split('\n');
    expect(lines[0]).toContain('First Name');
    expect(lines[1]).toContain('"Ana"');
    expect(lines[1]).toContain('"vip; senior"');
  });

  it('caps at 5000 rows and marks truncated when the repository returns 5001', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      firstName: `F${i}`,
      lastName: 'L',
      email: `e${i}@x.com`,
      phone: null,
      source: 's',
      poolType: 'active',
      currentTitle: null,
      currentCompany: null,
      yearsExperience: null,
      location: null,
      tags: [],
      createdAt: new Date(),
    }));
    findForExportSpy.mockResolvedValue(rows);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.csv.split('\n').length).toBe(5001); // header + 5000 rows
  });

  it('does not mark truncated at exactly 5000 rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      firstName: `F${i}`,
      lastName: 'L',
      email: `e${i}@x.com`,
      phone: null,
      source: 's',
      poolType: 'active',
      currentTitle: null,
      currentCompany: null,
      yearsExperience: null,
      location: null,
      tags: [],
      createdAt: new Date(),
    }));
    findForExportSpy.mockResolvedValue(rows);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(5000);
    expect(result.truncated).toBe(false);
  });

  it('neutralizes a formula-injection field (CWE-1236)', async () => {
    findForExportSpy.mockResolvedValue([
      {
        firstName: 'Ana',
        lastName: 'Diaz',
        email: 'ana@x.com',
        phone: null,
        source: 's',
        poolType: 'active',
        currentTitle: null,
        currentCompany: '=SUM(A1:A10)',
        yearsExperience: null,
        location: null,
        tags: [],
        createdAt: new Date(),
      },
    ]);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.csv).toContain('"\'=SUM(A1:A10)"');
  });

  it('passes poolType/tags input through to the repository as filters', async () => {
    findForExportSpy.mockResolvedValue([]);
    await candidateService.exportPool('org-1', {} as never, { poolType: 'active', tags: ['vip'] });

    expect(findForExportSpy).toHaveBeenCalledWith('org-1', {}, { poolType: 'active', tags: ['vip'] }, 5000);
  });
});

describe('candidate.pool.export router (source text checks)', () => {
  const src = readFileSync(resolve(__dirname, '../../packages/api/src/routers/candidate/pool.ts'), 'utf8');

  it('narrows the format input to csv only (drops the unfulfilled xlsx promise)', () => {
    expect(src).toMatch(/format:\s*z\.literal\('csv'\)/);
    expect(src).not.toContain("z.enum(['csv', 'xlsx'])");
  });

  it('applies scope filtering (the old stub applied none)', () => {
    expect(src).toContain("scopeWhereFor('candidate', ctx.access, ctx.user.id)");
  });

  it('calls the real service and logs the export', () => {
    expect(src).toContain('candidateService.exportPool');
    expect(src).toContain('logPlatformExport');
    expect(src).not.toContain('stub_generated');
    expect(src).not.toContain('storage.tims.app');
  });
});

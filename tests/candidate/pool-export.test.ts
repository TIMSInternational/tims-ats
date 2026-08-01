import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const candidateFindMany = vi.fn();
const auditLogCreate = vi.fn().mockResolvedValue({});

vi.mock('@tims/db', () => ({
  tenantDb: {
    candidate: {
      findMany: (...args: unknown[]) => candidateFindMany(...args),
    },
  },
  // Router-level behavioral test below needs a real tRPC caller, which threads
  // through trpc.ts's `db`/`runWithTenant` imports (audit logging + tenant
  // context). Stubbed here rather than left undefined so those middleware
  // calls no-op cleanly instead of relying on their own fail-soft catch.
  db: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreate(...args),
    },
  },
  runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
}));

// Scope-filtering (the router's headline security property) is mocked so the
// behavioral test below can assert the resolved scopeWhere fragment actually
// flows into candidatePoolService.exportPool — see the "router (behavioral)"
// describe block. Pattern mirrors tests/candidate/documents-router.test.ts.
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async () => ({ allowed: true, scope: 'organization', roles: ['hr_admin'] })),
);
const scopeWhereForMock = vi.hoisted(() => vi.fn().mockResolvedValue({ __marker: 'scope-fragment' }));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: buildAccessForUserMock,
    scopeWhereFor: scopeWhereForMock,
  };
});

import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

describe('candidateRepository.findForExport', () => {
  beforeEach(() => {
    candidateFindMany.mockReset();
    candidateFindMany.mockResolvedValue([]);
  });

  it('composes organizationId, isActive: true, deletedAt: null, and scopeWhere via AND (never spread)', async () => {
    const scopeWhere = { __marker: 'scope-fragment' };
    await candidateRepository.findForExport('org-1', scopeWhere as never, {}, 5000);

    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ organizationId: 'org-1', isActive: true, deletedAt: null });
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

import { candidatePoolService } from '../../packages/api/src/services/candidate-pool.service';
import * as candidateRepositoryModule from '../../packages/api/src/repositories/candidate.repository';

describe('candidatePoolService.exportPool', () => {
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

    const result = await candidatePoolService.exportPool('org-1', {} as never, {});

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

    const result = await candidatePoolService.exportPool('org-1', {} as never, {});

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

    const result = await candidatePoolService.exportPool('org-1', {} as never, {});

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

    const result = await candidatePoolService.exportPool('org-1', {} as never, {});

    expect(result.csv).toContain('"\'=SUM(A1:A10)"');
  });

  it('passes poolType/tags input through to the repository as filters', async () => {
    findForExportSpy.mockResolvedValue([]);
    await candidatePoolService.exportPool('org-1', {} as never, { poolType: 'active', tags: ['vip'] });

    expect(findForExportSpy).toHaveBeenCalledWith('org-1', {}, { poolType: 'active', tags: ['vip'] }, 5000);
  });
});

describe('candidate.pool.export router (source text checks)', () => {
  const src = readFileSync(resolve(__dirname, '../../packages/api/src/routers/candidate/pool.ts'), 'utf8');

  it('narrows the format input to csv only (drops the unfulfilled xlsx promise)', () => {
    expect(src).toMatch(/format:\s*z\.literal\('csv'\)/);
    expect(src).not.toContain("z.enum(['csv', 'xlsx'])");
  });

  it('calls the real service and logs the export', () => {
    expect(src).toContain('candidatePoolService.exportPool');
    expect(src).toContain('logPlatformExport');
    expect(src).not.toContain('stub_generated');
    expect(src).not.toContain('storage.tims.app');
  });
});

// Behavioral replacement for the old "applies scope filtering" source-text check:
// a real tRPC caller is built for candidatePoolRouter with scopeWhereFor mocked to
// return a distinctive marker fragment, and we assert that marker actually flows
// into candidatePoolService.exportPool's scopeWhere argument — proving the tenant/scope
// filter reaches the service call, not just that the source text mentions it.
// Pattern mirrors tests/candidate/documents-router.test.ts.
describe('candidate.pool.export router (behavioral)', () => {
  const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  async function makePoolCaller() {
    const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
    const { candidatePoolRouter } = await import('../../packages/api/src/routers/candidate/pool');
    const testRouter = router({ pool: candidatePoolRouter });
    const callerFactory = createCallerFactory(testRouter);
    return callerFactory({
      user: {
        id: 'user-1',
        organizationId: ORG_ID,
        roles: ['hr_admin'],
        isPlatformOwner: false,
        impersonatorId: null,
        email: 'hr@tims.co',
        isActive: true,
      },
      headers: new Headers(),
      supabaseAuth: null,
      externalAuth: null,
    } as never) as unknown as {
      pool: {
        export(input: { format: 'csv'; poolType?: string; tags?: string[] }): Promise<unknown>;
      };
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    buildAccessForUserMock.mockResolvedValue({ allowed: true, scope: 'organization', roles: ['hr_admin'] });
    scopeWhereForMock.mockResolvedValue({ __marker: 'scope-fragment' });
    auditLogCreate.mockResolvedValue({});
  });

  it('threads the scopeWhereFor result into candidatePoolService.exportPool as scopeWhere', async () => {
    const exportPoolSpy = vi
      .spyOn(candidatePoolService, 'exportPool')
      .mockResolvedValue({ csv: 'header\n', count: 0, truncated: false });

    try {
      const caller = await makePoolCaller();
      await caller.pool.export({ format: 'csv' });

      expect(exportPoolSpy).toHaveBeenCalledWith(
        ORG_ID,
        { __marker: 'scope-fragment' },
        expect.objectContaining({ poolType: undefined, tags: undefined }),
      );
    } finally {
      exportPoolSpy.mockRestore();
    }
  });
});

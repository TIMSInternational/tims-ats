import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AccessDecision } from '../../packages/api/src/access';

// ---------------------------------------------------------------------------
// Mocks — pattern mirrors tests/candidate/pool-export.test.ts (the export
// feature this branch's review explicitly cites as the expected test shape).
// ---------------------------------------------------------------------------
const auditLogFindManyMock = vi.fn();
const auditLogCreateMock = vi.fn().mockResolvedValue({});

vi.mock('@tims/db', () => ({
  tenantDb: {
    auditLog: {
      findMany: (...args: unknown[]) => auditLogFindManyMock(...args),
    },
  },
  // Router-level behavioral test below needs a real tRPC caller, which threads
  // through trpc.ts's `db`/`runWithTenant` imports (audit logging + tenant
  // context) — stubbed here so those middleware/observer calls no-op cleanly.
  db: {
    auditLog: {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
    },
  },
  runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
}));

const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async (): Promise<AccessDecision> => ({ allowed: true, scope: 'organization', roles: ['super_admin'] })),
);

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: buildAccessForUserMock,
  };
});

import { auditRepository } from '../../packages/api/src/repositories/audit.repository';

// ---------------------------------------------------------------------------
// Repository — tenant isolation is the safety-critical property here: every
// filter combination must still be AND'd against organizationId, and a caller
// can never widen the query beyond its own org.
// ---------------------------------------------------------------------------
describe('auditRepository.findForExport', () => {
  beforeEach(() => {
    auditLogFindManyMock.mockReset();
    auditLogFindManyMock.mockResolvedValue([]);
  });

  it('always scopes the query by the caller-supplied organizationId', async () => {
    await auditRepository.findForExport('org-1', {}, 100);
    const call = auditLogFindManyMock.mock.calls[0]?.[0];
    expect(call.where.organizationId).toBe('org-1');
  });

  it('scopes by whichever organizationId is passed — filters cannot override tenant scope', async () => {
    await auditRepository.findForExport('org-2', { actorId: 'a1', entity: 'candidate', action: 'update' }, 100);
    const call = auditLogFindManyMock.mock.calls[0]?.[0];
    expect(call.where.organizationId).toBe('org-2');
    expect(call.where.organizationId).not.toBe('org-1');
  });

  it('adds an actorId filter only when provided', async () => {
    await auditRepository.findForExport('org-1', {}, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.actorId).toBeUndefined();

    auditLogFindManyMock.mockClear();
    await auditRepository.findForExport('org-1', { actorId: 'a1' }, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.actorId).toBe('a1');
  });

  it('adds an entity filter only when provided', async () => {
    await auditRepository.findForExport('org-1', {}, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.entity).toBeUndefined();

    auditLogFindManyMock.mockClear();
    await auditRepository.findForExport('org-1', { entity: 'candidate' }, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.entity).toBe('candidate');
  });

  it('adds an action filter only when provided', async () => {
    await auditRepository.findForExport('org-1', {}, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.action).toBeUndefined();

    auditLogFindManyMock.mockClear();
    await auditRepository.findForExport('org-1', { action: 'update' }, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.action).toBe('update');
  });

  it('builds a createdAt range from dateFrom/dateTo, omitting whichever side is absent', async () => {
    const dateFrom = new Date('2026-01-01T00:00:00Z');
    const dateTo = new Date('2026-02-01T00:00:00Z');

    await auditRepository.findForExport('org-1', { dateFrom, dateTo }, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.createdAt).toEqual({ gte: dateFrom, lte: dateTo });

    auditLogFindManyMock.mockClear();
    await auditRepository.findForExport('org-1', { dateFrom }, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.createdAt).toEqual({ gte: dateFrom });

    auditLogFindManyMock.mockClear();
    await auditRepository.findForExport('org-1', {}, 100);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].where.createdAt).toBeUndefined();
  });

  it('requests one extra row beyond the limit (truncation detection)', async () => {
    await auditRepository.findForExport('org-1', {}, 250);
    expect(auditLogFindManyMock.mock.calls[0]?.[0].take).toBe(251);
  });

  it('selects only export columns — deliberately excludes changes/metadata (business-sensitive payloads)', async () => {
    await auditRepository.findForExport('org-1', {}, 100);
    const call = auditLogFindManyMock.mock.calls[0]?.[0];
    expect(call.select).toEqual({
      id: true,
      action: true,
      entity: true,
      entityId: true,
      actorId: true,
      userId: true,
      createdAt: true,
      ipAddress: true,
      userAgent: true,
      actor: { select: { firstName: true, lastName: true, email: true } },
    });
    expect(call.select.changes).toBeUndefined();
    expect(call.select.metadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Service — truncation at EXPORT_LIMIT, CSV vs JSON branch selection, and CSV
// escaping of the actual export fields (actorName/actorEmail/action/entity/
// entityId/ipAddress/userAgent).
// ---------------------------------------------------------------------------
import { auditService } from '../../packages/api/src/services/audit.service';
import * as auditRepositoryModule from '../../packages/api/src/repositories/audit.repository';

const EXPORT_LIMIT = 10_000;

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    action: 'update',
    entity: 'candidate',
    entityId: 'cand-1',
    actorId: 'actor-1',
    userId: null,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    ipAddress: '1.2.3.4',
    userAgent: 'Mozilla/5.0',
    actor: { firstName: 'Ana', lastName: 'Diaz', email: 'ana@x.com' },
    ...overrides,
  };
}

describe('auditService.exportLogs', () => {
  let findForExportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findForExportSpy = vi.spyOn(auditRepositoryModule.auditRepository, 'findForExport');
  });

  afterEach(() => {
    findForExportSpy.mockRestore();
  });

  it('passes filters (without format) and EXPORT_LIMIT through to the repository', async () => {
    findForExportSpy.mockResolvedValue([]);
    await auditService.exportLogs('org-1', { format: 'csv', actorId: 'a1', entity: 'candidate' });

    expect(findForExportSpy).toHaveBeenCalledWith('org-1', { actorId: 'a1', entity: 'candidate' }, EXPORT_LIMIT);
  });

  it('builds a CSV header + one row per log, with actorName from firstName+lastName', async () => {
    findForExportSpy.mockResolvedValue([makeLog()]);

    const result = await auditService.exportLogs('org-1', { format: 'csv' });

    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.format).toBe('csv');
    const lines = result.data.split('\n');
    expect(lines[0]).toBe(
      '"Timestamp","Actor Name","Actor Email","Action","Entity","Entity ID","IP Address","User Agent"',
    );
    expect(lines[1]).toContain('"Ana Diaz"');
    expect(lines[1]).toContain('"ana@x.com"');
    expect(lines[1]).toContain('"update"');
    expect(lines[1]).toContain('"candidate"');
  });

  it('falls back to an empty actorName/actorEmail when the log has no actor (system action)', async () => {
    findForExportSpy.mockResolvedValue([makeLog({ actor: null })]);

    const result = await auditService.exportLogs('org-1', { format: 'csv' });

    const [, row] = result.data.split('\n');
    // Empty actorName/actorEmail cells render as bare "" between the leading and
    // trailing quoted-comma boundaries.
    expect(row).toMatch(/^"[^"]+","","",/);
  });

  it('builds JSON output as the stringified record array (not the raw log rows)', async () => {
    findForExportSpy.mockResolvedValue([makeLog()]);

    const result = await auditService.exportLogs('org-1', { format: 'json' });

    expect(result.format).toBe('json');
    const parsed = JSON.parse(result.data) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      timestamp: '2026-01-01T12:00:00.000Z',
      actorName: 'Ana Diaz',
      actorEmail: 'ana@x.com',
      action: 'update',
      entity: 'candidate',
      entityId: 'cand-1',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('neutralizes a formula-injection actorName and escapes embedded quotes/commas (CWE-1236)', async () => {
    findForExportSpy.mockResolvedValue([
      makeLog({
        actor: { firstName: '=cmd|"/c calc"!A1', lastName: 'Evil', email: 'ana@x.com' },
        entity: 'candidate, "VIP"',
      }),
    ]);

    const result = await auditService.exportLogs('org-1', { format: 'csv' });
    const [, row] = result.data.split('\n');

    // Leading "=" is neutralized with a leading apostrophe before quoting.
    expect(row).toContain('"\'=cmd|""/c calc""!A1 Evil"');
    // Embedded quote/comma in entity is escaped (doubled quote) and stays inside
    // one quoted CSV cell rather than splitting into extra columns.
    expect(row).toContain('"candidate, ""VIP"""');
  });

  it('marks truncated and caps at EXPORT_LIMIT when the repository returns one extra row', async () => {
    const rows = Array.from({ length: EXPORT_LIMIT + 1 }, (_, i) => makeLog({ id: `log-${i}`, entityId: `e${i}` }));
    findForExportSpy.mockResolvedValue(rows);

    const result = await auditService.exportLogs('org-1', { format: 'json' });

    expect(result.count).toBe(EXPORT_LIMIT);
    expect(result.truncated).toBe(true);
    expect(JSON.parse(result.data)).toHaveLength(EXPORT_LIMIT);
  });

  it('does not mark truncated at exactly EXPORT_LIMIT rows', async () => {
    const rows = Array.from({ length: EXPORT_LIMIT }, (_, i) => makeLog({ id: `log-${i}`, entityId: `e${i}` }));
    findForExportSpy.mockResolvedValue(rows);

    const result = await auditService.exportLogs('org-1', { format: 'json' });

    expect(result.count).toBe(EXPORT_LIMIT);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Router — the RBAC gate change (audit:read → audit:export) is exercised
// end-to-end through a real tRPC caller, not just at the buildAccessForUser
// primitive (that primitive is already pinned by tests/access/hr-admin-matrix.test.ts).
// ---------------------------------------------------------------------------
describe('audit.exportLogs router (RBAC, behavioral)', () => {
  const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  async function makeCaller() {
    const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
    const { auditRouter } = await import('../../packages/api/src/routers/audit');
    const testRouter = router({ audit: auditRouter });
    const callerFactory = createCallerFactory(testRouter);
    return callerFactory({
      user: {
        id: 'user-1',
        organizationId: ORG_ID,
        roles: ['super_admin'],
        isPlatformOwner: false,
        impersonatorId: null,
        email: 'admin@tims.co',
        isActive: true,
      },
      headers: new Headers(),
      supabaseAuth: null,
      externalAuth: null,
    } as never) as unknown as {
      audit: {
        exportLogs(input: { format: 'csv' | 'json' }): Promise<unknown>;
      };
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogCreateMock.mockResolvedValue({});
  });

  it('denies a caller lacking audit:export with FORBIDDEN', async () => {
    buildAccessForUserMock.mockResolvedValue({ allowed: false });

    const caller = await makeCaller();
    await expect(caller.audit.exportLogs({ format: 'csv' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a caller with audit:export, calling the service and returning its result', async () => {
    buildAccessForUserMock.mockResolvedValue({ allowed: true, scope: 'organization', roles: ['super_admin'] });
    const exportLogsSpy = vi
      .spyOn(auditService, 'exportLogs')
      .mockResolvedValue({ data: 'header\n', count: 0, truncated: false, format: 'csv' });

    try {
      const caller = await makeCaller();
      const result = await caller.audit.exportLogs({ format: 'csv' });

      expect(exportLogsSpy).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ format: 'csv' }));
      expect(result).toEqual({ data: 'header\n', count: 0, truncated: false, format: 'csv' });
    } finally {
      exportLogsSpy.mockRestore();
    }
  });
});

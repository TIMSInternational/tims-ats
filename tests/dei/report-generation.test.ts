/**
 * report-generation.test.ts — real xlsx/pdf DEI report generation (dei.service.ts's
 * generateReport, backed by dei-report-builder.ts). Pattern mirrors
 * tests/audit/audit-log-export.test.ts (repository spy → service assertions → RBAC-gated
 * router caller).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import type { AccessDecision } from '../../packages/api/src/access';

vi.mock('@tims/db', () => ({
  tenantDb: {
    employeeDemographics: {
      groupBy: vi.fn(),
    },
  },
  db: {
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
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

import { deiRepository } from '../../packages/api/src/repositories/dei.repository';
import { deiService } from '../../packages/api/src/services/dei.service';

function groupByRow(key: string, field: 'ethnicity' | 'disabilityStatus', count: number) {
  return { [field]: key, _count: { _all: count } };
}

// exceljs's own .d.ts pins its `load(buffer: Buffer, ...)` param to a nominal Buffer shape that,
// under this repo's dual @types/node resolution (root vs packages/api/node_modules), TS treats as
// incompatible with the real Node Buffer instance Buffer.from(...) returns — a type-level-only
// mismatch (both are genuinely Node Buffers at runtime), narrowed via `unknown` per project
// convention rather than `any`, then re-cast to exceljs's own declared parameter type exactly.
type ExcelJsLoadBuffer = Parameters<ExcelJS.Xlsx['load']>[0];

function toExcelJsBuffer(base64: string): ExcelJsLoadBuffer {
  return Buffer.from(base64, 'base64') as unknown as ExcelJsLoadBuffer;
}

async function readXlsxSheetNames(base64: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toExcelJsBuffer(base64));
  return workbook.worksheets.map((s: ExcelJS.Worksheet) => s.name);
}

async function readXlsxSheetRows(base64: string, sheetName: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toExcelJsBuffer(base64));
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row: ExcelJS.Row) => {
    rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '')));
  });
  return rows;
}

describe('deiService.generateReport', () => {
  let ethnicitySpy: ReturnType<typeof vi.spyOn>;
  let disabilitySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ethnicitySpy = vi.spyOn(deiRepository, 'ethnicityCounts');
    disabilitySpy = vi.spyOn(deiRepository, 'disabilityCounts');
  });

  afterEach(() => {
    ethnicitySpy.mockRestore();
    disabilitySpy.mockRestore();
  });

  it('includes both sections by default (no `sections` filter passed)', async () => {
    ethnicitySpy.mockResolvedValue([groupByRow('hispanic', 'ethnicity', 10), groupByRow('white', 'ethnicity', 10)]);
    disabilitySpy.mockResolvedValue([groupByRow('none', 'disabilityStatus', 20)]);

    const result = await deiService.generateReport('org-1', { format: 'xlsx' });

    expect(result.status).toBe('ready');
    expect(result.sections).toEqual(['ethnicity', 'disability']);
  });

  it('filters to only the requested sections', async () => {
    ethnicitySpy.mockResolvedValue([groupByRow('hispanic', 'ethnicity', 10), groupByRow('white', 'ethnicity', 10)]);
    disabilitySpy.mockResolvedValue([groupByRow('none', 'disabilityStatus', 20)]);

    const result = await deiService.generateReport('org-1', { format: 'xlsx', sections: ['ethnicity'] });

    expect(result.sections).toEqual(['ethnicity']);
    expect(disabilitySpy).not.toHaveBeenCalled();
  });

  it('produces an empty-but-valid report when no requested section key matches', async () => {
    ethnicitySpy.mockResolvedValue([]);
    disabilitySpy.mockResolvedValue([]);

    const result = await deiService.generateReport('org-1', { format: 'xlsx', sections: ['does-not-exist'] });

    expect(result.sections).toEqual([]);
    expect(ethnicitySpy).not.toHaveBeenCalled();
    expect(disabilitySpy).not.toHaveBeenCalled();
    expect(Buffer.from(result.data, 'base64').length).toBeGreaterThan(0);
  });

  it('sets the correct filename/mimeType per format', async () => {
    ethnicitySpy.mockResolvedValue([]);
    disabilitySpy.mockResolvedValue([]);

    const xlsx = await deiService.generateReport('org-1', { format: 'xlsx' });
    expect(xlsx.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(xlsx.filename).toMatch(/^dei-report-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const pdf = await deiService.generateReport('org-1', { format: 'pdf' });
    expect(pdf.mimeType).toBe('application/pdf');
    expect(pdf.filename).toMatch(/^dei-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('builds a real, non-empty xlsx workbook with a sheet per section and the aggregate rows', async () => {
    ethnicitySpy.mockResolvedValue([groupByRow('hispanic', 'ethnicity', 30), groupByRow('white', 'ethnicity', 20)]);
    disabilitySpy.mockResolvedValue([
      groupByRow('none', 'disabilityStatus', 40),
      groupByRow('yes', 'disabilityStatus', 10),
    ]);

    const result = await deiService.generateReport('org-1', { format: 'xlsx' });

    const sheetNames = await readXlsxSheetNames(result.data);
    expect(sheetNames).toEqual(['Summary', 'Ethnicity Distribution', 'Disability Status Distribution']);

    const ethnicityRows = await readXlsxSheetRows(result.data, 'Ethnicity Distribution');
    // Row 1 = title, row 2 = blank, row 3 = header, row 4+ = data (count-desc order).
    expect(ethnicityRows[2]).toEqual(['Ethnicity', 'Count', 'Percentage']);
    expect(ethnicityRows[3]).toEqual(['hispanic', '30', '60%']);
    expect(ethnicityRows[4]).toEqual(['white', '20', '40%']);
  });

  it('renders a suppressed section as a k-anonymity note, not fabricated rows (min-5 floor)', async () => {
    // 3 people in one ethnicity group -> sub-floor -> the whole distribution suppresses.
    ethnicitySpy.mockResolvedValue([groupByRow('hispanic', 'ethnicity', 3), groupByRow('white', 'ethnicity', 10)]);
    disabilitySpy.mockResolvedValue([groupByRow('none', 'disabilityStatus', 20)]);

    const result = await deiService.generateReport('org-1', { format: 'xlsx' });

    const rows = await readXlsxSheetRows(result.data, 'Ethnicity Distribution');
    const flat = rows.map((r) => r.join(' ')).join(' | ');
    expect(flat).toContain('Suppressed');
    expect(flat).not.toContain('hispanic');
  });

  it('produces a real, non-empty PDF byte buffer starting with the %PDF magic header', async () => {
    ethnicitySpy.mockResolvedValue([groupByRow('hispanic', 'ethnicity', 10), groupByRow('white', 'ethnicity', 10)]);
    disabilitySpy.mockResolvedValue([groupByRow('none', 'disabilityStatus', 20)]);

    const result = await deiService.generateReport('org-1', { format: 'pdf' });
    const buffer = Buffer.from(result.data, 'base64');

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// Router — dei:export RBAC gate, exercised end-to-end through a real tRPC caller.
// ---------------------------------------------------------------------------
describe('dei.generateReport router (RBAC, behavioral)', () => {
  const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  async function makeCaller() {
    const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
    const { deiRouter } = await import('../../packages/api/src/routers/dei');
    const testRouter = router({ dei: deiRouter });
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
      dei: {
        generateReport(input: { format?: 'pdf' | 'xlsx'; sections?: string[] }): Promise<unknown>;
      };
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies a caller lacking dei:export with FORBIDDEN', async () => {
    buildAccessForUserMock.mockResolvedValue({ allowed: false });

    const caller = await makeCaller();
    await expect(caller.dei.generateReport({ format: 'pdf' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('allows a caller with dei:export, delegating to the service and returning its result', async () => {
    buildAccessForUserMock.mockResolvedValue({ allowed: true, scope: 'organization', roles: ['super_admin'] });
    const generateReportSpy = vi.spyOn(deiService, 'generateReport').mockResolvedValue({
      status: 'ready',
      format: 'pdf',
      mimeType: 'application/pdf',
      filename: 'dei-report-2026-07-31.pdf',
      data: 'ZmFrZQ==',
      sections: ['ethnicity', 'disability'],
      generatedAt: '2026-07-31T00:00:00.000Z',
    });

    try {
      const caller = await makeCaller();
      const result = await caller.dei.generateReport({ format: 'pdf' });

      expect(generateReportSpy).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ format: 'pdf' }));
      expect(result).toMatchObject({ status: 'ready', format: 'pdf', filename: 'dei-report-2026-07-31.pdf' });
    } finally {
      generateReportSpy.mockRestore();
    }
  });
});

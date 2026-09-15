// Testcontainers-only companion to TenantAuditCrossRuntimeTests. Never accepts a live target.
import { z } from 'zod';

async function main() {
  if (process.env.TIMS_AUDIT_PARITY_LOCAL !== 'true') throw new Error('Local test harness required');
  const url = new URL(z.string().parse(process.env.DATABASE_URL));
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/tims_tenant_audit') {
    throw new Error('Only the isolated tenant-audit test database is allowed');
  }
  const { db, runWithTenant } = await import('../../../packages/db/src/index');
  const { auditService } = await import('../../../packages/api/src/services/audit.service');
  const org = '11111111-1111-1111-1111-111111111111';
  const orgB = '22222222-2222-2222-2222-222222222222';
  try {
    const results = await runWithTenant(org, async () => ({
      report: await auditService.getAccessReport(org, {}),
      list: await auditService.listLogs(org, { entity: 'auth', take: 25 }),
      foreignList: await auditService.listLogs(org, { entity: 'foreign-only', take: 25 }),
      excludedCursor: await auditService.listLogs(org, {
        action: 'access',
        take: 25,
        cursor: 'd0000000-0000-0000-0000-000000000007',
      }),
      detail: await auditService.getLogDetail(org, 'd0000000-0000-0000-0000-000000000001'),
      redactedActor: await auditService.getLogDetail(org, 'd0000000-0000-0000-0000-000000000006'),
      history: await auditService.getChangesByEntity(org, { entity: 'auth', entityId: 'record-1', take: 25 }),
      listFirst: await auditService.listLogs(org, { entity: 'cross-page', take: 1 }),
      historyFirst: await auditService.getChangesByEntity(org, {
        entity: 'cross-page',
        entityId: 'cross-page',
        take: 1,
      }),
      listMiddle: await auditService.listLogs(org, {
        entity: 'cross-page',
        take: 1,
        cursor: 'd0000000-0000-0000-0000-000000000015',
      }),
      historyMiddle: await auditService.getChangesByEntity(org, {
        entity: 'cross-page',
        entityId: 'cross-page',
        take: 1,
        cursor: 'd0000000-0000-0000-0000-000000000015',
      }),
      listLast: await auditService.listLogs(org, {
        entity: 'cross-page',
        take: 1,
        cursor: 'd0000000-0000-0000-0000-000000000014',
      }),
      historyLast: await auditService.getChangesByEntity(org, {
        entity: 'cross-page',
        entityId: 'cross-page',
        take: 1,
        cursor: 'd0000000-0000-0000-0000-000000000014',
      }),
      csv: await auditService.exportLogs(org, { entity: 'csv-probe', format: 'csv' }),
      json: await auditService.exportLogs(org, { entity: 'csv-probe', format: 'json' }),
      dated: await auditService.exportLogs(org, {
        action: 'login_failed',
        dateFrom: new Date('2026-07-20T10:00:00Z'),
        dateTo: new Date('2026-07-20T10:00:00Z'),
        format: 'json',
      }),
    }));
    const truncated = await runWithTenant(orgB, () =>
      auditService.exportLogs(orgB, { entity: 'export-cap', format: 'json' }),
    );
    process.stdout.write(JSON.stringify({ ...results, truncated }));
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write('Tenant audit TypeScript parity query failed\n');
  process.exitCode = 1;
});

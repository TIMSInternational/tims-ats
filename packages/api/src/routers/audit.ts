import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { auditService } from '../services/audit.service';
import { logPlatformExport } from '../access/security-audit';

export const auditRouter = router({
  // List logs with cursor pagination and filters
  listLogs: permissionProcedure('audit', 'read')
    .input(
      z.object({
        userId: z.string().uuid().optional(),
        entity: z.string().max(200).optional(),
        action: z.string().max(200).optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        take: z.number().min(1).max(100).default(25),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) => auditService.listLogs(ctx.user.organizationId, input)),

  // Get single log detail
  getLogDetail: permissionProcedure('audit', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => auditService.getLogDetail(ctx.user.organizationId, input.id)),

  // Export logs — tenant-scoped CSV/JSON export, gated on audit:export.
  exportLogs: permissionProcedure('audit', 'export')
    .input(
      z.object({
        format: z.enum(['csv', 'json']),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        actorId: z.string().uuid().optional(),
        entity: z.string().max(200).optional(),
        action: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await auditService.exportLogs(ctx.user.organizationId, input);
      logPlatformExport(ctx, {
        resource: 'audit_log',
        count: result.count,
        format: result.format,
        truncated: result.truncated,
      });
      return result;
    }),

  // Access report — who accessed what
  getAccessReport: permissionProcedure('audit', 'read')
    .input(
      z.object({
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
      }),
    )
    .query(({ ctx, input }) => auditService.getAccessReport(ctx.user.organizationId, input)),

  // Changes by entity — history of changes to a specific record
  getChangesByEntity: permissionProcedure('audit', 'read')
    .input(
      z.object({
        entity: z.string().max(200),
        entityId: z.string().max(200),
        take: z.number().min(1).max(100).default(25),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) => auditService.getChangesByEntity(ctx.user.organizationId, input)),
});

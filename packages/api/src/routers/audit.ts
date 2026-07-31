import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { tenantDb as db } from '@tims/db';
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
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        organizationId: ctx.user.organizationId,
      };
      if (input.userId) where.actorId = input.userId;
      if (input.entity) where.entity = input.entity;
      if (input.action) where.action = input.action;
      if (input.dateFrom || input.dateTo) {
        where.createdAt = {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        };
      }

      const items = await db.auditLog.findMany({
        where,
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),

  // Get single log detail
  getLogDetail: permissionProcedure('audit', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return db.auditLog.findFirstOrThrow({
        where: { id: input.id, organizationId: ctx.user.organizationId },
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
    }),

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
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        organizationId: ctx.user.organizationId,
        action: 'access',
      };
      if (input.dateFrom || input.dateTo) {
        where.createdAt = {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        };
      }

      const logs = await db.auditLog.groupBy({
        by: ['actorId', 'entity'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 50,
      });

      return logs;
    }),

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
    .query(async ({ ctx, input }) => {
      const items = await db.auditLog.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          entity: input.entity,
          entityId: input.entityId,
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: {
          actor: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const hasMore = items.length > input.take;
      return {
        items: items.slice(0, input.take),
        nextCursor: hasMore ? items[input.take - 1]!.id : undefined,
      };
    }),
});

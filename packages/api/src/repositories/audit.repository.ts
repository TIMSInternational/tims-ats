import { tenantDb as db } from '@tims/db';
import type { Prisma } from '@tims/db';

// ---------------------------------------------------------------------------
// Audit Repository — only place that imports db for audit-log export queries.
// ---------------------------------------------------------------------------

export interface AuditExportFilters {
  dateFrom?: Date;
  dateTo?: Date;
  actorId?: string;
  entity?: string;
  action?: string;
}

export interface AuditLogListFilters {
  userId?: string;
  entity?: string;
  action?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AuditAccessReportFilters {
  dateFrom?: Date;
  dateTo?: Date;
}

// Explicit select — deliberately EXCLUDES `changes`/`metadata` (may carry
// business-sensitive payloads not meant for bulk CSV/JSON export), mirroring the
// truncated-flag pattern candidate.repository.ts's `findForExport` uses for pool
// export (packages/api/src/services/candidate.service.ts:332-374).
export const auditRepository = {
  async findForExport(orgId: string, filters: AuditExportFilters, limit: number) {
    const where: Prisma.AuditLogWhereInput = { organizationId: orgId };
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entity) where.entity = filters.entity;
    if (filters.action) where.action = filters.action;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    return db.auditLog.findMany({
      where,
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: {
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
      },
    });
  },

  // Moved verbatim from routers/audit.ts `listLogs` — same where/include/orderBy/
  // cursor pagination, no behavior change.
  async findLogs(orgId: string, filters: AuditLogListFilters, take: number, cursor?: string) {
    const where: Prisma.AuditLogWhereInput = { organizationId: orgId };
    if (filters.userId) where.actorId = filters.userId;
    if (filters.entity) where.entity = filters.entity;
    if (filters.action) where.action = filters.action;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    return db.auditLog.findMany({
      where,
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      // Explicit select (not bare `include`) — same fields a bare `include`
      // would have returned (all scalars + `actor`), just enumerated so this
      // satisfies the repo's "no findMany/findFirst without explicit select"
      // rule with zero behavior change.
      select: {
        id: true,
        organizationId: true,
        userId: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        changes: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  // Moved verbatim from routers/audit.ts `getLogDetail`, with bare `include`
  // converted to an equivalent explicit `select` (see findLogs comment above).
  async findLogDetail(orgId: string, id: string) {
    return db.auditLog.findFirstOrThrow({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        changes: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  },

  // Moved verbatim from routers/audit.ts `getAccessReport`.
  async findAccessReport(orgId: string, filters: AuditAccessReportFilters) {
    const where: Prisma.AuditLogWhereInput = { organizationId: orgId, action: 'access' };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
        ...(filters.dateTo ? { lte: filters.dateTo } : {}),
      };
    }

    return db.auditLog.groupBy({
      by: ['actorId', 'entity'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 50,
    });
  },

  // Moved verbatim from routers/audit.ts `getChangesByEntity`, with bare
  // `include` converted to an equivalent explicit `select` (see findLogs
  // comment above).
  async findChangesByEntity(orgId: string, entity: string, entityId: string, take: number, cursor?: string) {
    return db.auditLog.findMany({
      where: {
        organizationId: orgId,
        entity,
        entityId,
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        organizationId: true,
        userId: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        changes: true,
        metadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};

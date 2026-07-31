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
};

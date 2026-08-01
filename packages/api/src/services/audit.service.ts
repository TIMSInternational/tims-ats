import { csvRow } from '@tims/shared';
import {
  auditRepository,
  type AuditExportFilters,
  type AuditLogListFilters,
  type AuditAccessReportFilters,
} from '../repositories/audit.repository';

// ---------------------------------------------------------------------------
// Audit Service — business logic only, no db imports.
// ---------------------------------------------------------------------------

const EXPORT_LIMIT = 10_000;

export const auditService = {
  // Moved verbatim from routers/audit.ts `listLogs` — cursor/hasMore pagination
  // logic unchanged, now sourced from auditRepository.findLogs.
  async listLogs(orgId: string, input: AuditLogListFilters & { take: number; cursor?: string }) {
    const { take, cursor, ...filters } = input;
    const items = await auditRepository.findLogs(orgId, filters, take, cursor);
    const hasMore = items.length > take;
    return {
      items: items.slice(0, take),
      nextCursor: hasMore ? items[take - 1]!.id : undefined,
    };
  },

  // Moved verbatim from routers/audit.ts `getLogDetail`.
  async getLogDetail(orgId: string, id: string) {
    return auditRepository.findLogDetail(orgId, id);
  },

  // Moved verbatim from routers/audit.ts `getAccessReport`.
  async getAccessReport(orgId: string, filters: AuditAccessReportFilters) {
    return auditRepository.findAccessReport(orgId, filters);
  },

  // Moved verbatim from routers/audit.ts `getChangesByEntity` — cursor/hasMore
  // pagination logic unchanged, now sourced from auditRepository.findChangesByEntity.
  async getChangesByEntity(orgId: string, input: { entity: string; entityId: string; take: number; cursor?: string }) {
    const { entity, entityId, take, cursor } = input;
    const items = await auditRepository.findChangesByEntity(orgId, entity, entityId, take, cursor);
    const hasMore = items.length > take;
    return {
      items: items.slice(0, take),
      nextCursor: hasMore ? items[take - 1]!.id : undefined,
    };
  },

  async exportLogs(orgId: string, input: AuditExportFilters & { format: 'csv' | 'json' }) {
    const { format, ...filters } = input;
    const rows = await auditRepository.findForExport(orgId, filters, EXPORT_LIMIT);
    const truncated = rows.length > EXPORT_LIMIT;
    const page = truncated ? rows.slice(0, EXPORT_LIMIT) : rows;

    const records = page.map((log) => ({
      timestamp: log.createdAt.toISOString(),
      actorName: log.actor ? `${log.actor.firstName} ${log.actor.lastName}`.trim() : '',
      actorEmail: log.actor?.email ?? '',
      action: log.action,
      entity: log.entity,
      entityId: log.entityId ?? '',
      ipAddress: log.ipAddress ?? '',
      userAgent: log.userAgent ?? '',
    }));

    const data =
      format === 'json'
        ? JSON.stringify(records)
        : [
            csvRow([
              'Timestamp',
              'Actor Name',
              'Actor Email',
              'Action',
              'Entity',
              'Entity ID',
              'IP Address',
              'User Agent',
            ]),
            ...records.map((r) =>
              csvRow([
                r.timestamp,
                r.actorName,
                r.actorEmail,
                r.action,
                r.entity,
                r.entityId,
                r.ipAddress,
                r.userAgent,
              ]),
            ),
          ].join('\n');

    return { data, count: page.length, truncated, format };
  },
};

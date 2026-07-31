import { csvRow } from '@tims/shared';
import { auditRepository, type AuditExportFilters } from '../repositories/audit.repository';

// ---------------------------------------------------------------------------
// Audit Service — business logic only, no db imports.
// ---------------------------------------------------------------------------

const EXPORT_LIMIT = 10_000;

export const auditService = {
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

'use client';

// C#-only cross-org audit-log read (Phase-5 Slice 17). The TS tRPC procedures
// (`platform.getCrossOrgAuditLogs` / `platform.exportAuditLogsCsv`,
// packages/api/src/routers/platform/system.ts) have been deleted — there is no TS fallback
// path left. NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP is confirmed live in prod (2026-07-31) and
// local dev's .env.local mirrors production values directly, so this file calls the C# service
// unconditionally rather than gating on the flag.
//
// PLATFORM-OWNER-ONLY, cross-org, non-tenant-scoped surface. ONE FE call site
// (apps/web/app/(admin)/platform/audit/page.tsx) never passes `cursor` or `userId`, so
// `useAuditLogs` below is scoped to exactly the filters that call site uses
// (action/entity/organizationId/dateFrom/dateTo/limit).
//
// UNTYPED RESPONSE BODIES — neither `/audit/logs` nor `/audit/logs/export` has a
// `.Produces<T>()` on its C# minimal-API mapping (both return anonymous objects), so the
// generated OpenAPI contract has no typed 200 body for either path and the normal
// `platformGet<P extends GetPaths>` can't accept them. Both hooks below use the
// `platformGetRaw` escape hatch instead and hand-type the response, mirroring how
// `packages/api/src/services/external-assessment.service.ts` handles the SAME gap server-side
// for `external.getAssessmentResults`.
//
// METADATA WIRE QUIRK — the C# `AuditLogListItem.Metadata` is a plain `string?` (EF reads the
// jsonb column's raw text via a `string`-typed property, see AuditReadDbContext.cs), so on the
// wire `metadata` is a JSON-ENCODED STRING ("{\"foo\":\"bar\"}"), not a nested object. The
// deleted tRPC output typed `metadata` as `Prisma.JsonValue | null` (a real parsed value); this
// wrapper `JSON.parse`s the non-null string to match that same shape (hand-typed as `unknown`
// below now that there is no tRPC router to infer it from).

import { useQuery } from '@tanstack/react-query';
import { platformGetRaw } from './client';

const num = (v: number | string): number => Number(v);

export interface AuditLogsFilters {
  action?: string;
  entity?: string;
  organizationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
}

interface AuditLogActor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
}

export interface AuditLogItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  metadata: unknown;
  createdAt: Date;
  ipAddress: string | null;
  actor: AuditLogActor | null;
}

export interface AuditLogsOutput {
  logs: AuditLogItem[];
  nextCursor: string | undefined;
  total: number;
}

export interface AuditLogsExportOutput {
  format: 'csv' | 'json';
  data: string;
  count: number;
}

interface RawAuditLogItem {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  userId: string | null;
  metadata: string | null;
  createdAt: string;
  ipAddress: string | null;
  actor: AuditLogActor | null;
}

interface RawAuditLogsList {
  logs: RawAuditLogItem[];
  nextCursor: string | null;
  total: number | string;
}

function mapRawAuditLogItem(raw: RawAuditLogItem): AuditLogItem {
  return {
    id: raw.id,
    action: raw.action,
    entity: raw.entity,
    entityId: raw.entityId,
    userId: raw.userId,
    metadata: raw.metadata == null ? null : JSON.parse(raw.metadata),
    createdAt: new Date(raw.createdAt),
    ipAddress: raw.ipAddress,
    actor: raw.actor,
  };
}

/**
 * PLATFORM-OWNER cross-org list (1 call site: platform/audit/page.tsx). GET /audit/logs
 * (metadata JSON.parse'd from its wire string form; total coerced; nextCursor null →
 * undefined to match the deleted tRPC output's optional-not-nullable field).
 */
export function useAuditLogs(filters: AuditLogsFilters) {
  return useQuery<AuditLogsOutput>({
    queryKey: ['platform-api', 'audit-log', 'logs', filters],
    // placeholderData keeps the previous page's rows on screen while a filter/page change is
    // in flight (the call site's pagination UX).
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const raw = (await platformGetRaw('/audit/logs', {
        action: filters.action,
        entity: filters.entity,
        organizationId: filters.organizationId,
        dateFrom: filters.dateFrom?.toISOString(),
        dateTo: filters.dateTo?.toISOString(),
        take: filters.limit,
      })) as RawAuditLogsList;
      return {
        logs: raw.logs.map(mapRawAuditLogItem),
        nextCursor: raw.nextCursor ?? undefined,
        total: num(raw.total),
      };
    },
  });
}

/**
 * PLATFORM-OWNER CSV/JSON export (1 call site: platform/audit/page.tsx's handleExport, invoked
 * imperatively on a button click — not a `useQuery`). Returns an async function so the call
 * site's `await fetchExport(...)` usage is unchanged. GET /audit/logs/export (count coerced).
 */
export function useAuditLogsExport() {
  return async (filters: {
    format: 'csv' | 'json';
    organizationId?: string;
    action?: string;
    entity?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<AuditLogsExportOutput> => {
    const raw = (await platformGetRaw('/audit/logs/export', {
      format: filters.format,
      organizationId: filters.organizationId,
      action: filters.action,
      entity: filters.entity,
      dateFrom: filters.dateFrom?.toISOString(),
      dateTo: filters.dateTo?.toISOString(),
    })) as { format: 'csv' | 'json'; data: string; count: number | string };
    return { format: raw.format, data: raw.data, count: num(raw.count) };
  };
}

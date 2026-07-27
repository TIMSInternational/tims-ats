'use client';

// Per-surface read gate for the cross-org audit-log surface (Phase-5 Slice 17) — the C# port of
// `platform.getCrossOrgAuditLogs`/`exportAuditLogsCsv`. DARK by default: unless BOTH the
// platform-api base URL and NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP are set at deploy time, every
// hook returns the existing tRPC query unchanged (byte-identical to today). Merging changes
// nothing in prod until Federico flips the flag at cutover.
//
// SCOPE — only `getCrossOrgAuditLogs` and `exportAuditLogsCsv` are ported (both live behind
// `Platform:AuditLogReadEnabled`, platform-owner-only via PlatformOwnerGate). The ONE FE call
// site (apps/web/app/(admin)/platform/audit/page.tsx) never passes `cursor` or `userId`, so
// `useAuditLogs` below is scoped to exactly the filters that call site uses
// (action/entity/organizationId/dateFrom/dateTo/limit) — matching the "wrap only what's
// consumed, with the exact input shape used" precedent from every other wrapper this migration.
//
// UNTYPED RESPONSE BODIES — unlike every other ported surface, NEITHER `/audit/logs` nor
// `/audit/logs/export` has a `.Produces<T>()` on its C# minimal-API mapping (both return
// anonymous objects), so the generated OpenAPI contract has no typed 200 body for either path
// and the normal `platformGet<P extends GetPaths>` can't accept them. Both hooks below use the
// `platformGetRaw` escape hatch instead and hand-type the response, mirroring how
// `packages/api/src/services/external-assessment.service.ts` handles the SAME gap server-side
// for `external.getAssessmentResults`.
//
// METADATA WIRE QUIRK — the C# `AuditLogListItem.Metadata` is a plain `string?` (EF reads the
// jsonb column's raw text via a `string`-typed property, see AuditReadDbContext.cs), so on the
// wire `metadata` is a JSON-ENCODED STRING ("{\"foo\":\"bar\"}"), not a nested object — UNLIKE
// every jsonb column this migration has wrapped so far (which pass through as JsonNode/object).
// The tRPC output types `metadata` as `Prisma.JsonValue | null` (a real parsed value), so this
// wrapper explicitly `JSON.parse`s the non-null string to match.

import { useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGetRaw } from './client';

type RouterOutput = inferRouterOutputs<AppRouter>;
type AuditLogsOutput = RouterOutput['platform']['getCrossOrgAuditLogs'];
type AuditLogsExportOutput = RouterOutput['platform']['exportAuditLogsCsv'];
type AuditLogItem = AuditLogsOutput['logs'][number];

// Second gate: even when the client is enabled, audit-log only routes to C# when its own flag
// is exactly 'true'. NEXT_PUBLIC_* so it is inlined for the browser.
const AUDIT_LOG_VIA_CSHARP = process.env.NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP === 'true';

const num = (v: number | string): number => Number(v);

export interface AuditLogsFilters {
  action?: string;
  entity?: string;
  organizationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
}

interface RawAuditLogActor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
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
  actor: RawAuditLogActor | null;
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
  } as AuditLogItem;
}

/**
 * PLATFORM-OWNER cross-org list (1 call site: platform/audit/page.tsx). Gate:
 * `isPlatformApiEnabled() && NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP === 'true'`.
 *  - true  → GET /audit/logs (metadata JSON.parse'd from its wire string form; total coerced;
 *            nextCursor null → undefined to match the tRPC output's optional-not-nullable field).
 *  - false → trpc.platform.getCrossOrgAuditLogs.useQuery(filters) (the DEFAULT).
 */
export function useAuditLogs(filters: AuditLogsFilters) {
  const viaCSharp = isPlatformApiEnabled() && AUDIT_LOG_VIA_CSHARP;

  // placeholderData keeps the previous page's rows on screen while a filter/page change is
  // in flight (the call site's pagination UX) — preserved on BOTH paths, matching the original
  // trpc.useQuery(..., { placeholderData: (prev) => prev }) call it replaces.
  const trpcQuery = trpc.platform.getCrossOrgAuditLogs.useQuery(filters, {
    enabled: !viaCSharp,
    placeholderData: (prev) => prev,
  });

  const csharpQuery = useQuery<AuditLogsOutput>({
    queryKey: ['platform-api', 'audit-log', 'logs', filters],
    enabled: viaCSharp,
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

  return viaCSharp ? csharpQuery : trpcQuery;
}

/**
 * PLATFORM-OWNER CSV/JSON export (1 call site: platform/audit/page.tsx's handleExport, invoked
 * imperatively via `utils.platform.exportAuditLogsCsv.fetch(...)` on a button click — not a
 * `useQuery`). Returns an async function with the same shape so the call site's `await
 * fetchExport(...)` usage is unchanged. Gate as above.
 *  - true  → GET /audit/logs/export (count coerced).
 *  - false → the existing `utils.platform.exportAuditLogsCsv.fetch(...)` (the DEFAULT).
 */
export function useAuditLogsExport() {
  const utils = trpc.useUtils();
  const viaCSharp = isPlatformApiEnabled() && AUDIT_LOG_VIA_CSHARP;

  return async (filters: {
    format: 'csv' | 'json';
    organizationId?: string;
    action?: string;
    entity?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<AuditLogsExportOutput> => {
    if (viaCSharp) {
      const raw = (await platformGetRaw('/audit/logs/export', {
        format: filters.format,
        organizationId: filters.organizationId,
        action: filters.action,
        entity: filters.entity,
        dateFrom: filters.dateFrom?.toISOString(),
        dateTo: filters.dateTo?.toISOString(),
      })) as { format: 'csv' | 'json'; data: string; count: number | string };
      return { format: raw.format, data: raw.data, count: num(raw.count) } as AuditLogsExportOutput;
    }
    return utils.platform.exportAuditLogsCsv.fetch(filters);
  };
}

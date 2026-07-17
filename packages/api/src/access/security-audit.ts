import { TRPCError } from '@trpc/server';
import { db, Prisma } from '@tims/db';

/**
 * CB-1c — security-event audit coverage.
 *
 * A thin, FAIL-SOFT writer for SECURITY events (authN/authZ failures, privileged
 * actions) into the (now append-only, CB-1b) `audit_logs` table. Distinct from
 * `logDataAccess` (sensitive-READ logging into `data_access_logs`, fail-CLOSED for
 * restricted classes): a lost security-audit row must NEVER block auth, change a
 * 403, or fail a mutation — so this is always fail-soft.
 *
 * Uses the PRIVILEGED `db` (not `tenantDb`): security events can be pre-tenant or
 * cross-org, and the organizationId is set explicitly on every row.
 *
 * NOTE (parity with the existing convention): `metadata` is written as a RAW Prisma
 * `Json` OBJECT, NOT a JSON string. Every existing writer (recordBillingAudit, the
 * platform routers, the old withAudit middleware) stores a jsonb object, and the
 * health dashboard reads it back as an object (`platform/system.ts` `meta?.message`).
 * Stringifying here would silently break that read.
 */
export interface SecurityEvent {
  /** REQUIRED — audit_logs.organizationId is NOT-NULL with an FK to organizations. */
  organizationId: string;
  /** The acting principal: impersonator ?? user; null for anonymous/external events. */
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logSecurityEvent(e: SecurityEvent): Promise<void> {
  // Resolve-or-skip: audit_logs.organizationId is NOT-NULL with an FK. A missing/
  // empty org (org-less platform owner, unresolved principal) can't be written —
  // skip rather than issue an insert that the FK rejects. Centralized here so every
  // caller (observers + inline writers) is safe.
  if (!e.organizationId) return;
  try {
    await db.auditLog.create({
      data: {
        organizationId: e.organizationId,
        actorId: e.actorId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        // Raw jsonb object (see NOTE above) — never JSON.stringify.
        metadata: e.metadata ? (e.metadata as Prisma.InputJsonObject) : undefined,
        ipAddress: e.ipAddress ?? null,
        userAgent: e.userAgent ?? null,
      },
    });
  } catch {
    // fail-SOFT: a lost security-audit row must never block auth or a mutation.
  }
}

/**
 * Run a fire-and-forget observer body so it can NEVER throw into a live request
 * path. The observers below build their event args (reading ctx.headers, etc.)
 * BEFORE the fail-soft boundary inside `logSecurityEvent`; wrapping the whole body
 * guarantees the load-bearing transparency property (an observer must never convert
 * a 403 into a 500, nor break a mutation) holds even if arg construction throws.
 */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* observers must never throw into a live request path */
  }
}

/** The minimal request-context shape the observers read. */
export interface SecurityAuditCtx {
  user?: { id: string; organizationId?: string | null; impersonatorId?: string | null } | null;
  headers: Headers;
}

function ipOf(headers: Headers): string | null {
  return headers.get('x-forwarded-for') || headers.get('x-real-ip');
}

/**
 * Observe a tRPC rejection and, if it is a STAFF authZ/authN DENIAL, record an
 * `authz_denied` security event — fail-soft, fire-and-forget, non-throwing. Invoked
 * from the TRANSPARENT error-observing middleware (trpc.ts `withSecurityAudit`),
 * which inspects `MiddlewareResult.ok` and returns the result UNCHANGED.
 *
 * Resolve-or-SKIP on the org FK (via logSecurityEvent). External API-key denials are
 * observed separately (observeExternalDenial) because the key's org is established by
 * downstream middleware and is not on the base-context `ctx.user`.
 */
export function observeDenial(args: { error: unknown; path: string; ctx: SecurityAuditCtx }): void {
  safe(() => {
    const { error, path, ctx } = args;
    if (!(error instanceof TRPCError)) return;
    if (error.code !== 'FORBIDDEN' && error.code !== 'UNAUTHORIZED') return;
    const organizationId = ctx.user?.organizationId;
    if (!organizationId) return; // resolve-or-skip (e.g. unauthenticated: no org)
    void logSecurityEvent({
      organizationId,
      actorId: ctx.user?.impersonatorId ?? ctx.user?.id ?? null,
      action: 'authz_denied',
      entity: `trpc:${path}`,
      metadata: { code: error.code },
      ipAddress: ipOf(ctx.headers),
      userAgent: ctx.headers.get('user-agent'),
    });
  });
}

/**
 * Observe a denial on the EXTERNAL (API-key) surface, where the org is resolved from
 * the key (ctx.externalAuth), not ctx.user. Called at the `requireExternalPermission`
 * throw sites, where `organizationId` is always known. Non-throwing, fail-soft.
 */
export function observeExternalDenial(args: {
  organizationId: string;
  apiKeyId: string;
  path: string;
  reason: 'scope' | 'grant';
  requiredScope?: string;
  headers: Headers;
}): void {
  safe(() => {
    void logSecurityEvent({
      organizationId: args.organizationId,
      actorId: null, // the principal is an API key, not a user
      action: 'authz_denied',
      entity: `trpc:${args.path}`,
      metadata: {
        code: 'FORBIDDEN',
        principal: 'api_key',
        apiKeyId: args.apiKeyId,
        reason: args.reason,
        ...(args.requiredScope ? { requiredScope: args.requiredScope } : {}),
      },
      ipAddress: ipOf(args.headers),
      userAgent: args.headers.get('user-agent'),
    });
  });
}

/**
 * Record a platform-owner data EXPORT (data egress — a SOC 2 CC7.2 / ISO A.8.16
 * signal). Fail-soft, fire-and-forget, non-throwing. Attributes the row to the
 * exported target org when the export is org-filtered, else the actor's own org.
 *
 * ⚠️ KNOWN LIMITATION: a truly GLOBAL cross-org export (all-org catalogs) by an
 * org-less platform owner has no single org to satisfy the NOT-NULL FK and is
 * SKIPPED. Faithful per-tenant attribution of global platform actions needs
 * `audit_logs` to become FK-less (the CB-1b recommended follow-up) — tracked there.
 */
export function logPlatformExport(
  ctx: SecurityAuditCtx,
  info: { resource: string; count: number; format?: string; targetOrgId?: string | null },
): void {
  safe(() => {
    const organizationId = info.targetOrgId || ctx.user?.organizationId;
    if (!organizationId) return; // resolve-or-skip (global export by an org-less owner)
    void logSecurityEvent({
      organizationId,
      actorId: ctx.user?.impersonatorId ?? ctx.user?.id ?? null,
      action: 'platform_export',
      entity: `export:${info.resource}`,
      metadata: {
        resource: info.resource,
        count: info.count,
        ...(info.format ? { format: info.format } : {}),
        ...(info.targetOrgId ? { targetOrgId: info.targetOrgId } : {}),
      },
      ipAddress: ipOf(ctx.headers),
      userAgent: ctx.headers.get('user-agent'),
    });
  });
}

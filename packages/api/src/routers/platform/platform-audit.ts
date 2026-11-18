// ---------------------------------------------------------------------------
// Audit rows for platform-owner mutations (platform-owner access-6)
// ---------------------------------------------------------------------------
// platformProcedure carries no generic audit middleware, so every owner mutation that changes who can get
// in (invitations, the owner allowlist) writes its own `audit_logs` row through this helper. Fail-soft like
// every security-event writer (a lost audit row must never fail the mutation), and awaited so the row is
// written before the response.
//
// `audit_logs.organization_id` is NOT NULL with an FK: the row goes to the affected organization when there
// is one, else to the operator's own organization. An org-less operator acting on a global object (the
// owner allowlist) has neither; that event is written to the structured log instead (same limitation as
// logPlatformExport, tracked with the audit_logs FK follow-up).

import { logger } from '@tims/shared';
import { logSecurityEvent } from '../../access/security-audit';
import { clientIpFrom } from '../../lib/client-ip';

export interface PlatformAuditCtx {
  user: { id: string; organizationId?: string | null; impersonatorId?: string | null };
  headers: Headers;
}

export interface PlatformAuditEntry {
  /** The organization the change affects; falls back to the operator's own. */
  organizationId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordPlatformAudit(ctx: PlatformAuditCtx, entry: PlatformAuditEntry): Promise<void> {
  const actorId = ctx.user.impersonatorId ?? ctx.user.id;
  const organizationId = entry.organizationId || ctx.user.organizationId;
  if (!organizationId) {
    // No PII here: the action, entity and actor are enough to find the change.
    logger.warn(
      { action: entry.action, entity: entry.entity, entityId: entry.entityId ?? null, actorId },
      'Platform-owner action had no organization for audit_logs — recorded here instead',
    );
    return;
  }
  await logSecurityEvent({
    organizationId,
    actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata,
    ipAddress: clientIpFrom(ctx.headers),
    userAgent: ctx.headers.get('user-agent'),
  });
}

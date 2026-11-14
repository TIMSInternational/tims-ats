'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { usePermissions } from '../../../../lib/permissions';
import { isHrefHiddenInScope } from '../../../../lib/launch-scope';
import { TEXT_LINK_CLASSES } from '../../../../components';

// Change history lives in the tenant audit log (/settings/audit-log). Tenant integration health is not
// monitored (integration.getSystemHealth reports 'unmonitored', #323), so no health card is shown rather
// than an empty one. The link is offered only to a role that can open the audit log (route module 'audit',
// lib/nav/routes.ts) and only when the pilot scope does not hide it (settings-check-04).

const AUDIT_LOG_HREF = '/settings/audit-log';

export function AuditLogLink() {
  const { t } = useI18n();
  const { can } = usePermissions();
  if (!can('audit', 'read') || isHrefHiddenInScope(AUDIT_LOG_HREF)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout text-secondary">
      {t.integrations.auditHint}
      <Link href={AUDIT_LOG_HREF} className={TEXT_LINK_CLASSES}>
        {t.integrations.viewAuditLog}
      </Link>
    </p>
  );
}

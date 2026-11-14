'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { TEXT_LINK_CLASSES } from '../../../../components';

// Change history lives in the tenant audit log (/settings/audit-log). Tenant integration health is not
// monitored (integration.getSystemHealth reports 'unmonitored', #323), so no health card is shown rather
// than an empty one.

export function AuditLogLink() {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-callout text-secondary">
      {t.integrations.auditHint}
      <Link href="/settings/audit-log" className={TEXT_LINK_CLASSES}>
        {t.integrations.viewAuditLog}
      </Link>
    </p>
  );
}

'use client';

import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { formatRelativeTimeLocale, getAvatarColor, getInitials } from '../../../../../../lib/format-utils';
import { EmptyState, ErrorState, Skeleton, StatusBadge, TEXT_LINK_CLASSES } from '../../../../../../components';
import type { StatusTone } from '../../../../../../components';

const ACTION_TONE: Record<string, StatusTone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  LOGIN: 'brand',
  LOGOUT: 'neutral',
  INVITE: 'brand',
  SUSPEND: 'danger',
  ACTIVATE: 'success',
  authz_denied: 'warning',
};

const CARD = 'rounded-xl bg-white shadow-card';

export function ActivitySection({ organizationId }: { organizationId: string }) {
  const { t, locale } = useI18n();
  const o = t.organizations;
  const actionLabels: Record<string, string> = o.auditActions;
  const { data: logs, isLoading, isError, refetch } = trpc.platform.getOrgAuditLogs.useQuery({ organizationId });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-subheading font-semibold text-primary">{o.orgRecentActivity}</h2>
        <Link href="/platform/audit" className={`${TEXT_LINK_CLASSES} text-body`}>
          {o.viewFullAudit}
          <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {isLoading ? (
        <div className={`${CARD} space-y-4 p-5`} aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-3 w-40 flex-1" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className={CARD}>
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !logs || logs.length === 0 ? (
        <div className={CARD}>
          <EmptyState title={o.orgNoRecentActivity} />
        </div>
      ) : (
        <ul className={`${CARD} divide-y divide-border overflow-hidden`}>
          {logs.map((log, idx) => {
            const actorName = log.actor
              ? `${log.actor.firstName || ''} ${log.actor.lastName || ''}`.trim() || log.actor.email
              : t.audit.system;
            return (
              <li key={log.id ?? idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-surface-hover md:px-5">
                <div className="flex min-w-0 items-center gap-2 sm:w-64">
                  <div className={`flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold text-white ${getAvatarColor(actorName)}`} aria-hidden="true">
                    {getInitials(actorName)}
                  </div>
                  <span className="min-w-0 truncate text-body text-primary">{actorName}</span>
                  <span className="shrink-0 text-callout text-secondary">
                    {log.createdAt ? formatRelativeTimeLocale(log.createdAt, locale) : '\u2014'}
                  </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <StatusBadge tone={ACTION_TONE[log.action] ?? 'neutral'} icon="none">
                    {actionLabels[log.action] ?? log.action}
                  </StatusBadge>
                  <span className="text-callout text-secondary">{log.entity || '\u2014'}</span>
                  {log.entityId && <span className="min-w-0 break-all text-caption text-muted">{log.entityId}</span>}
                  {log.ipAddress && <span className="font-mono text-caption text-muted">{log.ipAddress}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

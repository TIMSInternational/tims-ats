'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardAttentionItems } from '../../../lib/platform-api/dashboard';
import { SEVERITY_CONFIG, Skeleton } from './dashboard-utils';
import { useI18n } from '../../../lib/i18n';
import { formatMessage, pluralize } from '../../../lib/i18n/format';
import { ErrorState } from '../../../components';
import { Button } from '../../../components/button';
import { StatusBadge } from '../../../components/status-badge';

const INVITATIONS_URL = '/platform/invitations';

const SEVERITY_DOT: Record<string, string> = { danger: 'bg-danger', warning: 'bg-warning', info: 'bg-info' };

function WarningIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

export function AttentionBar() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useDashboardAttentionItems();
  const [collapsed, setCollapsed] = useState(false);
  const listId = useId();

  if (isLoading) {
    return (
      <div className="mb-5 rounded-xl border border-border bg-white p-4" aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <div className="flex items-center gap-3">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mb-5 rounded-xl border border-border bg-white">
        <ErrorState size="compact" onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const criticalCount = data.filter((item) => item.severity === 'critical').length;
  const hasCritical = criticalCount > 0;
  const frame = hasCritical ? 'border-danger/30 bg-danger-bg' : 'border-warning/30 bg-warning-bg';

  return (
    <section aria-labelledby={`${listId}-title`} className={`mb-5 overflow-hidden rounded-xl border ${frame}`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <WarningIcon className={`size-5 shrink-0 ${hasCritical ? 'text-danger' : 'text-warning'}`} />
          <h2 id={`${listId}-title`} className="text-subheading font-semibold text-primary">
            {pluralize(data.length, { one: d.attentionCountOne, other: d.attentionCountOther }, locale)}
          </h2>
          {hasCritical && (
            <StatusBadge tone="danger">{formatMessage(d.criticalCount, { count: criticalCount })}</StatusBadge>
          )}
        </div>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={listId}
        >
          {collapsed ? d.expand : d.collapse}
        </Button>
      </div>

      {/* Items */}
      {!collapsed && (
        <div id={listId} className="space-y-2 px-4 pb-3">
          <ul className="space-y-2">
            {data.slice(0, 8).map((item) => {
              const config = SEVERITY_CONFIG[item.severity] ?? SEVERITY_CONFIG.info;
              // The invitations item only opens the list: it resends nothing, so it says so.
              const actionLabel = item.actionUrl === INVITATIONS_URL ? d.openInvitations : item.actionLabel;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 rounded-lg border border-white/50 bg-white/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${SEVERITY_DOT[config.tone] ?? 'bg-info'}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <span className="block text-body font-medium text-primary">{item.title}</span>
                      <span className="text-callout text-secondary">{item.description}</span>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => router.push(item.actionUrl)}
                  >
                    {actionLabel}
                  </Button>
                </li>
              );
            })}
          </ul>
          {data.length > 8 && (
            <p className="pt-1 text-center text-callout text-secondary">
              {formatMessage(d.moreItems, { count: data.length - 8 })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

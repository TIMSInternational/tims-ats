'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../lib/trpc';
import { toast } from '../../../lib/toast';
import { SEVERITY_CONFIG, Skeleton } from './dashboard-utils';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';

export function AttentionBar() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = trpc.platform.getAttentionItems.useQuery();
  const [collapsed, setCollapsed] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-white p-4 mb-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-border bg-white mb-5">
        <ErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const hasCritical = data.some((item) => item.severity === 'critical');
  const bgColor = hasCritical ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200';

  return (
    <div className={`rounded-xl border ${bgColor} mb-5 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-base">
            {hasCritical ? '\u26A0' : '\u26A0'}
          </span>
          <span className="text-sm font-semibold text-primary">
            {data.length} item{data.length !== 1 ? 's' : ''} need attention
          </span>
          {hasCritical && (
            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {data.filter((i) => i.severity === 'critical').length} critical
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-black/5"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {/* Items */}
      {!collapsed && (
        <div className="px-4 pb-3 space-y-2">
          {data.slice(0, 8).map((item) => {
            const config = SEVERITY_CONFIG[item.severity] ?? SEVERITY_CONFIG.info;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2.5 border border-white/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${config.dot}`} />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-primary truncate block">
                      {item.title}
                    </span>
                    <span className="text-xs text-muted">{item.description}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (item.actionLabel === 'Reenviar') {
                      toast(t.invitations.invitationResent, { type: 'success' });
                    }
                    router.push(item.actionUrl);
                  }}
                  className="shrink-0 ml-3 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-border text-brand hover:bg-surface transition-colors"
                >
                  {item.actionLabel}
                </button>
              </div>
            );
          })}
          {data.length > 8 && (
            <p className="text-xs text-muted text-center pt-1">
              +{data.length - 8} more items
            </p>
          )}
        </div>
      )}
    </div>
  );
}

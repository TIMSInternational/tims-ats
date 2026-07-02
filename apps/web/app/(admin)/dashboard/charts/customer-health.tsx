'use client';

import { useRouter } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { HEALTH_CONFIG, PLAN_BG_CLASSES, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';

export function CustomerHealthGrid() {
  const router = useRouter();
  const { t } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.platform.getCustomerHealth.useQuery();

  return (
    <div className="rounded-xl border border-border bg-white p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-primary">{t.dashboard.customerHealthTitle}</h3>
          <p className="text-xs text-muted">{t.dashboard.customerHealthSubtitle}</p>
        </div>
        {data && (
          <div className="flex items-center gap-3">
            {(['healthy', 'at_risk', 'critical'] as const).map((h) => {
              const count = data.filter((d) => d.health === h).length;
              if (count === 0) return null;
              const cfg = HEALTH_CONFIG[h];
              return (
                <span key={h} className="flex items-center gap-1 text-xs text-muted">
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  {count}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <div className="h-[200px] flex items-center justify-center">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="h-[200px] flex items-center justify-center text-sm text-muted">
          No customer data
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-[240px] overflow-y-auto">
          {data.map((org) => {
            const healthCfg = HEALTH_CONFIG[org.health];
            const planClass = PLAN_BG_CLASSES[org.plan] ?? 'bg-gray-100 text-gray-700';

            // Determine the key signal to show
            let signal: string;
            if (org.signals.overdueInvoices > 0) {
              signal = `${org.signals.overdueInvoices} overdue invoice${org.signals.overdueInvoices > 1 ? 's' : ''}`;
            } else if (org.signals.trialDaysLeft !== null) {
              signal = `Trial: ${org.signals.trialDaysLeft}d left`;
            } else {
              signal = `${org.signals.loginRate}% login rate`;
            }

            return (
              <button
                key={org.orgId}
                onClick={() => router.push(`/platform/organizations/${org.orgId}`)}
                className={`text-left rounded-lg border p-3 transition-all hover:shadow-sm ${healthCfg.bg}`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <span className="text-xs font-semibold text-primary truncate max-w-[100px]">
                    {org.orgName}
                  </span>
                  <span className={`h-2.5 w-2.5 rounded-full shrink-0 mt-0.5 ${healthCfg.dot}`} />
                </div>
                <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${planClass} mb-1`}>
                  {PLAN_LABELS[org.plan] ?? org.plan}
                </span>
                <p className="text-[11px] text-secondary">{signal}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

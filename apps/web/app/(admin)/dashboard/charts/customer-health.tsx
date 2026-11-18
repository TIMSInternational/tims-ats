'use client';

import { useId } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardCustomerHealth } from '../../../../lib/platform-api/dashboard';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { HEALTH_CONFIG, PLAN_BG_CLASSES, PLAN_CHIP_FALLBACK, PLAN_LABELS, Skeleton } from '../dashboard-utils';
import { ErrorState } from '../../../../components';
import { StatusBadge } from '../../../../components/status-badge';

export function CustomerHealthGrid() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardCustomerHealth();

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-heading font-semibold text-brand">
            {d.customerHealthTitle}
          </h2>
          <p className="text-callout text-secondary">{d.customerHealthSubtitle}</p>
        </div>
        {data && (
          // "2 Saludable · 11 Crítico": the word, not just a coloured dot and a number.
          <div className="flex flex-wrap items-center gap-1.5">
            {(['healthy', 'at_risk', 'critical'] as const).map((h) => {
              const count = data.filter((row) => row.health === h).length;
              if (count === 0) return null;
              const cfg = HEALTH_CONFIG[h];
              return (
                <StatusBadge key={h} tone={cfg.tone}>
                  {count} {d[cfg.labelKey]}
                </StatusBadge>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState size="compact" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <p className="py-10 text-center text-body text-secondary">{d.noCustomerData}</p>
      ) : (
        <ul className="grid max-h-[240px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {data.map((org) => {
            const healthCfg = HEALTH_CONFIG[org.health] ?? HEALTH_CONFIG.healthy;
            const planClass = PLAN_BG_CLASSES[org.plan] ?? PLAN_CHIP_FALLBACK;

            // Determine the key signal to show
            let signal: string;
            if (org.signals.overdueInvoices > 0) {
              signal = pluralize(
                org.signals.overdueInvoices,
                { one: d.overdueInvoicesOne, other: d.overdueInvoicesOther },
                locale,
              );
            } else if (org.signals.trialDaysLeft !== null) {
              signal = formatMessage(d.trialDaysLeft, { count: org.signals.trialDaysLeft });
            } else {
              signal = formatMessage(d.loginRatePct, { pct: org.signals.loginRate });
            }

            return (
              <li key={org.orgId}>
                <button
                  type="button"
                  onClick={() => router.push(`/platform/organizations/${org.orgId}`)}
                  className="h-full w-full rounded-lg border border-border p-3 text-left transition-colors hover:bg-surface-hover"
                >
                  <span className="mb-1.5 block break-words text-callout font-semibold text-primary">
                    {org.orgName}
                  </span>
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <StatusBadge tone={healthCfg.tone}>{d[healthCfg.labelKey]}</StatusBadge>
                    <span className={`rounded px-1.5 py-0.5 text-caption font-medium ${planClass}`}>
                      {PLAN_LABELS[org.plan] ?? org.plan}
                    </span>
                  </div>
                  <p className="text-caption text-secondary">{signal}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

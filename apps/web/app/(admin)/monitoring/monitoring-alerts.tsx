'use client';

import { useId } from 'react';
import { useMonitoringActiveAlerts } from '../../../lib/platform-api/monitoring';
import { useI18n } from '../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../lib/format-utils';
import { ErrorState } from '../../../components';
import { CountBadge } from '../../../components/count-badge';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';

const SEV_TONE: Record<string, StatusTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

export function AlertsPanel() {
  const { t, locale } = useI18n();
  const q = useMonitoringActiveAlerts({});
  const items = q.data?.items ?? [];
  const titleId = useId();
  const total = q.data?.total ?? 0;

  // Severity and module through i18n: never the raw slug ("CRITICAL", "recruitment").
  const sevLabel: Record<string, string> = {
    critical: t.alertRules.sev_critical,
    warning: t.alertRules.sev_warning,
    info: t.alertRules.sev_info,
  };
  const modLabel: Record<string, string> = {
    recruitment: t.monitoring.mod_recruitment,
    onboarding: t.monitoring.mod_onboarding,
    people: t.monitoring.mod_people,
    engagement: t.monitoring.mod_engagement,
    compensation: t.monitoring.mod_compensation,
    dei: t.monitoring.mod_dei,
    time: t.monitoring.mod_time,
    performance: t.monitoring.mod_performance,
  };

  return (
    <section aria-labelledby={titleId} className="flex flex-col rounded-xl bg-white shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-subheading font-semibold text-brand">
          {t.monitoring.activeAlerts}
          {total > 0 && <span className="sr-only"> ({total})</span>}
        </h2>
        <CountBadge count={total} />
      </div>
      <div className="max-h-96 space-y-2 overflow-y-auto p-3">
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded bg-surface motion-reduce:animate-none" aria-busy="true">
            <span className="sr-only">{t.common.loadingContent}</span>
          </div>
        ) : q.isError ? (
          <ErrorState size="compact" title={t.monitoring.alertsErr} onRetry={() => q.refetch()} error={q.error} />
        ) : items.length === 0 ? (
          <p className="px-1 py-2 text-callout text-secondary">{t.monitoring.noAlerts}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={SEV_TONE[a.severity] ?? 'info'}>{sevLabel[a.severity] ?? a.severity}</StatusBadge>
                  <StatusBadge tone="brand" icon="none">
                    {modLabel[a.module] ?? a.module}
                  </StatusBadge>
                </div>
                <p className="text-body font-medium text-primary">{a.title}</p>
                {a.message && <p className="mt-0.5 text-callout text-secondary">{a.message}</p>}
                <p className="mt-1 text-caption text-muted">{formatRelativeTimeLocale(a.createdAt, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

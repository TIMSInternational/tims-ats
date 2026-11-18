'use client';

import { useId } from 'react';
import { useMonitoringModuleHealth } from '../../../lib/platform-api/monitoring';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { StatusBadge, type StatusTone } from '../../../components/status-badge';

const STATUS_TONE: Record<string, StatusTone> = {
  healthy: 'success',
  warning: 'warning',
  critical: 'danger',
};

export function ModuleHealthGrid() {
  const { t } = useI18n();
  const q = useMonitoringModuleHealth();
  const titleId = useId();

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
  const statusLabel: Record<string, string> = {
    healthy: t.monitoring.statusHealthy,
    warning: t.monitoring.statusWarning,
    critical: t.monitoring.statusCritical,
  };

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-3 text-heading font-semibold text-brand">
        {t.monitoring.moduleHealth}
      </h2>
      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-24 animate-pulse rounded-xl bg-white shadow-card motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : q.isError ? (
        <div className="rounded-xl bg-white shadow-card">
          <ErrorState size="compact" title={t.monitoring.moduleHealthErr} onRetry={() => q.refetch()} error={q.error} />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(q.data ?? []).map((m) => (
            <li key={m.module} className="flex flex-col justify-between gap-2 rounded-xl bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body font-semibold text-primary">{modLabel[m.module] ?? m.module}</h3>
                <StatusBadge tone={STATUS_TONE[m.status] ?? 'neutral'}>{statusLabel[m.status] ?? m.status}</StatusBadge>
              </div>
              <p className="text-callout text-secondary">
                {m.activeAlerts > 0
                  ? `${m.activeAlerts} ${t.monitoring.activeAlertsSuffix}`
                  : t.monitoring.noAlertsModule}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

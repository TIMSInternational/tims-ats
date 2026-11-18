'use client';

import { useId } from 'react';
import { useMonitoringActionPlanAlerts } from '../../../lib/platform-api/monitoring';
import { useI18n } from '../../../lib/i18n';
import { pluralize } from '../../../lib/i18n/format';
import { ErrorState } from '../../../components';
import { CountBadge } from '../../../components/count-badge';
import { StatusBadge } from '../../../components/status-badge';

function daysUntil(d: string | Date): number {
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function ActionPlanAlerts() {
  const { t, locale } = useI18n();
  const q = useMonitoringActionPlanAlerts();
  const items = q.data?.items ?? [];
  const titleId = useId();
  const total = q.data?.total ?? 0;

  return (
    <section aria-labelledby={titleId} className="flex flex-col rounded-xl bg-white shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-subheading font-semibold text-brand">
          {t.monitoring.actionPlanAlerts}
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
          <ErrorState
            size="compact"
            title={t.monitoring.actionPlanAlertsErr}
            onRetry={() => q.refetch()}
            error={q.error}
          />
        ) : items.length === 0 ? (
          <p className="px-1 py-2 text-callout text-secondary">{t.monitoring.noActionPlanAlerts}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((a) => {
              const days = daysUntil(a.dueDate ?? new Date());
              const overdue = days < 0;
              const responsibleName = `${a.responsible.firstName} ${a.responsible.lastName}`;
              return (
                <li key={a.id} className="rounded-lg border border-border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={overdue ? 'danger' : 'warning'}>
                      {overdue ? t.monitoring.actionPlanOverdue : t.monitoring.actionPlanDueSoon}
                    </StatusBadge>
                    {a.area && (
                      <StatusBadge tone="brand" icon="none">
                        {a.area}
                      </StatusBadge>
                    )}
                  </div>
                  <p className="text-body font-medium text-primary">{a.title}</p>
                  <p className="mt-0.5 text-callout text-secondary">
                    {t.monitoring.actionPlanResponsible}: {responsibleName}
                  </p>
                  <p className="mt-1 text-caption text-muted">
                    {overdue ? t.monitoring.actionPlanOverdueBy : t.monitoring.actionPlanDueIn}{' '}
                    {pluralize(Math.abs(days), { one: t.monitoring.dayOne, other: t.monitoring.dayOther }, locale)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

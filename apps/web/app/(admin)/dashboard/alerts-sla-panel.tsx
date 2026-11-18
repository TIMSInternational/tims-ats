'use client';

import { useId, useMemo } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState } from '../../../components';
import { StatusBadge } from '../../../components/status-badge';

interface SlaStage {
  name: string;
  count: number;
  avgDays: number;
  slaDays: number;
  barPct: number;
  severity: 'critical' | 'warning';
}

interface AlertsSlaPanelProps {
  vacancyId: string | undefined;
  vacanciesLoading: boolean;
}

export function AlertsSlaPanel({ vacancyId, vacanciesLoading }: AlertsSlaPanelProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const slaQuery = trpc.pipeline.getSlaStatus.useQuery(
    { vacancyId: vacancyId! },
    { enabled: !!vacancyId, staleTime: 60_000 },
  );

  const isLoading = vacanciesLoading || slaQuery.isLoading;

  const slaData = useMemo<SlaStage[]>(() => {
    if (!slaQuery.data?.items) return [];

    const overdueByStage = new Map<string, { count: number; totalHours: number; slaHours: number }>();

    for (const item of slaQuery.data.items) {
      if (!item.isOverdue) continue;
      const existing = overdueByStage.get(item.stageName) ?? { count: 0, totalHours: 0, slaHours: item.slaHours ?? 0 };
      existing.count += 1;
      existing.totalHours += item.hoursInStage;
      if (item.slaHours && item.slaHours > existing.slaHours) {
        existing.slaHours = item.slaHours;
      }
      overdueByStage.set(item.stageName, existing);
    }

    if (overdueByStage.size === 0) return [];

    const maxCount = Math.max(...Array.from(overdueByStage.values()).map((v) => v.count));

    return Array.from(overdueByStage.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgDays: Math.round(data.totalHours / data.count / 24),
        slaDays: Math.round(data.slaHours / 24),
        barPct: Math.round((data.count / Math.max(maxCount, 1)) * 100),
        severity: (data.totalHours / data.count > data.slaHours * 2 ? 'critical' : 'warning') as 'critical' | 'warning',
      }))
      .sort((a, b) => b.count - a.count);
  }, [slaQuery.data]);

  const totalOverdue = slaData.reduce((s, d) => s + d.count, 0);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-4 shadow-card md:flex-1">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-subheading font-semibold text-brand">
          {rd.slaOverdueByStage}
        </h3>
        {/* Colour only when something is overdue; a word-free count stays neutral at 0. */}
        <StatusBadge tone={totalOverdue > 0 ? 'danger' : 'neutral'} icon="none" className="tabular-nums">
          {totalOverdue}
        </StatusBadge>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-12 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : slaQuery.isError ? (
        <ErrorState size="compact" onRetry={() => slaQuery.refetch()} error={slaQuery.error} />
      ) : slaData.length === 0 ? (
        <div className="py-6 text-center">
          <div
            className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full bg-success-bg"
            aria-hidden="true"
          >
            <svg className="size-4 text-success" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-callout text-secondary">{rd.noSlaOverdue}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {slaData.map((stage) => {
            const critical = stage.severity === 'critical';
            const accent = critical ? 'bg-danger' : 'bg-warning';
            const textColor = critical ? 'text-danger' : 'text-warning';
            return (
              <li key={stage.name} className="flex items-center gap-3">
                <div className={`h-12 w-[3px] shrink-0 rounded-full ${accent}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-x-2">
                    <span className="text-body text-primary">{stage.name}</span>
                    <span className="text-callout tabular-nums text-secondary">
                      {stage.count} {stage.count === 1 ? rd.candidate : rd.candidates}
                    </span>
                  </div>
                  <div className="my-1 h-1 w-full rounded-full bg-surface" aria-hidden="true">
                    <div className={`h-1 rounded-full ${accent}`} style={{ width: `${stage.barPct}%` }} />
                  </div>
                  <span className={`text-caption font-medium ${textColor}`}>
                    {rd.average}: {stage.avgDays} {rd.days} ({rd.sla}: {stage.slaDays})
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

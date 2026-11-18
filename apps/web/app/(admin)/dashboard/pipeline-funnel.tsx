'use client';

import { useId, useMemo, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import type { VacancyListItem } from '../../../lib/trpc-types';
import { ErrorState } from '../../../components';
import { selectClasses } from '../../../components/field-styles';

const STAGE_COLORS = [
  'bg-[#E8E5F0] text-brand',
  'bg-[#D4CFE5] text-brand',
  'bg-[#B8AED4] text-brand',
  'bg-[#9B8DC4] text-brand',
  'bg-[#7B6BAA] text-white',
  'bg-[#5C4B99] text-white',
  'bg-brand text-white',
];

/** Placeholder bars that taper like a funnel, one fixed width per row. */
const SKELETON_WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-2/3', 'w-3/5', 'w-1/2', 'w-2/5'];

interface PipelineFunnelProps {
  vacancies: VacancyListItem[];
}

/**
 * Pipeline-by-stage for ONE published vacancy, from `pipeline.getFunnel`.
 * The funnel API is per-vacancy and returns aggregate (all-time) counts, so
 * the card offers no "all vacancies" or period filter, and it never fills in
 * estimated stage counts: no data renders an explicit empty state.
 */
export function PipelineFunnel({ vacancies }: PipelineFunnelProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  const [selectedVacancyId, setSelectedVacancyId] = useState<string | null>(null);
  const titleId = useId();
  const selectId = useId();

  const vacancyList = vacancies ?? [];
  const selectedVacancy = vacancyList.find((v) => v.id === selectedVacancyId) ?? vacancyList[0] ?? null;
  const targetVacancyId = selectedVacancy?.id ?? null;

  const funnelQuery = trpc.pipeline.getFunnel.useQuery(
    { vacancyId: targetVacancyId ?? '' },
    { enabled: !!targetVacancyId, staleTime: 30_000 },
  );

  const stages = useMemo(() => {
    const data = funnelQuery.data;
    if (!data?.funnel?.length) return [];
    const result = data.funnel.map((s) => ({
      label: s.stageName,
      count: s.currentCount,
      pct: s.conversionRate > 0 ? `${s.conversionRate}%` : '',
    }));
    // The all-time total, distinct from the first stage's current count (it read "Postulados" and then
    // "Aplicado", two names for what looked like the same number).
    result.unshift({ label: rd.funnelTotal, count: data.totalApplications, pct: '' });
    return result;
  }, [funnelQuery.data, rd.funnelTotal]);

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-5 shadow-card md:flex-[65]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {rd.pipelineByStage}
        </h2>
        {selectedVacancy && (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="text-callout text-secondary">
              {rd.funnelVacancyLabel}
            </label>
            <select
              id={selectId}
              value={selectedVacancy.id}
              onChange={(e) => setSelectedVacancyId(e.target.value)}
              className={selectClasses('md', 'w-auto max-w-60 truncate')}
            >
              {vacancyList.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Funnel bars */}
      {!targetVacancyId ? (
        <p className="py-6 text-center text-callout text-muted">{rd.noVacanciesPublished}</p>
      ) : funnelQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {SKELETON_WIDTHS.map((width, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={`h-6 animate-pulse rounded bg-gray-100 motion-reduce:animate-none ${width}`}
            />
          ))}
        </div>
      ) : funnelQuery.isError ? (
        <ErrorState size="compact" onRetry={() => funnelQuery.refetch()} error={funnelQuery.error} />
      ) : stages.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">{rd.noPipelineData}</p>
      ) : (
        <ol className="space-y-2">
          {/* The stage name leads each row, next to its bar, so a short bar is never far from its label. */}
          {stages.map((stage, idx) => {
            const widthPct = Math.max((stage.count / maxCount) * 100, 3);
            return (
              <li key={stage.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-callout text-secondary sm:w-44">
                  {stage.label} {stage.pct && <span className="text-caption tabular-nums text-muted">{stage.pct}</span>}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={`flex h-6 min-w-6 items-center justify-center rounded-sm ${STAGE_COLORS[idx % STAGE_COLORS.length]}`}
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-caption font-semibold tabular-nums">{stage.count}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function PipelineFunnelSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="w-full animate-pulse rounded-xl bg-white p-5 shadow-card motion-reduce:animate-none md:flex-[65]"
    >
      <div className="h-5 w-60 bg-gray-200 rounded mb-4" />
      <div className="space-y-2">
        {SKELETON_WIDTHS.map((width, i) => (
          <div key={i} className={`h-6 rounded bg-gray-200 ${width}`} />
        ))}
      </div>
    </div>
  );
}

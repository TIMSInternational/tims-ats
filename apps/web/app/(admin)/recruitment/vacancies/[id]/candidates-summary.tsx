'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { ErrorState, ProgressBar, Skeleton, TEXT_LINK_CLASSES } from '../../../../../components';
import type { VacancyStats } from '../../../../../lib/trpc-types';
import { CountTile } from './count-tile';

interface CandidatesSummaryProps {
  vacancyId: string;
  stats: VacancyStats | null;
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

const CARD = 'rounded-xl border border-border bg-white p-5 shadow-card';

export function CandidatesSummary({ vacancyId, stats, isLoading, isError, onRetry }: CandidatesSummaryProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className={CARD} aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <Skeleton className="mb-3 h-4 w-32 rounded" />
        <div className="mb-4 flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 flex-1 rounded-lg" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <section aria-labelledby="vacancy-candidates-title" className={CARD}>
        <h2 id="vacancy-candidates-title" className="text-heading font-semibold text-brand">
          {t.vacancies.candidatesAssociated}
        </h2>
        <ErrorState onRetry={onRetry} size="compact" />
      </section>
    );
  }

  if (!stats) return null;

  const total = stats.totalApplications;

  return (
    <section aria-labelledby="vacancy-candidates-title" className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="vacancy-candidates-title" className="text-heading font-semibold text-brand">
          {t.vacancies.candidatesAssociated}
        </h2>
        <Link href={`/recruitment/pipeline?vacancy=${vacancyId}`} className={`${TEXT_LINK_CLASSES} text-callout`}>
          {t.vacancies.viewAllCandidates}
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <CountTile value={total} label={t.vacancies.total} />
        <CountTile value={stats.activeApplications} label={t.vacancies.inProcess} />
        <CountTile value={stats.rejectedApplications} label={t.vacancies.rejectedCandidates} />
      </div>

      {stats.stageBreakdown.length > 0 && (
        <>
          <h3 className="mb-2 text-callout font-medium text-secondary">{t.vacancies.currentPipeline}</h3>
          <ul className="space-y-1.5">
            {stats.stageBreakdown.map((stage) => (
              <li key={stage.stageId} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-callout text-secondary" title={stage.stageName}>
                  {stage.stageName}
                </span>
                <ProgressBar
                  value={stage.count}
                  max={Math.max(total, 1)}
                  label={stage.stageName}
                  valueText={String(stage.count)}
                  kind="meter"
                  hideLabel
                  className="min-w-0 flex-1"
                />
                <span className="w-6 text-right text-callout font-medium tabular-nums text-brand">{stage.count}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

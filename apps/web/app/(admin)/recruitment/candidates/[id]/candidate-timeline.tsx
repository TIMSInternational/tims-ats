'use client';

import { useI18n } from '../../../../../lib/i18n';
import { ActivityTimeline, Button, EmptyState, ErrorState, Skeleton } from '../../../../../components';
import type { CandidateTimelineEvent } from '../../../../../lib/trpc-types';
import { localizeTimelineEvent } from '../../../../../lib/candidate-timeline-labels';
import { CARD, CARD_TITLE } from './card-styles';

/**
 * The candidate's activity. On Perfil it shows the latest few events and a link to the full Historial tab
 * (`maxItems` + `onViewAll`); on Historial it shows everything.
 */
export function CandidateTimeline({
  events,
  isLoading,
  isError,
  onRetry,
  maxItems = 15,
  onViewAll,
}: {
  events: CandidateTimelineEvent[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  maxItems?: number;
  onViewAll?: () => void;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <section className={CARD} aria-busy="true">
        <Skeleton className="mb-3 h-4 w-32 rounded" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>{t.candidates.activityTimeline}</h2>
      {isError ? (
        <ErrorState size="compact" message={t.candidates.timelineLoadError} onRetry={onRetry} />
      ) : events.length === 0 ? (
        <EmptyState size="compact" title={t.candidates.noActivity} />
      ) : (
        <>
          <ActivityTimeline
            events={events.map((e) => ({
              ...e,
              ...localizeTimelineEvent(e, t.candidates, t.rejectCandidateModal.reasons),
            }))}
            maxItems={maxItems}
          />
          {onViewAll && events.length > maxItems && (
            <Button variant="tertiary" size="sm" onClick={onViewAll} className="mt-3">
              {t.candidates.viewAllActivity}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

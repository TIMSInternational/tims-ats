'use client';

import { useI18n } from '../../../../../lib/i18n';
import { ActivityTimeline, ErrorState, Skeleton } from '../../../../../components';
import type { CandidateTimelineEvent } from '../../../../../lib/trpc-types';

export function CandidateTimeline({
  events,
  isLoading,
  isError,
}: {
  events: CandidateTimelineEvent[];
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <Skeleton className="h-4 w-32 mb-3 rounded" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.activityTimeline}</h3>
        <ErrorState />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.activityTimeline}</h3>
      {events.length === 0 ? (
        <p className="text-xs text-[#8B8B8B] py-3 text-center">{t.candidates.noActivity}</p>
      ) : (
        <ActivityTimeline events={events} maxItems={15} />
      )}
    </div>
  );
}

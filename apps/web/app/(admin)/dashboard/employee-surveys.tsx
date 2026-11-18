'use client';

import { useId, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { useEngagementMyPendingSurveys } from '../../../lib/platform-api/engagement';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';
import { SurveyTakeModal } from './survey-take-modal';
import { Button } from '../../../components/button';

function SkeletonRows() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// "Mis Encuestas" — OWN-scoped pending surveys (active surveys the caller has not
// yet answered). Each row has a "Responder" button that opens the take modal
// (survey-take-modal.tsx); on submit the list invalidates and the answered
// survey drops off (anti-join in myPendingSurveys).
export function EmployeeSurveys() {
  const { t } = useI18n();
  const e = t.employeeHome;
  const surveys = useEngagementMyPendingSurveys();
  const list = surveys.data ?? [];

  const [takingId, setTakingId] = useState<string | null>(null);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="mb-4 text-heading font-semibold text-brand">
        {e.surveys}
      </h2>
      {surveys.isError ? (
        <LoadError message={e.loadError} onRetry={() => surveys.refetch()} />
      ) : surveys.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState size="compact" message={e.noSurveys} />
      ) : (
        <ul className="space-y-1">
          {list.map((survey) => (
            <li
              key={survey.id}
              className="-mx-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg px-3 py-2.5"
            >
              <span className="min-w-0 truncate text-body font-medium text-primary">{survey.title}</span>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-callout text-muted">
                  {survey.endsAt ? `${e.surveyCloses} ${formatDate(survey.endsAt)}` : e.surveyNoClose}
                </span>
                <Button
                  size="sm"
                  onClick={() => setTakingId(survey.id)}
                  aria-label={`${e.respondSurvey}: ${survey.title}`}
                >
                  {e.respondSurvey}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {takingId ? <SurveyTakeModal surveyId={takingId} onClose={() => setTakingId(null)} /> : null}
    </section>
  );
}

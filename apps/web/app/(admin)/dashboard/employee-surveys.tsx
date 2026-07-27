'use client';

import { useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { useEngagementMyPendingSurveys } from '../../../lib/platform-api/engagement';
import { EmptyState, Skeleton } from '../../../components';
import { LoadError } from './load-error';
import { formatDate } from '../../../lib/format-utils';
import { SurveyTakeModal } from './survey-take-modal';

const EMPTY_ICON = <span className="w-8 h-8 rounded-full bg-[#F0F0F0] inline-block" aria-hidden />;

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

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-8">
      <h2 className="text-sm font-semibold text-[#1F114C] mb-4">{e.surveys}</h2>
      {surveys.isError ? (
        <LoadError message={e.loadError} />
      ) : surveys.isLoading ? (
        <SkeletonRows />
      ) : list.length === 0 ? (
        <EmptyState icon={EMPTY_ICON} message={e.noSurveys} />
      ) : (
        <div className="space-y-1">
          {list.map((survey) => (
            <div key={survey.id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 -mx-3">
              <span className="text-sm text-[#333] font-medium truncate">{survey.title}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[13px] text-[#8B8B8B]">
                  {survey.endsAt ? `${e.surveyCloses} ${formatDate(survey.endsAt)}` : e.surveyNoClose}
                </span>
                <button
                  type="button"
                  onClick={() => setTakingId(survey.id)}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium bg-[#1F114C] text-white hover:bg-[#2A1860] transition"
                >
                  {e.respondSurvey}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {takingId ? <SurveyTakeModal surveyId={takingId} onClose={() => setTakingId(null)} /> : null}
    </div>
  );
}

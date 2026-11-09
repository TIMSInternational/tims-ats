'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { toast } from '../../../../../lib/toast';
import { isFitEngineV2Enabled } from '../../../../../lib/platform-api/fit-engine';
import {
  isProviderAssessmentsStaffEnabled,
  useCancelProviderAttempt,
  useCandidateProviderAttempts,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import { ProviderAttemptRow } from './provider-attempt-row';
import { AssignProviderAssessmentsModal } from './assign-provider-assessments-modal';

export interface ProviderCardApplication {
  status: string;
  vacancy: { id: string; title: string };
}

// AS-7 / AS-14 on the candidate page: the candidate's TIMS Assessments per vacancy (status chip and result per test, as
// the C# read returns them for this reader: D6 for a team leader) and, for each active application, assigning the
// vacancy's tests (all of them, same versions, after the consent notice). Dark unless the provider connector and FIT v2
// are both on in this build (the vacancy's tests are read from FIT v2's requirements).
export function ProviderAssessmentsCard({
  candidateId,
  applications,
}: {
  candidateId: string;
  applications: ProviderCardApplication[];
}) {
  const { t, locale } = useI18n();
  const pa = t.providerAssessments;
  const can = useCan();
  const enabled = isProviderAssessmentsStaffEnabled() && isFitEngineV2Enabled();
  const attempts = useCandidateProviderAttempts(candidateId);
  const cancel = useCancelProviderAttempt(candidateId);
  const [assignFor, setAssignFor] = useState<ProviderCardApplication['vacancy'] | null>(null);

  if (!enabled) return null;

  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium' });
  const titles = new Map(applications.map((application) => [application.vacancy.id, application.vacancy.title]));
  const assignable = can('assessment', 'create') ? applications.filter((a) => a.status === 'active') : [];

  const content = () => {
    if (attempts.isLoading) return <p className="text-[12px] text-[#8B8B8B]">{pa.loading}</p>;
    if (attempts.isError || !attempts.data) {
      return (
        <p role="alert" className="text-[12px] text-[#B42318]">
          {pa.error}
        </p>
      );
    }
    if (attempts.data.consentWithdrawn) return <p className="text-[12px] text-[#8B8B8B]">{pa.withdrawn}</p>;
    if (attempts.data.attempts.length === 0) return <p className="text-[12px] text-[#8B8B8B]">{pa.empty}</p>;

    const byVacancy = new Map<string, typeof attempts.data.attempts>();
    for (const attempt of attempts.data.attempts) {
      byVacancy.set(attempt.vacancyId, [...(byVacancy.get(attempt.vacancyId) ?? []), attempt]);
    }
    return [...byVacancy.entries()].map(([vacancyId, rows]) => (
      <div key={vacancyId} className="mb-3 last:mb-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#8B8B8B]">
          {pa.vacancyLabel}: {titles.get(vacancyId) ?? pa.unknownVacancy}
        </p>
        <ul>
          {rows.map((attempt) => (
            <ProviderAttemptRow
              key={attempt.attemptId}
              attempt={attempt}
              dateFormat={dateFormat}
              canCancel={can('assessment', 'update')}
              cancelling={cancel.isPending && cancel.variables === attempt.attemptId}
              onCancel={() =>
                cancel.mutate(attempt.attemptId, {
                  onSuccess: () => toast(pa.cancelled, { type: 'success' }),
                  onError: () => toast(pa.cancelError, { type: 'error' }),
                })
              }
            />
          ))}
        </ul>
      </div>
    ));
  };

  return (
    <section
      aria-labelledby="provider-assessments-title"
      className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      data-testid="provider-assessments"
    >
      <h3 id="provider-assessments-title" className="text-[14px] font-semibold text-[#1F114C] mb-3">
        {pa.title}
      </h3>
      {content()}
      {!attempts.data?.consentWithdrawn && assignable.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {assignable.map((application) => (
            <button
              key={application.vacancy.id}
              type="button"
              onClick={() => setAssignFor(application.vacancy)}
              className="rounded-lg bg-[#1F114C] px-3 py-1.5 text-[12px] font-medium text-white"
            >
              {assignable.length === 1 ? pa.assign : pa.assignFor.replace('{vacancy}', application.vacancy.title)}
            </button>
          ))}
        </div>
      )}
      {assignFor && (
        <AssignProviderAssessmentsModal
          candidateId={candidateId}
          vacancy={assignFor}
          onClose={() => setAssignFor(null)}
        />
      )}
    </section>
  );
}

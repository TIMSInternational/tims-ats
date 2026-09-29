'use client';

import { useI18n } from '../../../../../lib/i18n';
import { useStaffCandidateExplanation } from '../../../../../lib/platform-api/proctoring-staff';

interface CandidateProctoringExplanationProps {
  assignmentId: string;
}

export function CandidateProctoringExplanation({ assignmentId }: CandidateProctoringExplanationProps) {
  const { t, locale } = useI18n();
  const copy = t.proctoring.review.candidateExplanation;
  const explanation = useStaffCandidateExplanation(assignmentId);

  const submittedAt = explanation.data?.submittedAt
    ? new Intl.DateTimeFormat(locale === 'ES' ? 'es' : 'en', {
      dateStyle: 'medium', timeStyle: 'short',
    }).format(new Date(explanation.data.submittedAt))
    : null;

  return (
    <section className="rounded-lg border border-[#DDD6EF] bg-white p-3" aria-label={copy.title}>
      <h3 className="font-semibold text-[#1F114C]">{copy.title}</h3>
      <p className="mt-1 text-[11px] text-[#585858]">{copy.context}</p>
      {explanation.isLoading ? <p role="status" className="mt-2">{copy.loading}</p> : null}
      {explanation.isError ? <p role="status" className="mt-2">{copy.loadError}</p> : null}
      {explanation.isSuccess && explanation.data === null ? (
        <p className="mt-2">{copy.none}</p>
      ) : null}
      {explanation.data ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-[#585858]">{copy.submittedAt}: {submittedAt}</p>
          <p className="whitespace-pre-wrap break-words rounded border border-[#EDEDED] bg-[#FAFAFA] p-3 text-sm text-[#1F114C]">
            {explanation.data.text}
          </p>
        </div>
      ) : null}
    </section>
  );
}

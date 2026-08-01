'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../../lib/i18n';
import { AssessmentConsentGate } from './assessment-consent-gate';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { AssessmentResultScreen } from './assessment-result-screen';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
import { AssessmentBackLink } from './assessment-back-link';

interface AssessmentPlayerShellProps {
  orgSlug: string;
  assignmentId: string;
}

export function AssessmentPlayerShell({ orgSlug, assignmentId }: AssessmentPlayerShellProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [consentError, setConsentError] = useState<string | null>(null);
  const assessmentsQuery = trpc.candidatePortal.getMyAssessments.useQuery({ orgSlug });

  const startMutation = trpc.candidatePortal.startAssessment.useMutation({
    onSuccess: () => utils.candidatePortal.getMyAssessments.invalidate(),
    onError: (error: { message: string }) =>
      setConsentError(mapAssessmentErrorMessage(error.message, t.assessmentPlayer)),
  });

  if (assessmentsQuery.isLoading) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#8B8B8B] p-8">{t.assessmentPlayer.loading}</p>
      </>
    );
  }
  if (assessmentsQuery.isError) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#B42318] p-8">{t.assessmentPlayer.loadError}</p>
      </>
    );
  }

  const assignment = (assessmentsQuery.data ?? []).find((item) => item.id === assignmentId);
  if (!assignment) {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notFound}</p>
      </>
    );
  }

  if (assignment.status === 'cancelled') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.cancelled}</p>
      </>
    );
  }

  if (assignment.status === 'completed') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <AssessmentResultScreen
          normalizedScore={assignment.result?.normalizedScore ?? null}
          hasPending={assignment.result?.hasPending ?? false}
          band={assignment.result?.band ?? null}
          percentile={assignment.result?.percentile ?? null}
          normSampleSize={assignment.result?.normSampleSize ?? null}
        />
      </>
    );
  }

  if (assignment.status === 'in_progress') {
    return (
      <AssessmentQuestionWizard
        orgSlug={orgSlug}
        assignmentId={assignmentId}
        // Backend invariant (candidateAssessmentRepo.markStarted): startedAt is set on the
        // FIRST assigned -> in_progress transition, so it is always non-null once in_progress.
        startedAt={assignment.startedAt as Date}
        expiresAt={assignment.expiresAt}
        durationMinutes={assignment.assessmentType.duration}
        onSubmitted={() => utils.candidatePortal.getMyAssessments.invalidate()}
      />
    );
  }

  if (assignment.status === 'assigned') {
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        <AssessmentConsentGate
          isSubmitting={startMutation.isPending}
          errorMessage={consentError}
          onStart={() => {
            setConsentError(null);
            startMutation.mutate({ orgSlug, assignmentId, consentAccepted: true });
          }}
        />
      </>
    );
  }

  // Any other status (e.g. seed-data's 'pending' — not yet assigned/started) isn't
  // handled by the branches above. Falling through to the consent gate here would
  // let the candidate click Start and hit a confusing assignment_not_startable
  // backend error, so render a plain message instead.
  return (
    <>
      <AssessmentBackLink orgSlug={orgSlug} />
      <p className="text-center text-[13px] text-[#585858] p-8">{t.assessmentPlayer.notStartable}</p>
    </>
  );
}

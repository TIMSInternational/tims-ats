'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../../lib/i18n';
import { AssessmentConsentGate } from './assessment-consent-gate';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { AssessmentResultScreen } from './assessment-result-screen';
import { mapAssessmentErrorMessage } from './assessment-error-messages';
import { AssessmentBackLink } from './assessment-back-link';
import { EmptyState, ErrorState, Skeleton } from '../../../../../../../../components';

interface AssessmentPlayerShellProps {
  orgSlug: string;
  assignmentId: string;
}

function Frame({ orgSlug, children }: { orgSlug: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface">
      <AssessmentBackLink orgSlug={orgSlug} />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}

function StateIcon() {
  return (
    <svg
      className="size-8 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 12h6m-6 4h6M9 4.5h6a1.5 1.5 0 011.5 1.5v.75h-9V6A1.5 1.5 0 019 4.5zM7.5 6.75H6A1.5 1.5 0 004.5 8.25v11.25A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-1.5V8.25A1.5 1.5 0 0018 6.75h-1.5" />
    </svg>
  );
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
      <Frame orgSlug={orgSlug}>
        <div aria-busy="true" className="space-y-3 rounded-2xl bg-white p-6 shadow-card">
          <span className="sr-only">{t.assessmentPlayer.loading}</span>
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </Frame>
    );
  }
  if (assessmentsQuery.isError) {
    return (
      <Frame orgSlug={orgSlug}>
        <ErrorState title={t.assessmentPlayer.loadError} onRetry={() => void assessmentsQuery.refetch()} />
      </Frame>
    );
  }

  const assignment = (assessmentsQuery.data ?? []).find((item) => item.id === assignmentId);
  if (!assignment) {
    return (
      <Frame orgSlug={orgSlug}>
        <EmptyState icon={<StateIcon />} title={t.assessmentPlayer.notFound} />
      </Frame>
    );
  }

  if (assignment.status === 'cancelled') {
    return (
      <Frame orgSlug={orgSlug}>
        <EmptyState icon={<StateIcon />} title={t.assessmentPlayer.cancelled} />
      </Frame>
    );
  }

  if (assignment.status === 'completed') {
    return (
      <Frame orgSlug={orgSlug}>
        <AssessmentResultScreen
          normalizedScore={assignment.result?.normalizedScore ?? null}
          hasPending={assignment.result?.hasPending ?? false}
          band={assignment.result?.band ?? null}
          percentile={assignment.result?.percentile ?? null}
          normSampleSize={assignment.result?.normSampleSize ?? null}
        />
      </Frame>
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
      <Frame orgSlug={orgSlug}>
        <AssessmentConsentGate
          isSubmitting={startMutation.isPending}
          errorMessage={consentError}
          onStart={() => {
            setConsentError(null);
            startMutation.mutate({ orgSlug, assignmentId, consentAccepted: true });
          }}
        />
      </Frame>
    );
  }

  // Any other status (e.g. seed-data's 'pending' — not yet assigned/started) isn't
  // handled by the branches above. Falling through to the consent gate here would
  // let the candidate click Start and hit a confusing assignment_not_startable
  // backend error, so render a plain message instead.
  return (
    <Frame orgSlug={orgSlug}>
      <EmptyState icon={<StateIcon />} title={t.assessmentPlayer.notStartable} />
    </Frame>
  );
}

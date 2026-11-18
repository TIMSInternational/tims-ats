'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
import { useCan } from '../../../../../lib/permissions';
import { toast } from '../../../../../lib/toast';
import { PlatformApiError } from '../../../../../lib/platform-api/client';
import {
  useCancelProviderAttempt,
  useCandidateProviderAttempts,
  type StaffProviderAttempt,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import { Button, ConfirmDialog, ErrorState, Skeleton } from '../../../../../components';
import { ProviderAttemptRow } from './provider-attempt-row';
import { AssignProviderAssessmentsModal } from './assign-provider-assessments-modal';
import { byInstrumentOrder } from './provider-results/provider-results-board';

import type { ProviderCardApplication } from './provider-assessments-card';

function LoadingRows({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-3">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// The candidate's TIMS Assessments card once enabled: the attempts per vacancy, cancel, and the assign entry points. A
// reader the C# read refuses (403: no assessment:read, e.g. a team leader before the owner grant of connector owner step
// 8) is told so, instead of a generic load error: the D6 view explains itself.
export function ProviderAssessmentsPanel({
  candidateId,
  applications,
  onSeeDetails,
}: {
  candidateId: string;
  applications: ProviderCardApplication[];
  onSeeDetails?: () => void;
}) {
  const { t, locale } = useI18n();
  const pa = t.providerAssessments;
  const can = useCan();
  const attempts = useCandidateProviderAttempts(candidateId);
  const cancel = useCancelProviderAttempt(candidateId);
  const [assignFor, setAssignFor] = useState<ProviderCardApplication['vacancy'] | null>(null);
  const [cancelling, setCancelling] = useState<StaffProviderAttempt | null>(null);

  const dateFormat = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium' });
  const titles = new Map(applications.map((application) => [application.vacancy.id, application.vacancy.title]));
  const assignable = can('assessment', 'create') ? applications.filter((a) => a.status === 'active') : [];
  const assigned = new Set((attempts.data?.attempts ?? []).map((attempt) => attempt.vacancyId));
  const instrumentName = (attempt: StaffProviderAttempt) => t.candidates.fitInstrumentNames[attempt.instrument];

  const confirmCancel = () => {
    if (!cancelling) return;
    cancel.mutate(cancelling.attemptId, {
      onSuccess: () => {
        setCancelling(null);
        toast(pa.cancelled, { type: 'success' });
      },
    });
  };

  const content = () => {
    if (attempts.isLoading) return <LoadingRows label={pa.loading} />;
    if (attempts.isError || !attempts.data) {
      const forbidden = attempts.error instanceof PlatformApiError && attempts.error.status === 403;
      return forbidden ? (
        <p role="status" className="text-body text-secondary" data-testid="provider-assessments-no-permission">
          {pa.noReadPermission}
        </p>
      ) : (
        <ErrorState size="compact" title={pa.error} onRetry={() => void attempts.refetch()} />
      );
    }
    if (attempts.data.consentWithdrawn) return <p className="text-body text-secondary">{pa.withdrawn}</p>;
    if (attempts.data.attempts.length === 0) return <p className="text-body text-secondary">{pa.empty}</p>;

    const byVacancy = new Map<string, StaffProviderAttempt[]>();
    for (const attempt of attempts.data.attempts) {
      byVacancy.set(attempt.vacancyId, [...(byVacancy.get(attempt.vacancyId) ?? []), attempt]);
    }
    return [...byVacancy.entries()].map(([vacancyId, rows]) => (
      <div key={vacancyId} className="mb-3 last:mb-0">
        <p className="text-caption font-medium uppercase tracking-wide text-secondary">
          {pa.vacancyLabel}: {titles.get(vacancyId) ?? pa.unknownVacancy}
        </p>
        <ul>
          {/* The same test order as the results board on this tab. */}
          {[...rows].sort(byInstrumentOrder).map((attempt) => (
            <ProviderAttemptRow
              key={attempt.attemptId}
              attempt={attempt}
              dateFormat={dateFormat}
              canCancel={can('assessment', 'update')}
              cancelling={cancel.isPending && cancel.variables === attempt.attemptId}
              onCancel={() => setCancelling(attempt)}
            />
          ))}
        </ul>
      </div>
    ));
  };

  const assignLabel = (vacancy: ProviderCardApplication['vacancy']) => {
    const again = assigned.has(vacancy.id);
    if (assignable.length === 1) return again ? pa.assignAgain : pa.assign;
    return formatMessage(again ? pa.assignAgainFor : pa.assignFor, { vacancy: vacancy.title });
  };

  return (
    <section
      aria-labelledby="provider-assessments-title"
      className="rounded-xl bg-white p-4 shadow-card md:p-5"
      data-testid="provider-assessments"
    >
      <h3 id="provider-assessments-title" className="mb-3 text-subheading font-semibold text-brand">
        {pa.title}
      </h3>
      {content()}
      {onSeeDetails && attempts.data?.attempts.some((a) => a.result?.profile) && (
        <Button variant="tertiary" size="sm" className="mt-3 -ml-3" onClick={onSeeDetails}>
          {pa.results.seeDetails}
        </Button>
      )}
      {!attempts.data?.consentWithdrawn && assignable.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Secondary: the page header holds the one primary "Asignar evaluaciones TIMS" (buttons.md › Style). */}
          {assignable.map((application) => (
            <Button
              key={application.vacancy.id}
              variant={assigned.has(application.vacancy.id) ? 'tertiary' : 'secondary'}
              size="sm"
              onClick={() => setAssignFor(application.vacancy)}
            >
              {assignLabel(application.vacancy)}
            </Button>
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
      {cancelling && (
        <ConfirmDialog
          title={formatMessage(pa.cancelConfirmTitle, { instrument: instrumentName(cancelling) })}
          description={pa.cancelConfirmBody}
          confirmLabel={pa.cancelConfirm}
          confirmingLabel={pa.cancelling}
          cancelLabel={pa.cancelKeep}
          destructive
          loading={cancel.isPending}
          error={cancel.isError ? pa.cancelError : undefined}
          onConfirm={confirmCancel}
          onCancel={() => {
            setCancelling(null);
            cancel.reset();
          }}
        />
      )}
    </section>
  );
}

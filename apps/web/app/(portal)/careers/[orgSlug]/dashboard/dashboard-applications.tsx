'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { DashboardApplicationTimeline } from './dashboard-application-timeline';
import { DashboardWithdrawApplication } from './dashboard-withdraw-application';
import { candidatePhase, phaseText } from './candidate-phase';
import { Button } from '../../../../../components/button';
import { ErrorState } from '../../../../../components/error-state';
import { StatusBadge, type StatusTone } from '../../../../../components/status-badge';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
import { DASHBOARD_CARD, DASHBOARD_ITEM, DASHBOARD_TITLE } from './dashboard-styles';

// "My Applications" section of the candidate dashboard (Wave 1 Slice 2). Lists the
// signed-in candidate's applications at this org with status + current stage, and
// expands each into its stage timeline. Data comes from candidatePortal.* which
// resolves the candidate from the Supabase session — the orgSlug is the only input.
// Dates render in the organization's time zone (UTC when it has none), never the device's locale.
// An application still in process offers "Retirar mi postulación" (audit C-33).
export function DashboardApplications({
  orgSlug,
  orgName = '',
  timeZone = null,
}: {
  orgSlug: string;
  orgName?: string;
  timeZone?: string | null;
}) {
  const { t, locale } = useI18n();
  const pd = t.portalDashboard;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.myApplications.useQuery({ orgSlug });

  // Map the raw application status to a localized label and tone. Unknown statuses fall back to the raw
  // value (neutral) rather than rendering a blank pill. Withdrawn is the candidate's own choice: neutral,
  // not the error red of a rejection.
  const status = (s: string): { label: string; tone: StatusTone } => {
    switch (s) {
      case 'active':
        return { label: pd.statusActive, tone: 'brand' };
      case 'rejected':
        return { label: pd.statusRejected, tone: 'danger' };
      case 'hired':
        return { label: pd.statusHired, tone: 'success' };
      case 'withdrawn':
        return { label: pd.statusWithdrawn, tone: 'neutral' };
      default:
        return { label: s, tone: 'neutral' };
    }
  };

  const applications = data ?? [];

  return (
    <section aria-labelledby="dashboard-applications-title" className={DASHBOARD_CARD}>
      <h2 id="dashboard-applications-title" className={DASHBOARD_TITLE}>
        {pd.applications}
      </h2>

      {isLoading ? (
        <DashboardCardSkeleton label={pd.listLoading} />
      ) : isError ? (
        <ErrorState size="compact" title={pd.listError} onRetry={() => void refetch()} />
      ) : applications.length === 0 ? (
        <p className="text-body text-secondary">{pd.listEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => {
            const isOpen = expandedId === app.id;
            const phase = phaseText(candidatePhase(app.currentStage?.name, app.status), pd);
            const chip = status(app.status);
            return (
              <li key={app.id} className={DASHBOARD_ITEM}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-subheading font-semibold text-brand">{app.vacancy.title}</h3>
                    {app.vacancy.company?.name && (
                      <p className="break-words text-callout text-secondary">{app.vacancy.company.name}</p>
                    )}
                  </div>
                  <StatusBadge tone={chip.tone} className="self-start">
                    {chip.label}
                  </StatusBadge>
                </div>
                <p className="mt-1 text-callout text-secondary">
                  {pd.appliedOn} {formatCandidateDate(app.appliedAt, locale, timeZone)}
                </p>

                <div className="mt-3">
                  <p className="text-subheading font-medium text-primary">
                    <span className="font-normal text-secondary">{pd.currentStage}: </span>
                    {phase.label}
                  </p>
                  <p className="text-callout leading-relaxed text-secondary">{phase.description}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => setExpandedId(isOpen ? null : app.id)}
                    aria-expanded={isOpen}
                    className="-ml-3"
                  >
                    {isOpen ? pd.hideTimeline : pd.viewTimeline}
                  </Button>
                  {app.status === 'active' && (
                    <DashboardWithdrawApplication
                      orgSlug={orgSlug}
                      orgName={orgName}
                      applicationId={app.id}
                      vacancyTitle={app.vacancy.title}
                    />
                  )}
                </div>

                {isOpen && <DashboardApplicationTimeline orgSlug={orgSlug} applicationId={app.id} timeZone={timeZone} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatCandidateDate } from '../../../../../lib/candidate-format';
import { DashboardApplicationTimeline } from './dashboard-application-timeline';
import { DashboardWithdrawApplication } from './dashboard-withdraw-application';
import { candidatePhase, phaseText } from './candidate-phase';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading, isError } = trpc.candidatePortal.myApplications.useQuery({ orgSlug });

  // Map the raw application status to a localized, color-coded label. Unknown
  // statuses fall back to the raw value rather than rendering a blank pill.
  const statusLabel = (s: string) => {
    switch (s) {
      case 'active':
        return t.portalDashboard.statusActive;
      case 'rejected':
        return t.portalDashboard.statusRejected;
      case 'hired':
        return t.portalDashboard.statusHired;
      case 'withdrawn':
        return t.portalDashboard.statusWithdrawn;
      default:
        return s;
    }
  };
  const statusClasses = (s: string) => {
    if (s === 'hired') return 'bg-[#ECFDF3] text-[#067647]';
    if (s === 'rejected' || s === 'withdrawn') return 'bg-[#FEF3F2] text-[#B42318]';
    return 'bg-[#F4F1FF] text-[#1F114C]';
  };

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        <h2 className="text-[14px] font-semibold text-[#1F114C] mb-2">{t.portalDashboard.applications}</h2>
        <p className="text-[12px] text-muted">{t.portalDashboard.listLoading}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        <h2 className="text-[14px] font-semibold text-[#1F114C] mb-2">{t.portalDashboard.applications}</h2>
        <p className="text-[12px] text-[#B42318]">{t.portalDashboard.listError}</p>
      </section>
    );
  }

  const applications = data ?? [];

  return (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.applications}</h2>

      {applications.length === 0 ? (
        <p className="text-[12px] text-muted">{t.portalDashboard.listEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => {
            const isOpen = expandedId === app.id;
            const phase = phaseText(candidatePhase(app.currentStage?.name, app.status), t.portalDashboard);
            return (
              <li key={app.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">{app.vacancy.title}</p>
                    {app.vacancy.company?.name && (
                      <p className="text-[12px] text-muted truncate">{app.vacancy.company.name}</p>
                    )}
                    <p className="text-[11px] text-muted mt-1">
                      {t.portalDashboard.appliedOn} {formatCandidateDate(app.appliedAt, locale, timeZone)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(app.status)}`}
                  >
                    {statusLabel(app.status)}
                  </span>
                </div>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] text-[#585858]">
                      <span className="text-muted">{t.portalDashboard.currentStage}: </span>
                      {phase.label}
                    </p>
                    <p className="text-[11px] text-muted">{phase.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : app.id)}
                      aria-expanded={isOpen}
                      className="text-[12px] font-medium text-[#1F114C] hover:underline shrink-0"
                    >
                      {isOpen ? t.portalDashboard.hideTimeline : t.portalDashboard.viewTimeline}
                    </button>
                    {app.status === 'active' && (
                      <DashboardWithdrawApplication
                        orgSlug={orgSlug}
                        orgName={orgName}
                        applicationId={app.id}
                        vacancyTitle={app.vacancy.title}
                      />
                    )}
                  </div>
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

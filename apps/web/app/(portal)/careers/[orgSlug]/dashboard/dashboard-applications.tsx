'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { DashboardApplicationTimeline } from './dashboard-application-timeline';

// "My Applications" section of the candidate dashboard (Wave 1 Slice 2). Lists the
// signed-in candidate's applications at this org with status + current stage, and
// expands each into its stage timeline. Data comes from candidatePortal.* which
// resolves the candidate from the Supabase session — the orgSlug is the only input.
export function DashboardApplications({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
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
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.listLoading}</p>
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
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.listEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => {
            const isOpen = expandedId === app.id;
            return (
              <li key={app.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">{app.vacancy.title}</p>
                    {app.vacancy.company?.name && (
                      <p className="text-[12px] text-[#8B8B8B] truncate">{app.vacancy.company.name}</p>
                    )}
                    <p className="text-[11px] text-[#8B8B8B] mt-1">
                      {t.portalDashboard.appliedOn} {new Date(app.appliedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(app.status)}`}
                  >
                    {statusLabel(app.status)}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-[#585858]">
                    <span className="text-[#8B8B8B]">{t.portalDashboard.currentStage}: </span>
                    {app.currentStage.name}
                  </p>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : app.id)}
                    aria-expanded={isOpen}
                    className="text-[12px] font-medium text-[#1F114C] hover:underline shrink-0"
                  >
                    {isOpen ? t.portalDashboard.hideTimeline : t.portalDashboard.viewTimeline}
                  </button>
                </div>

                {isOpen && <DashboardApplicationTimeline orgSlug={orgSlug} applicationId={app.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

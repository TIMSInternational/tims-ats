'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../../../lib/i18n';
import { DashboardApplications } from './dashboard-applications';
import { DashboardInterviews } from './dashboard-interviews';
import { DashboardAssessments } from './dashboard-assessments';
import { DashboardOffer } from './dashboard-offer';
import { DashboardFaqChat } from './dashboard-faq-chat';

// Candidate dashboard shell. Renders the authenticated frame with the full
// dashboard: My Applications (Wave 1 Slice 2), My Interviews (Wave 1 Slice 3),
// My Offer (Wave 1 Slice 4), My Assessments (Wave 1.5a Slice 4).
// If the signed-in email has no Candidate at this org, shows an empty state instead.
export function PortalDashboardShell({
  orgSlug,
  orgName,
  displayName,
  hasCandidate,
}: {
  orgSlug: string;
  orgName: string;
  displayName: string;
  hasCandidate: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push(`/careers/${orgSlug}`);
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#F6F6F6]">
      <header className="bg-white border-b border-[#EDEDED]">
        <div className="max-w-[900px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
          <Link href={`/careers/${orgSlug}`} className="text-[14px] font-semibold text-[#1F114C] truncate">
            {orgName}
          </Link>
          <button
            onClick={signOut}
            className="text-[12px] text-[#8B8B8B] hover:text-[#585858] hover:underline shrink-0"
          >
            {t.portalDashboard.signOut}
          </button>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 md:px-6 py-8">
        <h1 className="text-[20px] font-bold text-[#1F114C] mb-1">
          {t.portalDashboard.welcome}, {displayName}
        </h1>

        {hasCandidate ? (
          <div className="mt-6 space-y-4">
            <DashboardApplications orgSlug={orgSlug} />
            <DashboardInterviews orgSlug={orgSlug} />
            <DashboardAssessments orgSlug={orgSlug} />
            <DashboardOffer orgSlug={orgSlug} />
            <DashboardFaqChat orgSlug={orgSlug} />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#EDEDED] p-8 text-center mt-4">
            <h2 className="text-[15px] font-semibold text-[#1F114C] mb-2">{t.portalDashboard.noCandidateTitle}</h2>
            <p className="text-[13px] text-[#585858] mb-5">{t.portalDashboard.noCandidateDesc}</p>
            <Link
              href={`/careers/${orgSlug}`}
              className="inline-flex h-10 items-center rounded-xl bg-[#1F114C] px-5 text-[13px] font-semibold text-white hover:bg-[#2a1a5e] transition"
            >
              {t.portalDashboard.backToJobs}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

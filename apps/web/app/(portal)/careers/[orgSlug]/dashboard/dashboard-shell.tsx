'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../../../../lib/i18n';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { DashboardApplications } from './dashboard-applications';
import { DashboardInterviews } from './dashboard-interviews';
import { DashboardAssessments } from './dashboard-assessments';
import { DashboardProviderAssessments } from './dashboard-provider-assessments';
import { isProviderAssessmentsPortalEnabled } from '../../../../../lib/platform-api/assessment-provider-portal';
import { DashboardOffer } from './dashboard-offer';
import { DashboardFaqChat } from './dashboard-faq-chat';
import { DashboardPrivacy } from './dashboard-privacy';
import { DashboardProfile, type CandidateProfileView } from './dashboard-profile';
import { Button } from '../../../../../components/button';
import { EmptyState } from '../../../../../components/empty-state';
import { OrgLogo } from '../../../../../components/org-logo';
import { usePortalOrgBrand } from '../_components/portal-org-brand';

// Candidate dashboard shell. Renders the authenticated frame with the full
// dashboard: My Applications (Wave 1 Slice 2), My Interviews (Wave 1 Slice 3),
// My Offer (Wave 1 Slice 4), My Assessments (Wave 1.5a Slice 4), and the account actions of audit C-33:
// "Mis datos" (correct name/phone/location), "Retirar mi postulación" and an always-visible privacy panel.
// If the signed-in email has no Candidate at this org, shows an empty state instead.
export function PortalDashboardShell({
  orgSlug,
  orgName,
  displayName,
  hasCandidate,
  consentWithdrawnAt = null,
  timeZone = null,
  profile = null,
  contactEmail = null,
}: {
  orgSlug: string;
  orgName: string;
  displayName: string;
  hasCandidate: boolean;
  consentWithdrawnAt?: string | null;
  /**
   * The organization's IANA time zone (settings.timezone). When null, interviews use their vacancy company's
   * zone (as the interview email does) and everything else UTC.
   */
  timeZone?: string | null;
  /** The candidate's own correctable details, server-rendered; null when there is no candidate. */
  profile?: CandidateProfileView | null;
  /** The organization's candidate contact mailbox for data requests; null when none is configured. */
  contactEmail?: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const pilot = isPilotScope();
  const brand = usePortalOrgBrand();

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push(`/careers/${orgSlug}`);
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex h-14 max-w-[900px] items-center justify-between gap-3 px-4 md:px-6">
          <Link href={`/careers/${orgSlug}`} className="flex min-w-0 items-center gap-2">
            <OrgLogo
              logo={brand?.logo ?? null}
              name={orgName}
              imgClassName="h-7 w-auto max-w-[120px] shrink-0 object-contain"
              fallbackClassName="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand text-callout font-bold text-white"
              decorative
            />
            <span className="truncate text-subheading font-semibold text-brand">{orgName}</span>
          </Link>
          <Button variant="tertiary" size="sm" onClick={() => void signOut()} className="shrink-0">
            {t.portalDashboard.signOut}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-4 py-6 md:px-6 md:py-8">
        <h1 className="break-words font-display text-title font-bold text-brand">
          {t.portalDashboard.welcome}, {displayName}
        </h1>

        {hasCandidate ? (
          <div className="mt-6 space-y-4">
            <DashboardApplications orgSlug={orgSlug} orgName={orgName} timeZone={timeZone} />
            <DashboardInterviews orgSlug={orgSlug} timeZone={timeZone} />
            {/* Pilot launch scope: no assessments and no AI FAQ chat (lib/launch-scope.ts). */}
            {!pilot && <DashboardAssessments orgSlug={orgSlug} hideWhenEmpty={isProviderAssessmentsPortalEnabled()} />}
            {/* AS-5 / D16: provider assessments (C# only), dark unless NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP. */}
            {!pilot && isProviderAssessmentsPortalEnabled() && (
              <DashboardProviderAssessments orgSlug={orgSlug} orgName={orgName} />
            )}
            <DashboardOffer orgSlug={orgSlug} timeZone={timeZone} />
            {!pilot && <DashboardFaqChat orgSlug={orgSlug} />}
            {profile && <DashboardProfile orgSlug={orgSlug} profile={profile} />}
            <DashboardPrivacy
              orgSlug={orgSlug}
              orgName={orgName}
              withdrawnAt={consentWithdrawnAt}
              contactEmail={contactEmail}
            />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              className="rounded-2xl border border-border bg-white"
              title={t.portalDashboard.noCandidateTitle}
              description={t.portalDashboard.noCandidateDesc}
              action={{ label: t.portalDashboard.backToJobs, href: `/careers/${orgSlug}` }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

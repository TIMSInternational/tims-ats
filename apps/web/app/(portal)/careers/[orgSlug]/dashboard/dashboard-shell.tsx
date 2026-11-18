'use client';

import { useRouter } from 'next/navigation';
import { Inbox } from 'lucide-react';
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
import { usePortalOrgBrand } from '../_components/portal-org-brand';
import { EvalPage } from './eval-page';
import { EvalBigIcon } from './eval-big-icon';
import { EvalButton } from './eval-button';
import { FRAME_LEAVE_CLASSES } from './provider-frame-styles';
import {
  DASHBOARD_EYEBROW,
  DASHBOARD_GREETING,
  DASHBOARD_SECTIONS,
  DASHBOARD_STATE,
  DASHBOARD_STATE_ACTION,
  DASHBOARD_STATE_LEAD,
  DASHBOARD_STATE_TITLE,
} from './dashboard-styles';

// Candidate dashboard shell, in the TIMS evaluation design (round 5: the PCA respondent app's look, so the candidate
// goes from here to a test inside one look): the navy page, the PCA header (the organization's logo back to its job
// board, the TIMS mark, "Sign out"), one white sheet with the eyebrow "Portal del candidato" and the serif greeting,
// then the sections — My Applications (Wave 1 Slice 2), My Interviews (Wave 1 Slice 3), the assessments (Wave 1.5a
// Slice 4; AS-5 provider assessments), My Offer (Wave 1 Slice 4), the FAQ assistant, and the account actions of audit
// C-33: "Mis datos" (correct name/phone/location), "Retirar mi postulación" and an always-visible privacy panel.
// If the signed-in email has no Candidate at this org, a PCA state block says so instead.
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
    <EvalPage
      orgSlug={orgSlug}
      orgName={orgName}
      orgLogo={brand?.logo ?? null}
      headerEnd={
        <button type="button" className={FRAME_LEAVE_CLASSES} onClick={() => void signOut()}>
          {t.portalDashboard.signOut}
        </button>
      }
    >
      <p className={DASHBOARD_EYEBROW}>{t.portalDashboard.eyebrow}</p>
      <h1 className={DASHBOARD_GREETING}>
        {t.portalDashboard.welcome}, {displayName}
      </h1>

      {hasCandidate ? (
        <div className={DASHBOARD_SECTIONS}>
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
        <section aria-labelledby="dashboard-no-candidate-title" className={DASHBOARD_STATE}>
          <EvalBigIcon tone="neutral">
            <Inbox aria-hidden="true" />
          </EvalBigIcon>
          <h2 id="dashboard-no-candidate-title" className={DASHBOARD_STATE_TITLE}>
            {t.portalDashboard.noCandidateTitle}
          </h2>
          <p className={DASHBOARD_STATE_LEAD}>{t.portalDashboard.noCandidateDesc}</p>
          <EvalButton href={`/careers/${orgSlug}`} width="bar" className={DASHBOARD_STATE_ACTION}>
            {t.portalDashboard.backToJobs}
          </EvalButton>
        </section>
      )}
    </EvalPage>
  );
}

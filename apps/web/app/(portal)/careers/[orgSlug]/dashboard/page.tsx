import 'server-only';
import { getUser } from '@tims/auth/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@tims/db';
import { candidatePortalService } from '@tims/api';
import { PortalDashboardShell } from './dashboard-shell';
import { DashboardVerifyEmail } from './dashboard-verify-email';
import { findConsentWithdrawnAt } from './consent-status';
import { orgSettingsTimeZone } from '../../../../../lib/candidate-format';

// Authenticated candidate landing. Server-resolves identity by (Supabase email) ×
// (org from the route) → Candidate. No staff User / org-membership involved. The
// org-by-slug lookup uses the privileged db (same pattern as the careers layout),
// but the CANDIDATE read goes through the tenant-scoped service (runWithTenant +
// tenantDb) so it runs under RLS like every other candidate read in the portal.
export default async function PortalDashboardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;

  const supabaseUser = await getUser();
  if (!supabaseUser?.email) redirect(`/careers/${orgSlug}/login`);
  // An unconfirmed email is not an identity: the candidate lookup below is by email, so it must never run for an
  // address its holder has not proven (a magic-link login always confirms it; a password sign-up may not).
  if (!supabaseUser.email_confirmed_at) return <DashboardVerifyEmail orgSlug={orgSlug} />;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, isActive: true, settings: true, billingEmail: true },
  });
  if (!org || !org.isActive) notFound();

  const candidate = await candidatePortalService.getDisplayCandidate(org.id, supabaseUser.email);
  const consentWithdrawnAt = candidate ? await findConsentWithdrawnAt(org.id, supabaseUser.email) : null;

  const displayName = candidate ? `${candidate.firstName} ${candidate.lastName}`.trim() : supabaseUser.email;
  // "Mis datos": what the candidate may correct. The email is the session identity, shown read-only.
  const profile = candidate
    ? {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: supabaseUser.email,
        phone: candidate.phone ?? null,
        location: candidate.location ?? null,
      }
    : null;

  return (
    <PortalDashboardShell
      orgSlug={orgSlug}
      orgName={org.name}
      displayName={displayName}
      hasCandidate={candidate !== null}
      consentWithdrawnAt={consentWithdrawnAt}
      // The organization's own zone. Interviews and offers fall back per item to their vacancy company's zone
      // (candidateTimeZone), as their emails do; everything else falls back to UTC.
      timeZone={orgSettingsTimeZone(org.settings)}
      profile={profile}
      // Only a real candidate of this org gets the contact (it may be the billing email): never any signed-in visitor.
      contactEmail={candidate ? candidatePortalService.getContactEmail(org) : null}
    />
  );
}

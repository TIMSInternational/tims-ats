import { ACTIVE_APPLICATION_CONSENT_VARIANT } from '@tims/shared';
import { db } from '@tims/db';
import { notFound } from 'next/navigation';
import { publicCandidateContactEmail } from './candidate-contact-email';
import { PrivacyNotice } from './privacy-notice';
import { PrivacyNoticeLey8968 } from './privacy-notice-ley-8968';

// Public, platform-default candidate privacy notice for one organization's careers
// portal — linked from the explicit consent checkbox on the apply form. The parent
// layout already 404s unknown/inactive orgs; this only reads the display name.
// A per-organization policy URL setting is a follow-up (none exists in the schema).
//
// The notice is the one the consent version names (ACTIVE_APPLICATION_CONSENT_VARIANT): the
// country-neutral default, or — only when the Ley N.° 8968 variant is on — the Costa Rica notice,
// whose per-organization part is the candidate contact mailbox (settings.candidateContactEmail only,
// never billing_email, see candidate-contact-email.ts), resolved HERE so only that one address
// reaches the client, never the settings jsonb.
export default async function CareersPrivacyPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ley8968 = ACTIVE_APPLICATION_CONSENT_VARIANT === 'ley8968';
  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true, isActive: true, settings: ley8968 },
  });
  if (!org || !org.isActive) notFound();

  if (ley8968) {
    return (
      <PrivacyNoticeLey8968
        orgName={org.name}
        orgSlug={orgSlug}
        contactEmail={publicCandidateContactEmail(org.settings)}
      />
    );
  }
  return <PrivacyNotice orgName={org.name} orgSlug={orgSlug} />;
}

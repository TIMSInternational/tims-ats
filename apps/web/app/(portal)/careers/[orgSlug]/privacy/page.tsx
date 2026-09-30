import { db } from '@tims/db';
import { notFound } from 'next/navigation';
import { PrivacyNotice } from './privacy-notice';

// Public, platform-default candidate privacy notice for one organization's careers
// portal — linked from the explicit consent checkbox on the apply form. The parent
// layout already 404s unknown/inactive orgs; this only reads the display name.
// A per-organization policy URL setting is a follow-up (none exists in the schema).
export default async function CareersPrivacyPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { name: true, isActive: true },
  });
  if (!org || !org.isActive) notFound();

  return <PrivacyNotice orgName={org.name} orgSlug={orgSlug} />;
}

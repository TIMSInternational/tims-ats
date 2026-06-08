import 'server-only';
import { getUser } from '@tims/auth/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@tims/db';
import { PortalMeShell } from './me-shell';

// Authenticated candidate landing. Server-resolves identity by (Supabase email) ×
// (org from the route) → Candidate. No staff User / org-membership involved. The
// org filter is explicit (privileged db, same pattern as the careers layout).
export default async function PortalMePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const supabaseUser = await getUser();
  if (!supabaseUser?.email) redirect(`/careers/${orgSlug}/login`);

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, isActive: true },
  });
  if (!org || !org.isActive) notFound();

  const candidate = await db.candidate.findFirst({
    where: { organizationId: org.id, email: supabaseUser.email, isActive: true, deletedAt: null },
    select: { firstName: true, lastName: true },
  });

  const displayName = candidate
    ? `${candidate.firstName} ${candidate.lastName}`.trim()
    : supabaseUser.email;

  return (
    <PortalMeShell
      orgSlug={orgSlug}
      orgName={org.name}
      displayName={displayName}
      hasCandidate={candidate !== null}
    />
  );
}

import 'server-only';
import { getUser } from '@tims/auth/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@tims/db';
import { AssessmentPlayerShell } from './_components/assessment-player-shell';

// Direct-URL-only entry point (Wave 1.5a slice 3). Slice 4 (the /me dashboard
// "My Assessments" section) will link here; until then this page has no
// discoverable entry point from the candidate dashboard, matching the design
// doc's vertical slice ordering.
export default async function AssessmentPlayerPage({
  params,
}: {
  params: Promise<{ orgSlug: string; assignmentId: string }>;
}) {
  const { orgSlug, assignmentId } = await params;

  const supabaseUser = await getUser();
  if (!supabaseUser?.email) redirect(`/careers/${orgSlug}/login`);

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, isActive: true },
  });
  if (!org || !org.isActive) notFound();

  return <AssessmentPlayerShell orgSlug={orgSlug} assignmentId={assignmentId} />;
}

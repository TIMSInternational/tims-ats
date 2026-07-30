import 'server-only';
import { getUser } from '@tims/auth/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@tims/db';
import { AssessmentPlayerShell } from './_components/assessment-player-shell';

// Reachable two ways: directly by URL, and (as of Wave 1.5a Slice 4) linked
// from the candidate dashboard's "My Assessments" section
// (dashboard-assessments.tsx).
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

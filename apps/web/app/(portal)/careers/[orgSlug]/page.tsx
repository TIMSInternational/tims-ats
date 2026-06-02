import { db } from '@tims/db';
import { notFound } from 'next/navigation';
import { JobBoard } from './job-board';

export default async function JobBoardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true },
  });

  if (!org) notFound();

  return <JobBoard organizationId={org.id} orgName={org.name} orgSlug={orgSlug} />;
}

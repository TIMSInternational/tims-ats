import type { Metadata } from 'next';
import { db } from '@tims/db';
import { notFound } from 'next/navigation';
import { JobBoard } from './job-board';
import { buildBoardMetadata, loadBoardMetadataSource } from './_lib/careers-metadata';

export async function generateMetadata({ params }: { params: Promise<{ orgSlug: string }> }): Promise<Metadata> {
  const { orgSlug } = await params;
  return buildBoardMetadata(await loadBoardMetadataSource(orgSlug));
}

export default async function JobBoardPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;

  const org = await db.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true, name: true, logo: true },
  });

  if (!org) notFound();

  return <JobBoard organizationId={org.id} orgName={org.name} orgLogo={org.logo} orgSlug={orgSlug} />;
}

import type { Metadata } from 'next';
import { JobDetailView } from './_components/job-detail-view';
import { buildVacancyMetadata, loadVacancyMetadataSource } from '../_lib/careers-metadata';

type JobDetailParams = { params: Promise<{ orgSlug: string; vacancyId: string }> };

// Server component so shared vacancy links carry a real title / description / Open Graph preview
// ("<vacancy> — <organization>"); the page body is still the client-rendered JobDetailView.
export async function generateMetadata({ params }: JobDetailParams): Promise<Metadata> {
  const { orgSlug, vacancyId } = await params;
  return buildVacancyMetadata(await loadVacancyMetadataSource(orgSlug, vacancyId));
}

export default async function JobDetailPage({ params }: JobDetailParams) {
  const { orgSlug, vacancyId } = await params;
  return <JobDetailView orgSlug={orgSlug} vacancyId={vacancyId} />;
}

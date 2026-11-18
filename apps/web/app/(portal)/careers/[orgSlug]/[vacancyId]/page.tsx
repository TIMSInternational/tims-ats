import type { Metadata } from 'next';
import { JobDetailView } from './_components/job-detail-view';
import { JobPostingJsonLd } from './_components/job-posting-json-ld';
import { buildVacancyMetadata, loadVacancyMetadataSource } from '../_lib/careers-metadata';
import { loadJobPosting } from '../_lib/job-posting-source';

type JobDetailParams = { params: Promise<{ orgSlug: string; vacancyId: string }> };

// Server component so shared vacancy links carry a real title / description / Open Graph preview
// ("<vacancy> — <organization>"); the page body is still the client-rendered JobDetailView.
export async function generateMetadata({ params }: JobDetailParams): Promise<Metadata> {
  const { orgSlug, vacancyId } = await params;
  return buildVacancyMetadata(await loadVacancyMetadataSource(orgSlug, vacancyId));
}

export default async function JobDetailPage({ params }: JobDetailParams) {
  const { orgSlug, vacancyId } = await params;
  // schema.org JobPosting for search engines; null unless CAREERS_SEO_ENABLED is on, the organization is in
  // CAREERS_SEO_ORG_SLUGS and the vacancy is public.
  const posting = await loadJobPosting(orgSlug, vacancyId);
  return (
    <>
      {posting && <JobPostingJsonLd posting={posting} />}
      <JobDetailView orgSlug={orgSlug} vacancyId={vacancyId} />
    </>
  );
}

'use client';

import { use } from 'react';
import { JobDetailView } from './_components/job-detail-view';

export default function JobDetailPage({ params }: { params: Promise<{ orgSlug: string; vacancyId: string }> }) {
  const { orgSlug, vacancyId } = use(params);
  return <JobDetailView orgSlug={orgSlug} vacancyId={vacancyId} />;
}

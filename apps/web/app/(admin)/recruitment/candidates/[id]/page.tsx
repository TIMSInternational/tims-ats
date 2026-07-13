'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../../components';
import { CandidateHeader } from './candidate-header';
import { ProfileTab } from './profile-tab';
import { AssessmentResults } from './assessment-results';
import { FitBreakdown } from './fit-breakdown';
import { StageTimeline } from './stage-timeline';
import { DocumentsCard } from './documents-card';
import { TagsCard } from './tags-card';
import { CandidateTimeline } from './candidate-timeline';
import { RiskFlags } from './risk-flags';
import { CvParseCard } from './cv-parse-card';
import { ScreenCandidateCard } from './screen-candidate-card';

const TABS = [
  'tabProfile', 'tabApplications', 'tabAssessments', 'tabInterviews',
  'tabFitGaps', 'tabDocuments', 'tabValidations', 'tabTimeline', 'tabNotes',
] as const;

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<string>('tabProfile');

  const candidate = trpc.candidate.getById.useQuery({ id });
  const timeline = trpc.candidate.getTimeline.useQuery({ candidateId: id });

  if (candidate.isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
          <Skeleton className="h-5 w-64 rounded" />
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <Skeleton className="h-40 w-full rounded-xl mb-6" />
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:flex-[60] space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
            <div className="w-full md:flex-[40] space-y-4">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (candidate.isError) {
    return (
      <div className="h-full flex items-center justify-center">
        <ErrorState onRetry={() => candidate.refetch()} />
      </div>
    );
  }

  if (!candidate.data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[#8B8B8B]">{t.common.noResults}</p>
      </div>
    );
  }

  const c = candidate.data;
  const appCount = c.applications?.length ?? 0;
  const tabLabels: Record<string, string> = {
    tabProfile: t.candidates.tabProfile,
    tabApplications: `${t.candidates.tabApplications} (${appCount})`,
    tabAssessments: t.candidates.tabAssessments,
    tabInterviews: t.candidates.tabInterviews,
    tabFitGaps: t.candidates.tabFitGaps,
    tabDocuments: t.candidates.tabDocuments,
    tabValidations: t.candidates.tabValidations,
    tabTimeline: t.candidates.tabTimeline,
    tabNotes: t.candidates.tabNotes,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar breadcrumb */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/recruitment/candidates" className="text-[13px] text-[#8B8B8B] hover:text-[#585858] transition">
            {t.candidates.title}
          </Link>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{c.firstName} {c.lastName}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header Card */}
        <CandidateHeader candidate={c} />

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[#EDEDED] overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-medium transition shrink-0 whitespace-nowrap ${
                activeTab === tab
                  ? 'text-[#1F114C] border-b-2 border-[#DD0C15]'
                  : 'text-[#8B8B8B] hover:text-[#585858]'
              }`}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/* Two Columns */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left 60% */}
          <div className="w-full md:flex-[60] space-y-4">
            <ProfileTab candidate={c} />
          </div>

          {/* Right 40% */}
          <div className="w-full md:flex-[40] space-y-4">
            {c.assessmentAssignments.length > 0 && (
              <AssessmentResults assignments={c.assessmentAssignments} fitScores={c.fitScores} />
            )}
            {c.fitScores.length > 0 && <FitBreakdown fitScores={c.fitScores} />}
            <ScreenCandidateCard candidateId={id} vacancies={c.applications.map((a) => a.vacancy)} />
            <CvParseCard candidateId={id} />
            <StageTimeline applications={c.applications} />
            <TagsCard tags={c.tags} candidateId={id} />
            <RiskFlags />
            <CandidateTimeline events={timeline.data ?? []} isLoading={timeline.isLoading} isError={timeline.isError} />
          </div>
        </div>
      </div>
    </div>
  );
}

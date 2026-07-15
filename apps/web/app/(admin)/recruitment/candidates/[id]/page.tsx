'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../../components';
import { CandidateHeader } from './candidate-header';
import { ApplicationsCard, PersonalInfoCard, ProfileTab } from './profile-tab';
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

type TabKey = (typeof TABS)[number];

function EmptyTabPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="bg-white rounded-xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-2">{title}</h3>
      <p className="text-[12px] text-[#8B8B8B]">{message}</p>
    </div>
  );
}

function NotesPanel({ title, notes, empty }: { title: string; notes: string | null | undefined; empty: string }) {
  const value = notes?.trim();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{title}</h3>
      {value ? (
        <p className="text-[13px] text-[#585858] whitespace-pre-wrap leading-relaxed">{value}</p>
      ) : (
        <p className="text-[12px] text-[#8B8B8B] py-4 text-center">{empty}</p>
      )}
    </div>
  );
}

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>('tabProfile');

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

  const empty = t.common.noResults;

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'tabProfile':
        return (
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:flex-[60] space-y-4">
              <ProfileTab candidate={c} />
            </div>
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
        );
      case 'tabApplications':
        return c.applications.length > 0
          ? <ApplicationsCard applications={c.applications} />
          : <EmptyTabPanel title={tabLabels.tabApplications} message={empty} />;
      case 'tabAssessments':
        return c.assessmentAssignments.length > 0
          ? <AssessmentResults assignments={c.assessmentAssignments} fitScores={c.fitScores} />
          : <EmptyTabPanel title={tabLabels.tabAssessments} message={empty} />;
      case 'tabInterviews':
        return <EmptyTabPanel title={tabLabels.tabInterviews} message={empty} />;
      case 'tabFitGaps':
        return (
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4">
            {c.fitScores.length > 0
              ? <FitBreakdown fitScores={c.fitScores} />
              : <EmptyTabPanel title={tabLabels.tabFitGaps} message={empty} />}
            <ScreenCandidateCard candidateId={id} vacancies={c.applications.map((a) => a.vacancy)} />
          </div>
        );
      case 'tabDocuments':
        return <DocumentsCard documents={c.documents} />;
      case 'tabValidations':
        return (
          <div className="space-y-4">
            <RiskFlags />
            <EmptyTabPanel title={tabLabels.tabValidations} message={empty} />
          </div>
        );
      case 'tabTimeline':
        return <CandidateTimeline events={timeline.data ?? []} isLoading={timeline.isLoading} isError={timeline.isError} />;
      case 'tabNotes':
        return <NotesPanel title={tabLabels.tabNotes} notes={c.notes} empty={empty} />;
      default:
        return (
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:flex-[60] space-y-4">
              <PersonalInfoCard candidate={c} />
            </div>
          </div>
        );
    }
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
              type="button"
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

        {renderActiveTab()}
      </div>
    </div>
  );
}

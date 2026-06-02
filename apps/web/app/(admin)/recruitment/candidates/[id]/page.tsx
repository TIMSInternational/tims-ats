'use client';

import { use } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Skeleton, CandidateAvatar, FitScoreBadge } from '../../../../../components';
import { ProfileInfo } from './profile-info';
import { ApplicationsList } from './applications-list';
import { AssessmentResults } from './assessment-results';
import { DocumentsCard } from './documents-card';
import { TagsCard } from './tags-card';
import { CandidateTimeline } from './candidate-timeline';

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const candidate = trpc.candidate.getById.useQuery({ id });
  const timeline = trpc.candidate.getTimeline.useQuery({ candidateId: id });

  if (candidate.isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
          <Skeleton className="h-5 w-64 rounded" />
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <Skeleton className="h-32 w-full rounded-xl mb-6" />
          <div className="flex gap-6">
            <div className="flex-[60] space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
            <div className="flex-[40] space-y-4">
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          </div>
        </div>
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
  const fitScore = c.fitScores?.[0]?.overallScore;
  const poolLabels: Record<string, string> = {
    applicant: t.candidates.poolApplicant,
    referral: t.candidates.poolReferral,
    sourced: t.candidates.poolSourced,
    silver_medalist: t.candidates.poolSilverMedalist,
    passive: t.candidates.poolPassive,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/recruitment/candidates" className="text-[13px] text-[#8B8B8B] hover:text-[#585858] transition">
            {t.candidates.title}
          </Link>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{c.firstName} {c.lastName}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-medium">
            {poolLabels[c.poolType] ?? c.poolType}
          </span>
          <span className="text-[11px] text-[#8B8B8B]">{c.source}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header Card */}
        <div className="bg-white rounded-xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.06)] mb-6">
          <div className="flex items-start gap-6">
            <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="lg" />
            <div className="flex-1">
              <h1 className="text-xl font-bold text-[#1F114C] mb-1">{c.firstName} {c.lastName}</h1>
              {(c.currentTitle || c.currentCompany) && (
                <p className="text-[13px] text-[#585858] mb-2">
                  {c.currentTitle}{c.currentTitle && c.currentCompany ? ' — ' : ''}{c.currentCompany}
                </p>
              )}
              <div className="flex items-center gap-4 text-[12px] text-[#8B8B8B] flex-wrap">
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                  {c.email}
                </span>
                {c.phone && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
                    {c.phone}
                  </span>
                )}
                {c.location && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                    {c.location}
                  </span>
                )}
                {c.linkedinUrl && (
                  <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.06l4.5-4.5a4.5 4.5 0 00-6.364-6.364l-1.757 1.757" /></svg>
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
            {fitScore != null && (
              <div className="flex flex-col items-center shrink-0">
                <FitScoreBadge score={fitScore} size="lg" />
                <span className="text-[10px] text-[#8B8B8B] mt-1">FIT Score</span>
              </div>
            )}
          </div>
        </div>

        {/* Two Columns */}
        <div className="flex gap-6">
          {/* Left 60% */}
          <div className="flex-[60] space-y-4">
            <ProfileInfo candidate={c} />
            {c.applications.length > 0 && <ApplicationsList applications={c.applications} />}
          </div>

          {/* Right 40% */}
          <div className="flex-[40] space-y-4">
            {c.assessmentAssignments.length > 0 && (
              <AssessmentResults assignments={c.assessmentAssignments} fitScores={c.fitScores} />
            )}
            <DocumentsCard documents={c.documents} />
            <TagsCard tags={c.tags} candidateId={id} />
            <CandidateTimeline events={timeline.data ?? []} isLoading={timeline.isLoading} />
          </div>
        </div>
      </div>
    </div>
  );
}

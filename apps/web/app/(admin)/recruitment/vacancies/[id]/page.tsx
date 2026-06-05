'use client';

import { use } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate, formatCurrency } from '../../../../../lib/format-utils';
import { StatusBadge, Skeleton } from '../../../../../components';
import { GeneralInfo } from './general-info';
import { JobProfileCard } from './job-profile-card';
import { ChannelsCard } from './channels-card';
import { CandidatesSummary } from './candidates-summary';
import { SlaCard } from './sla-card';
import { ApprovalChain } from './approval-chain';

export default function VacancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const vacancy = trpc.vacancy.getById.useQuery({ id });
  const stats = trpc.vacancy.getStats.useQuery({ id });

  const statusMap: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'bg-gray-100 text-gray-600', label: t.vacancies.statusDraft },
    pending_approval: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: t.vacancies.statusPendingApproval },
    approved: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: t.vacancies.statusApproved },
    published: { cls: 'bg-green-50 text-green-600 border border-green-200', label: t.vacancies.statusPublished },
    closed: { cls: 'bg-red-50 text-red-600', label: t.vacancies.statusClosed },
    frozen: { cls: 'bg-purple-50 text-purple-600 border border-purple-200', label: t.vacancies.statusFrozen },
  };

  if (vacancy.isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
          <Skeleton className="h-5 w-64 rounded" />
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:flex-[65] space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <div className="w-full md:flex-[35] space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!vacancy.data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[#8B8B8B]">{t.common.noResults}</p>
      </div>
    );
  }

  const v = vacancy.data;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/recruitment/vacancies" className="text-[13px] text-[#8B8B8B] hover:text-[#585858] transition">
            {t.sidebar.vacancies}
          </Link>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{v.title}</span>
          <StatusBadge status={v.status} map={statusMap} />
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/recruitment/vacancies/${id}`}
            className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px] hover:bg-[#F6F6F6] transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
            {t.vacancies.editVacancy}
          </Link>
          <Link
            href={`/recruitment/pipeline?vacancy=${id}`}
            className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition"
          >
            {t.vacancies.viewPipeline}
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Column 65% */}
          <div className="w-full md:flex-[65] space-y-4">
            <GeneralInfo vacancy={v} />
            {v.jobProfile && <JobProfileCard jobProfile={v.jobProfile} />}
            {v.channels.length > 0 && <ChannelsCard channels={v.channels} />}
          </div>

          {/* Right Column 35% */}
          <div className="w-full md:flex-[35] space-y-4">
            <CandidatesSummary
              vacancyId={id}
              stats={stats.data ?? null}
              isLoading={stats.isLoading}
            />
            <SlaCard vacancy={v} />
            {v.approvals.length > 0 && <ApprovalChain approvals={v.approvals} />}
          </div>
        </div>
      </div>
    </div>
  );
}

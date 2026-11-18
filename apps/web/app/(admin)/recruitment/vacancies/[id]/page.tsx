'use client';

import { use } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate, formatCurrency } from '../../../../../lib/format-utils';
import { StatusBadge, ErrorState, Skeleton } from '../../../../../components';
import { GeneralInfo } from './general-info';
import { JobProfileCard } from './job-profile-card';
import { ChannelsCard } from './channels-card';
import { PublicUrlCard } from './public-url-card';
import { CandidatesSummary } from './candidates-summary';
import { SlaCard } from './sla-card';
import { ApprovalChain } from './approval-chain';
import { FitRanking } from './fit-ranking';
import { RoleFamilyCard } from './role-family-card';
import { FitRequirementsCard } from './fit-requirements-card';
import { VacancyAssessmentsCard } from './vacancy-assessments-card';
import { SubmitForApprovalCta } from './submit-for-approval-cta';
import { VacancyLifecycleActions } from './vacancy-lifecycle-actions';
import { vacancyStatusMap } from '../vacancy-status';

export default function VacancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const vacancy = trpc.vacancy.getById.useQuery({ id });
  const stats = trpc.vacancy.getStats.useQuery({ id });

  const statusMap = vacancyStatusMap(t.vacancies);

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

  if (vacancy.isError) {
    return (
      <div className="h-full flex items-center justify-center">
        <ErrorState onRetry={() => vacancy.refetch()} error={vacancy.error} />
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
        <div className="flex flex-wrap items-center gap-3">
          {/* A draft's next step, as the primary action (it was a small link at the bottom of the page). */}
          <SubmitForApprovalCta vacancyId={id} vacancyStatus={v.status} />
          {/* Editar (drawer on vacancy.update), Congelar and Reanudar. */}
          <VacancyLifecycleActions vacancy={v} />
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
        {/* A-08: say plainly what "Congelada" means and that it can be undone. */}
        {v.status === 'frozen' && (
          <p role="status" className="mb-4 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-[12px] text-purple-800">
            {t.vacancies.frozenNotice}
          </p>
        )}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left Column 65% */}
          <div className="w-full md:flex-[65] space-y-4">
            <GeneralInfo vacancy={v} />
            <PublicUrlCard vacancyId={id} vacancyStatus={v.status} />
            {v.jobProfile && <JobProfileCard jobProfile={v.jobProfile} />}
            {v.status !== 'draft' && v.status !== 'pending_approval' && (
              <ChannelsCard vacancyId={id} vacancyStatus={v.status} channels={v.channels} />
            )}
          </div>

          {/* Right Column 35% */}
          <div className="w-full md:flex-[35] space-y-4">
            <CandidatesSummary
              vacancyId={id}
              stats={stats.data ?? null}
              isLoading={stats.isLoading}
              isError={stats.isError}
            />
            <SlaCard vacancy={v} />
            <RoleFamilyCard vacancyId={id} roleFamily={v.roleFamily ?? null} />
            <FitRequirementsCard vacancyId={id} fitRequirements={v.jobProfile?.fitRequirements ?? null} />
            <VacancyAssessmentsCard vacancyId={id} />
            {(v.approvals.length > 0 || v.status === 'draft') && (
              <ApprovalChain vacancyId={id} vacancyStatus={v.status} approvals={v.approvals} />
            )}
          </div>
        </div>

        <div className="mt-6">
          <FitRanking vacancyId={id} />
        </div>
      </div>
    </div>
  );
}

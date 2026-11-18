'use client';

import { use } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Button, ErrorState, PageHeader, Skeleton, StatusBadge } from '../../../../../components';
import { GeneralInfo } from './general-info';
import { JobProfileCard } from './job-profile-card';
import { ChannelsCard } from './channels-card';
import { PublicUrlCard } from './public-url-card';
import { CandidatesSummary } from './candidates-summary';
import { SlaCard } from './sla-card';
import { ApprovalChain } from './approval-chain';
import { ApprovalDecisionCallout } from './approval-decision-callout';
import { FitRanking } from './fit-ranking';
import { RoleFamilyCard } from './role-family-card';
import { FitRequirementsCard } from './fit-requirements-card';
import { VacancyAssessmentsCard } from './vacancy-assessments-card';
import { SubmitForApprovalCta } from './submit-for-approval-cta';
import { VacancyLifecycleActions } from './vacancy-lifecycle-actions';
import { vacancyStatusMap } from '../vacancy-status';

const CONTENT = 'mx-auto w-full max-w-6xl px-4 py-5 md:px-6 md:py-6';
const COLUMNS = 'grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]';

export default function VacancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const vacancy = trpc.vacancy.getById.useQuery({ id });
  const stats = trpc.vacancy.getStats.useQuery({ id });

  const statusMap = vacancyStatusMap(t.vacancies);
  const back = { href: '/recruitment/vacancies', label: t.sidebar.vacancies };

  // isPending, not isLoading: a query paused offline has no data yet and must not read as "not found".
  if (vacancy.isPending) {
    return (
      <div className="flex h-full flex-col overflow-hidden" aria-busy="true">
        <span className="sr-only" role="status">
          {t.common.loadingContent}
        </span>
        <div className="flex min-h-16 shrink-0 flex-col justify-center gap-2 border-b border-border bg-white px-4 py-3 md:px-6">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-6 w-64 max-w-full rounded" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className={`${CONTENT} ${COLUMNS}`}>
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-64 w-full rounded-xl" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // A vacancy outside the caller's organisation, or deleted, answers NOT_FOUND: a retry can never work, so say
  // what happened and offer the way back (feedback.md: help people understand why).
  const notFound = vacancy.error?.data?.code === 'NOT_FOUND' || (vacancy.isSuccess && !vacancy.data);
  if (notFound) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState
          variant="notFound"
          title={t.vacancies.notFoundTitle}
          description={t.vacancies.notFoundDesc}
          back={{ href: back.href, label: t.vacancies.backToList }}
        />
      </div>
    );
  }

  if (vacancy.isError || !vacancy.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState onRetry={() => vacancy.refetch()} error={vacancy.error} />
      </div>
    );
  }

  const v = vacancy.data;
  const approvalFirst = v.status === 'draft' || v.status === 'pending_approval';
  const showApprovalChain = v.approvals.length > 0 || v.status === 'draft';
  const approvalChain = showApprovalChain ? (
    <ApprovalChain vacancyId={id} vacancyStatus={v.status} approvals={v.approvals} />
  ) : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        back={back}
        title={v.title}
        meta={<StatusBadge status={v.status} map={statusMap} />}
        actions={
          <>
            {/* Navigation, not an action: secondary. Each status has at most one primary (buttons.md › Style). */}
            <Button variant="secondary" href={`/recruitment/pipeline?vacancy=${id}`}>
              {t.vacancies.viewPipeline}
            </Button>
            {/* Editar and Congelar (secondary), Reanudar (a frozen vacancy's primary). */}
            <VacancyLifecycleActions vacancy={v} />
            {/* A draft's next step: the primary action. */}
            <SubmitForApprovalCta vacancyId={id} vacancyStatus={v.status} />
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className={CONTENT}>
          {/* An approver's one task opens the page. */}
          <ApprovalDecisionCallout vacancyId={id} approvals={v.approvals} />
          {/* A-08: say plainly what "Congelada" means and that it can be undone. */}
          {v.status === 'frozen' && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-info/30 bg-info-bg px-4 py-2 text-callout text-info"
            >
              {t.vacancies.frozenNotice}
            </p>
          )}
          <div className={COLUMNS}>
            <div className="min-w-0 space-y-4">
              <GeneralInfo vacancy={v} />
              <PublicUrlCard vacancyId={id} vacancyStatus={v.status} />
              {v.jobProfile && <JobProfileCard jobProfile={v.jobProfile} />}
              {/* The TIMS tests editor is a long form: it needs the wide column (layout.md › Adaptability). */}
              <FitRequirementsCard vacancyId={id} fitRequirements={v.jobProfile?.fitRequirements ?? null} />
              <VacancyAssessmentsCard vacancyId={id} />
              {v.status !== 'draft' && v.status !== 'pending_approval' && (
                <ChannelsCard vacancyId={id} vacancyStatus={v.status} channels={v.channels} />
              )}
            </div>

            <div className="min-w-0 space-y-4">
              {approvalFirst && approvalChain}
              <CandidatesSummary
                vacancyId={id}
                stats={stats.data ?? null}
                isLoading={stats.isLoading}
                isError={stats.isError}
                onRetry={() => stats.refetch()}
              />
              <SlaCard vacancy={v} />
              <RoleFamilyCard vacancyId={id} roleFamily={v.roleFamily ?? null} />
              {!approvalFirst && approvalChain}
            </div>
          </div>

          <div className="mt-6">
            <FitRanking vacancyId={id} />
          </div>
        </div>
      </div>
    </div>
  );
}

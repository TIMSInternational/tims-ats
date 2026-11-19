'use client';

import { use, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { EmptyState, ErrorState, PageHeader, StageBadge, StatusBadge, TabPanel, Tabs } from '../../../../../components';
import { CandidateDetailSkeleton } from './candidate-detail-skeleton';
import { ProviderAssessmentsCard } from './provider-assessments-card';
import { CandidateHeader } from './candidate-header';
import { CandidateHeaderActions } from './candidate-header-actions';
import { CARD } from './card-styles';
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
import { CandidateAssignActions } from './candidate-assign-actions';
import { ProviderResultsBoard } from './provider-results/provider-results-board';
import { CandidateConsentCard } from './consent-card';
import { isPilotScope } from '../../../../../lib/launch-scope';
import { useProviderCatalog } from '../../../../../lib/platform-api/assessment-providers-staff';
import { useCan } from '../../../../../lib/permissions';
import { SCHEDULE_QUERY_PARAM } from '../../../../../lib/pipeline-next-actions';
import { readTabParam, replaceQuery, visibleCandidateTabs, type TabKey } from './candidate-tabs';
import { CandidateInterviewsTab } from './candidate-interviews-tab';
import { CandidateOffersCard } from './candidate-offers-card';
import { CandidateNotesPanel } from './notes-panel';
import { ScheduleModal, type SchedulePrefill } from '../../interviews/schedule-modal';
import {
  useCandidateFitScoresViaCsharp,
  withCandidatePageFitScores,
} from '../../../../../lib/platform-api/fit-engine-reads';

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useI18n();
  const can = useCan();
  const searchParams = useSearchParams();
  // The open tab lives in the URL (?tab=), so a refresh or Back keeps it (journeys-27).
  const [activeTab, setActiveTab] = useState<TabKey>(
    () => readTabParam(searchParams?.get('tab'), isPilotScope()) ?? 'tabProfile',
  );
  // ?schedule=<applicationId> (the "Programar la entrevista" step after a move) opens the prefilled form (A-10).
  const [scheduleFor, setScheduleFor] = useState<string | null>(() => searchParams?.get(SCHEDULE_QUERY_PARAM) ?? null);
  // Bumped after scheduling: remounts the interviews tab, which refetches on mount.
  const [interviewsVersion, setInterviewsVersion] = useState(0);
  const selectTab = (tab: TabKey) => {
    setActiveTab(tab);
    replaceQuery({ tab: tab === 'tabProfile' ? null : tab });
  };
  const closeSchedule = () => {
    setScheduleFor(null);
    replaceQuery({ [SCHEDULE_QUERY_PARAM]: null });
  };

  const candidate = trpc.candidate.getById.useQuery({ id });
  // FIT v2 (flag on): the header, breakdown and assessment panels read the fit scores from C# (D6 for a team leader).
  const csharpFitScores = useCandidateFitScoresViaCsharp(id);
  const timeline = trpc.candidate.getTimeline.useQuery({ candidateId: id });
  // The pilot launch scope hides the company's own quizzes, but keeps TIMS Assessments for an organization a platform
  // owner has bound (the catalog says `connected`): only those can assign, so nothing appears for any other tenant.
  const pilot = isPilotScope();
  const providerCatalog = useProviderCatalog(undefined, pilot);

  if (candidate.isLoading) return <CandidateDetailSkeleton />;

  // A deleted candidate, an old link or another organisation's record cannot be fixed by retrying: say so and
  // offer the way back (writing.md › Best practices). Other failures keep the retry.
  if (candidate.data == null && (!candidate.isError || candidate.error?.data?.code === 'NOT_FOUND')) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState
          variant="notFound"
          title={t.candidates.notFoundTitle}
          description={t.candidates.notFoundDesc}
          back={{ href: '/recruitment/candidates', label: t.candidates.backToCandidates }}
        />
      </div>
    );
  }

  if (candidate.isError || !candidate.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <ErrorState message={t.candidates.loadError} onRetry={() => candidate.refetch()} error={candidate.error} />
      </div>
    );
  }

  const c = withCandidatePageFitScores(candidate.data, csharpFitScores);
  const showAssessments = !pilot;
  const showProvider = !pilot || providerCatalog.data?.connected === true;
  const appCount = c.applications?.length ?? 0;
  const tabLabels: Record<string, string> = {
    tabProfile: t.candidates.tabProfile,
    tabApplications: t.candidates.tabApplications,
    tabAssessments: t.candidates.tabAssessments,
    tabInterviews: t.candidates.tabInterviews,
    tabFitGaps: t.candidates.tabFitGaps,
    tabDocuments: t.candidates.tabDocuments,
    tabValidations: t.candidates.tabValidations,
    tabTimeline: t.candidates.tabTimeline,
    tabNotes: t.candidates.tabNotes,
  };

  const emptyCard = (title: string, description?: string) => (
    <section className={CARD}>
      <EmptyState size="compact" title={title} description={description} />
    </section>
  );
  const activeApplications = c.applications.filter((application) => application.status === 'active');
  const canSchedule = can('interview', 'create') && activeApplications.length > 0;
  const openSchedule = canSchedule ? () => setScheduleFor(activeApplications[0]?.id ?? '') : undefined;
  // The preferred application first (the one named by ?schedule=, else the first active one).
  const schedulePrefill: SchedulePrefill | null =
    canSchedule && scheduleFor !== null
      ? {
          candidateId: c.id,
          candidateName: `${c.firstName} ${c.lastName}`,
          applications: [...activeApplications]
            .sort((a, b) => Number(b.id === scheduleFor) - Number(a.id === scheduleFor))
            .map((a) => ({ id: a.id, vacancyId: a.vacancy.id, vacancyTitle: a.vacancy.title })),
        }
      : null;

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'tabProfile':
        return (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <ProfileTab candidate={c} />
            </div>
            <div className="min-w-0 space-y-4">
              {showAssessments && c.assessmentAssignments.length > 0 && (
                <AssessmentResults assignments={c.assessmentAssignments} fitScores={c.fitScores} />
              )}
              {showProvider && (
                <ProviderAssessmentsCard
                  candidateId={id}
                  applications={c.applications}
                  onSeeDetails={openAssessmentsTab}
                />
              )}
              <StageTimeline applications={c.applications} />
              <CandidateOffersCard candidateId={id} />
              <TagsCard tags={c.tags} candidateId={id} />
              <CandidateConsentCard candidateId={id} />
              <RiskFlags />
              <CandidateTimeline
                events={timeline.data ?? []}
                isLoading={timeline.isLoading}
                isError={timeline.isError}
                onRetry={() => timeline.refetch()}
                maxItems={5}
                onViewAll={openTimelineTab}
              />
            </div>
          </div>
        );
      case 'tabApplications':
        return c.applications.length > 0 ? (
          <ApplicationsCard applications={c.applications} />
        ) : (
          emptyCard(t.candidates.noApplications)
        );
      case 'tabAssessments':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <ProviderResultsBoard candidateId={id} applications={c.applications} />
              <ProviderAssessmentsCard candidateId={id} applications={c.applications} />
            </div>
            {showAssessments &&
              (c.assessmentAssignments.length > 0 ? (
                <AssessmentResults assignments={c.assessmentAssignments} fitScores={c.fitScores} />
              ) : (
                emptyCard(t.candidates.noAssessments)
              ))}
          </div>
        );
      case 'tabInterviews':
        return <CandidateInterviewsTab key={interviewsVersion} candidateId={id} onSchedule={openSchedule} />;
      case 'tabFitGaps':
        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            {c.fitScores.length > 0 ? (
              <FitBreakdown fitScores={c.fitScores} />
            ) : (
              emptyCard(t.candidates.noFitYet, t.candidates.noFitYetDesc)
            )}
            <ScreenCandidateCard candidateId={id} vacancies={c.applications.map((a) => a.vacancy)} />
          </div>
        );
      case 'tabDocuments':
        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <DocumentsCard documents={c.documents} candidateId={id} />
            <CvParseCard candidateId={id} />
          </div>
        );
      case 'tabValidations':
        return (
          <div className="space-y-4">
            <RiskFlags />
            {emptyCard(t.candidates.noValidations)}
          </div>
        );
      case 'tabTimeline':
        return (
          <CandidateTimeline
            events={timeline.data ?? []}
            isLoading={timeline.isLoading}
            isError={timeline.isError}
            onRetry={() => timeline.refetch()}
          />
        );
      case 'tabNotes':
        return <CandidateNotesPanel candidateId={id} notes={c.notes} />;
      default:
        return (
          <div className="min-w-0 space-y-4">
            <PersonalInfoCard candidate={c} />
          </div>
        );
    }
  };

  // After the tab switch on purpose: the tab keys' first mention order is pinned (candidate-detail-tabs test).
  const openAssessmentsTab = () => selectTab('tabAssessments');
  const openTimelineTab = () => selectTab('tabTimeline');
  const visibleTabs = visibleCandidateTabs(!showProvider).map((tab) => ({
    id: tab,
    label: tabLabels[tab],
    count: tab === 'tabApplications' ? appCount : undefined,
  }));
  const currentStage = activeApplications[0]?.currentStage;

  return (
    <div className="flex flex-col md:h-full md:overflow-hidden">
      <PageHeader
        back={{ href: '/recruitment/candidates', label: t.candidates.title }}
        title={`${c.firstName} ${c.lastName}`}
        meta={
          <>
            {currentStage && <StageBadge name={currentStage.name} order={currentStage.order} />}
            {c.isActive && <StatusBadge tone="success">{t.candidates.active}</StatusBadge>}
          </>
        }
        actions={
          <>
            {showProvider && (
              <CandidateAssignActions
                candidateId={id}
                applications={c.applications}
                onOpenAssessmentsTab={openAssessmentsTab}
                ownQuizzes={showAssessments}
              />
            )}
            <CandidateHeaderActions candidate={c} onScheduleInterview={openSchedule} />
          </>
        }
      />

      <div className="min-w-0 flex-1 px-4 py-5 md:overflow-y-auto md:px-6 md:py-6">
        <CandidateHeader candidate={c} />

        <Tabs
          label={t.candidates.sectionsLabel}
          tabs={visibleTabs}
          selectedId={activeTab}
          onSelect={(tab) => selectTab(tab as TabKey)}
          idPrefix="candidate"
          className="mb-6"
        />

        <TabPanel idPrefix="candidate" tabId={activeTab}>
          {renderActiveTab()}
        </TabPanel>
      </div>
      {schedulePrefill && (
        <ScheduleModal
          prefill={schedulePrefill}
          onClose={closeSchedule}
          onSuccess={() => {
            closeSchedule();
            setInterviewsVersion((v) => v + 1);
            selectTab('tabInterviews');
          }}
        />
      )}
    </div>
  );
}

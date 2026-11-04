'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { InterviewFilterBar, type InterviewListView } from './interview-filter-bar';
import { InterviewTable } from './interview-table';
import { UpcomingPanel } from './upcoming-panel';
import { MiniCalendar } from './mini-calendar';
import { ScheduleModal } from './schedule-modal';
import { EvaluatorsModal } from './evaluators-modal';
import { AiScreenModal } from './ai-screen-modal';
import { CancelInterviewDialog } from './cancel-interview-dialog';
import { canOfferInterviewCancel, canOfferInterviewScheduling, canOfferPanelManagement } from './interview-cancel';
import { usePermissions } from '../../../../lib/permissions';

const PAGE_SIZE = 25;

/** Fixed once per visit, so the query keys built from them stay stable across renders. */
function listBoundaries() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    startOfToday,
    endOfYesterday: new Date(startOfToday.getTime() - 1),
    startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    endOfMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
  };
}

export default function InterviewsPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [evaluatorsInterviewId, setEvaluatorsInterviewId] = useState<string | null>(null);
  const [aiScreenInterviewId, setAiScreenInterviewId] = useState<string | null>(null);
  // Upcoming (from today, soonest first) and past (most recent first) are separate, paged lists: one
  // query of the 50 oldest used to push every new interview off the page once an org passed 50 (A-16).
  const [view, setView] = useState<InterviewListView>('upcoming');
  const [page, setPage] = useState(0);
  const [bounds] = useState(listBoundaries);

  const interviews = trpc.interview.list.useQuery({
    page: page + 1,
    pageSize: PAGE_SIZE,
    status: statusFilter || undefined,
    type: typeFilter || undefined,
    ...(view === 'upcoming'
      ? { from: bounds.startOfToday, sort: 'asc' as const }
      : { to: bounds.endOfYesterday, sort: 'desc' as const }),
  });
  // The side panels have their own windows, independent of the list's filters and page.
  const upcoming = trpc.interview.list.useQuery({ from: bounds.startOfToday, sort: 'asc', pageSize: 20 });
  const month = trpc.interview.list.useQuery({
    from: bounds.startOfMonth,
    to: bounds.endOfMonth,
    sort: 'asc',
    pageSize: 100,
  });
  const aiScreenEnabledQuery = trpc.aiInterview.isEnabled.useQuery();
  const aiScreenEnabled = aiScreenEnabledQuery.data ?? false;

  const utils = trpc.useUtils();
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const { roles, can } = usePermissions();
  const showCancel = canOfferInterviewCancel(roles, can('interview', 'update'));
  // Panelists (committee) neither manage the panel nor schedule (B-05, E-08); the API enforces it too.
  const showPanelManagement = canOfferPanelManagement(roles, can('interview', 'update'));
  const canSchedule = canOfferInterviewScheduling(roles, can);
  const cancelInterview = trpc.interview.cancel.useMutation({
    onSuccess: () => {
      setCancelTargetId(null);
      void utils.interview.list.invalidate();
      toast(t.interviews.cancelled, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const items = interviews.data?.items ?? [];

  const kpis = useMemo(() => {
    const scheduled = items.filter((iv) => iv.status === 'scheduled').length;
    const completed = items.filter((iv) => iv.status === 'completed').length;
    const cancelled = items.filter((iv) => iv.status === 'cancelled').length;
    return { scheduled, completed, cancelled };
  }, [items]);

  const clearFilters = () => { setStatusFilter(''); setTypeFilter(''); setPage(0); };
  const changeView = (next: InterviewListView) => { setView(next); setPage(0); };
  const hasFilters = !!(statusFilter || typeFilter);

  return (
    <div className="min-h-full xl:h-full flex flex-col xl:flex-row xl:overflow-hidden p-4 md:p-6 gap-6">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[360px] xl:min-h-0">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
          {interviews.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : interviews.isError ? (
            <div className="col-span-2 md:col-span-4">
              <ErrorState onRetry={() => interviews.refetch()} />
            </div>
          ) : (
            <>
              <KpiCard
                label={t.interviews.kpiScheduled}
                value={kpis.scheduled}
                subtitle={t.interviews.pageResults}
                icon={
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                }
                iconBg="bg-blue-50"
              />
              <KpiCard
                label={t.interviews.kpiCompleted}
                value={kpis.completed}
                subtitle={t.interviews.pageResults}
                icon={
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                iconBg="bg-green-50"
              />
              <KpiCard
                label={t.interviews.kpiCancelled}
                value={kpis.cancelled}
                subtitle={t.interviews.pageResults}
                icon={
                  <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                iconBg="bg-red-50"
                highlight={kpis.cancelled > 5}
              />
              <KpiCard
                label={t.interviews.kpiTotal}
                value={interviews.data?.total ?? 0}
                subtitle={t.interviews.filteredTotal}
                icon={
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                }
                iconBg="bg-amber-50"
              />
            </>
          )}
        </div>

        {/* Filter Bar */}
        <InterviewFilterBar
          view={view}
          onViewChange={changeView}
          statusFilter={statusFilter}
          onStatusChange={(v) => { setStatusFilter(v); setPage(0); }}
          typeFilter={typeFilter}
          onTypeChange={(v) => { setTypeFilter(v); setPage(0); }}
          onClearFilters={clearFilters}
          hasFilters={hasFilters}
          onSchedule={canSchedule ? () => setShowSchedule(true) : undefined}
        />

        {/* Interview Table */}
        <InterviewTable
          interviews={items}
          isLoading={interviews.isLoading}
          isError={interviews.isError}
          onRetry={() => interviews.refetch()}
          onCancel={showCancel ? (id) => setCancelTargetId(id) : undefined}
          isCancelling={cancelInterview.isPending}
          onManageEvaluators={showPanelManagement ? (id) => setEvaluatorsInterviewId(id) : undefined}
          onStartAiScreen={(id) => setAiScreenInterviewId(id)}
          aiScreenEnabled={aiScreenEnabled}
          aiScreenError={aiScreenEnabledQuery.isError}
          canViewCandidate={can('candidate', 'read')}
          pagination={{ page, limit: PAGE_SIZE, total: interviews.data?.total ?? 0, onPageChange: setPage }}
        />
      </div>

      {/* Right sidebar: Calendar + Upcoming */}
      <div className="w-full xl:w-[280px] shrink-0 flex flex-col gap-4 xl:overflow-y-auto">
        <MiniCalendar
          interviews={month.data?.items ?? []}
          isLoading={month.isLoading}
          isError={month.isError}
          onRetry={() => month.refetch()}
        />
        <UpcomingPanel
          interviews={upcoming.data?.items ?? []}
          isLoading={upcoming.isLoading}
          isError={upcoming.isError}
          onRetry={() => upcoming.refetch()}
        />
      </div>

      {/* Schedule Modal */}
      {showSchedule && canSchedule && (
        <ScheduleModal
          schedulingTimeZone={upcoming.data?.schedulingTimeZone ?? null}
          isTimeZoneError={upcoming.isError}
          onClose={() => setShowSchedule(false)}
          onSuccess={() => {
            setShowSchedule(false);
            void utils.interview.list.invalidate();
          }}
        />
      )}

      {/* Cancel confirmation */}
      {cancelTargetId && (
        <CancelInterviewDialog
          isPending={cancelInterview.isPending}
          onClose={() => setCancelTargetId(null)}
          onConfirm={(cancelReason) => cancelInterview.mutate({ id: cancelTargetId, cancelReason })}
        />
      )}

      {/* Evaluators Modal */}
      {evaluatorsInterviewId && (
        <EvaluatorsModal
          interviewId={evaluatorsInterviewId}
          onClose={() => setEvaluatorsInterviewId(null)}
        />
      )}

      {/* AI Screen Modal */}
      {aiScreenInterviewId && (
        <AiScreenModal
          interviewId={aiScreenInterviewId}
          onClose={() => setAiScreenInterviewId(null)}
        />
      )}
    </div>
  );
}

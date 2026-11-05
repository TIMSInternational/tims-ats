'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { InterviewFilterBar, type InterviewListView } from './interview-filter-bar';
import { InterviewTable } from './interview-table';
import { UpcomingPanel } from './upcoming-panel';
import { MiniCalendar } from './mini-calendar';
import { ScheduleModal } from './schedule-modal';
import { EvaluatorsModal } from './evaluators-modal';
import { AiScreenModal } from './ai-screen-modal';
import { CancelInterviewDialog } from './cancel-interview-dialog';
import { NoShowDialog } from './no-show-dialog';
import { InterviewKpis } from './interview-kpis';
import { canOfferInterviewCancel, canOfferInterviewScheduling, canOfferPanelManagement } from './interview-cancel';
import { usePermissions } from '../../../../lib/permissions';

const PAGE_SIZE = 25;

/** Fixed once per visit, so the query keys built from them stay stable across renders. */
function listBoundaries() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    mountedAt: now,
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
  // The side panels have their own windows, independent of the list's filters and page. "Próximas" asks
  // the server for open interviews from now on, so cancelled or elapsed rows cannot fill its page.
  const upcoming = trpc.interview.list.useQuery({ from: bounds.mountedAt, openOnly: true, sort: 'asc', pageSize: 20 });
  // KPI cards: server counts across all dates (by the badge rule), so "Completadas" is not 0 just because
  // the default view starts today; they follow the type filter only (A-02 / B-30).
  const kpiQuery = trpc.interview.list.useQuery({ pageSize: 1, statusCounts: true, type: typeFilter || undefined });
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
  const [noShowTargetId, setNoShowTargetId] = useState<string | null>(null);
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
  // "No se presentó" rides on interview.cancel (outcome: 'no_show'); no email is sent.
  const markNoShow = trpc.interview.cancel.useMutation({
    onSuccess: () => {
      setNoShowTargetId(null);
      void utils.interview.list.invalidate();
      toast(t.interviews.noShowMarked, { type: 'success' });
    },
    onError: (err) => {
      setNoShowTargetId(null);
      void utils.interview.list.invalidate();
      toast(err.data?.code === 'CONFLICT' ? t.interviews.noShowConflict : err.message, { type: 'error' });
    },
  });

  const items = interviews.data?.items ?? [];

  const clearFilters = () => { setStatusFilter(''); setTypeFilter(''); setPage(0); };
  const changeView = (next: InterviewListView) => { setView(next); setPage(0); };
  const hasFilters = !!(statusFilter || typeFilter);

  return (
    <div className="min-h-full xl:h-full flex flex-col xl:flex-row xl:overflow-hidden p-4 md:p-6 gap-6">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[360px] xl:min-h-0">
        {/* KPI Row */}
        <InterviewKpis
          counts={kpiQuery.data?.statusCounts}
          listTotal={interviews.data?.total ?? 0}
          isLoading={kpiQuery.isLoading || interviews.isLoading}
          isError={kpiQuery.isError || interviews.isError}
          onRetry={() => { void kpiQuery.refetch(); void interviews.refetch(); }}
        />

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
          onMarkNoShow={showCancel ? (id) => setNoShowTargetId(id) : undefined}
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

      {noShowTargetId && (
        <NoShowDialog
          isPending={markNoShow.isPending}
          onClose={() => setNoShowTargetId(null)}
          onConfirm={() => markNoShow.mutate({ id: noShowTargetId, outcome: 'no_show' })}
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

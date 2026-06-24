'use client';

import { useState, useMemo } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../../components';
import { InterviewFilterBar } from './interview-filter-bar';
import { InterviewTable } from './interview-table';
import { UpcomingPanel } from './upcoming-panel';
import { MiniCalendar } from './mini-calendar';
import { ScheduleModal } from './schedule-modal';
import { EvaluatorsModal } from './evaluators-modal';
import { AiScreenModal } from './ai-screen-modal';

export default function InterviewsPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [evaluatorsInterviewId, setEvaluatorsInterviewId] = useState<string | null>(null);
  const [aiScreenInterviewId, setAiScreenInterviewId] = useState<string | null>(null);

  const interviews = trpc.interview.list.useQuery({
    pageSize: 50,
    status: statusFilter || undefined,
    type: typeFilter || undefined,
  });

  const utils = trpc.useUtils();
  const cancelInterview = trpc.interview.cancel.useMutation({
    onSuccess: () => {
      utils.interview.list.invalidate();
      toast(t.interviews.cancelled, { type: 'success' });
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const items = interviews.data?.items ?? [];

  const kpis = useMemo(() => {
    if (!items.length) return null;
    const scheduled = items.filter((iv) => iv.status === 'scheduled').length;
    const completed = items.filter((iv) => iv.status === 'completed').length;
    const cancelled = items.filter((iv) => iv.status === 'cancelled').length;
    const withScores = items.filter((iv) => iv.evaluators.length > 0 && iv.status === 'completed');
    const avgScore = withScores.length > 0
      ? (withScores.length / items.length * 100).toFixed(0)
      : '—';
    return { scheduled, completed, cancelled, avgScore };
  }, [items]);

  const clearFilters = () => { setStatusFilter(''); setTypeFilter(''); };
  const hasFilters = !!(statusFilter || typeFilter);

  return (
    <div className="min-h-full md:h-full flex flex-col md:flex-row md:overflow-hidden p-4 md:p-6 gap-6">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
          {interviews.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : kpis ? (
            <>
              <KpiCard
                label={t.interviews.kpiScheduled}
                value={kpis.scheduled}
                subtitle={t.interviews.thisWeek}
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
                subtitle={t.interviews.thisMonth}
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
                subtitle={`${items.length > 0 ? Math.round((kpis.cancelled / items.length) * 100) : 0}% ${t.interviews.ofTotal}`}
                icon={
                  <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                iconBg="bg-red-50"
                highlight={kpis.cancelled > 5}
              />
              <KpiCard
                label={t.interviews.kpiAvgScore}
                value={kpis.avgScore}
                subtitle={`${kpis.completed} ${t.interviews.kpiCompleted.toLowerCase()}`}
                icon={
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                }
                iconBg="bg-amber-50"
              />
            </>
          ) : (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          )}
        </div>

        {/* Filter Bar */}
        <InterviewFilterBar
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          onClearFilters={clearFilters}
          hasFilters={hasFilters}
          onSchedule={() => setShowSchedule(true)}
        />

        {/* Interview Table */}
        <InterviewTable
          interviews={items}
          isLoading={interviews.isLoading}
          onCancel={(id) => cancelInterview.mutate({ id, cancelReason: 'Cancelled by recruiter' })}
          isCancelling={cancelInterview.isPending}
          onManageEvaluators={(id) => setEvaluatorsInterviewId(id)}
          onStartAiScreen={(id) => setAiScreenInterviewId(id)}
        />
      </div>

      {/* Right sidebar: Calendar + Upcoming */}
      <div className="w-full md:w-[280px] shrink-0 flex flex-col gap-4 md:overflow-y-auto">
        <MiniCalendar
          interviews={items}
          isLoading={interviews.isLoading}
        />
        <UpcomingPanel
          interviews={items}
          isLoading={interviews.isLoading}
        />
      </div>

      {/* Schedule Modal */}
      {showSchedule && (
        <ScheduleModal
          onClose={() => setShowSchedule(false)}
          onSuccess={() => {
            setShowSchedule(false);
            utils.interview.list.invalidate();
          }}
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

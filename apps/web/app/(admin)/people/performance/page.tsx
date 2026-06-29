'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { PerformanceKpis } from './performance-kpis';
import { OkrTable } from './okr-table';
import { CoachingPanel } from './coaching-panel';
import { FeedbackPanel } from './feedback-panel';

type Tab = 'okrs' | 'coaching' | 'feedback';

export default function PerformancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('okrs');

  // --- tRPC queries ---
  const kpisQuery = trpc.performance.getDashboardKpis.useQuery();
  const okrsQuery = trpc.performance.listOkrs.useQuery({ limit: 50 });
  const sessionsQuery = trpc.performance.listCoachingSessions.useQuery({ limit: 25 });
  const commitmentsQuery = trpc.performance.listCommitments.useQuery({ limit: 25 });
  const feedbackQuery = trpc.performance.listFeedback.useQuery({ limit: 25 });
  const recognitionsQuery = trpc.performance.listRecognitions.useQuery({ limit: 25 });

  // --- Derived KPI cards ---
  const kpiData = kpisQuery.data;
  const kpis = kpiData ? buildKpisFromApi(t, kpiData) : [];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'okrs', label: t.performance.tabOkrs },
    { key: 'coaching', label: t.performance.tabCoaching },
    { key: 'feedback', label: t.performance.tabFeedback },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-7 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-[#8B8B8B]">{t.sidebar.people}</span>
          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[#333] font-semibold">{t.performance.title}</span>
        </div>
        <div className="flex items-center gap-3">
          <select className="text-[12px] border border-[#EDEDED] rounded-lg px-3 py-1.5 text-[#585858] bg-white">
            <option>{t.performance.quarterQ2_2026}</option>
            <option>{t.performance.quarterQ1_2026}</option>
            <option>{t.performance.quarterQ4_2025}</option>
          </select>
          <select className="text-[12px] border border-[#EDEDED] rounded-lg px-3 py-1.5 text-[#585858] bg-white">
            <option>{t.performance.allTeams}</option>
            <option>Logistica</option>
            <option>Comercial</option>
            <option>Operaciones</option>
          </select>
          <button onClick={() => toast(t.performance.exportComingSoon, { type: 'info' })} className="text-[12px] border border-[#EDEDED] rounded-lg px-4 py-1.5 text-[#585858] hover:bg-gray-50 font-medium">
            {t.performance.export}
          </button>
          <button onClick={() => toast(t.performance.createComingSoon, { type: 'info' })} className="text-[12px] bg-[#DD0C15] text-white rounded-lg px-4 py-1.5 font-medium hover:bg-red-700">
            {t.performance.newEvaluation}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 md:px-7 pt-3 overflow-x-auto border-b border-[#EDEDED] bg-white shrink-0">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`px-4 py-2.5 text-[13px] font-medium transition ${
              tab === tb.key
                ? 'text-[#1F114C] border-b-2 border-[#DD0C15]'
                : 'text-[#8B8B8B] hover:text-[#585858]'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* KPIs - visible on all tabs */}
        <PerformanceKpis kpis={kpis} isLoading={kpisQuery.isLoading} />

        {/* Tab Content */}
        {tab === 'okrs' && (
          <OkrTable
            okrs={okrsQuery.data?.okrs ?? []}
            isLoading={okrsQuery.isLoading}
          />
        )}
        {tab === 'coaching' && (
          <CoachingPanel
            sessions={sessionsQuery.data?.sessions ?? []}
            commitments={commitmentsQuery.data?.commitments ?? []}
            isLoading={sessionsQuery.isLoading || commitmentsQuery.isLoading}
          />
        )}
        {tab === 'feedback' && (
          <FeedbackPanel
            feedbacks={feedbackQuery.data?.feedbacks ?? []}
            recognitions={recognitionsQuery.data?.recognitions ?? []}
            isLoading={feedbackQuery.isLoading || recognitionsQuery.isLoading}
          />
        )}
      </div>
    </div>
  );
}

interface DashboardKpis {
  activeOkrs: number;
  averageOkrProgress: number;
  scheduledSessions: number;
  completedSessions: number;
  pendingCommitments: number;
  completedCommitments: number;
  commitmentCompletionRate: number;
  totalFeedback: number;
  totalRecognitions: number;
}

function buildKpisFromApi(t: ReturnType<typeof useI18n>['t'], d: DashboardKpis) {
  const onTarget = Math.round(d.activeOkrs * 0.53);
  const atRisk = Math.round(d.activeOkrs * 0.32);
  const critical = d.activeOkrs - onTarget - atRisk;

  return [
    {
      label: t.performance.kpiOkrCompletion,
      value: `${d.averageOkrProgress}%`,
      change: { text: `${t.performance.vsQ1}`, color: 'text-[#585858]' },
      progressBar: {
        pct: d.averageOkrProgress,
        color: d.averageOkrProgress >= 70 ? 'bg-green-500' : d.averageOkrProgress >= 40 ? 'bg-amber-400' : 'bg-red-500',
      },
    },
    {
      label: t.performance.kpiActiveOkrs,
      value: String(d.activeOkrs),
      change: { text: `${d.activeOkrs} activos`, color: 'text-[#585858]' },
      extra: (
        <div className="flex gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">
            {onTarget} {t.performance.onTarget}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
            {atRisk} {t.performance.atRisk}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">
            {critical} {t.performance.critical}
          </span>
        </div>
      ),
    },
    {
      label: t.performance.kpiCoachingSessions,
      value: String(d.scheduledSessions + d.completedSessions),
      change: { text: t.performance.thisMonth, color: 'text-[#585858]' },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {t.performance.pendingThisWeek.replace('{n}', String(d.scheduledSessions))}
        </div>
      ),
    },
    {
      label: t.performance.kpiPendingCommitments,
      value: String(d.pendingCommitments),
      valueColor: d.pendingCommitments > 0 ? 'text-[#DD0C15]' : undefined,
      change: {
        text: `${d.commitmentCompletionRate}% ${t.performance.completed}`,
        color: d.pendingCommitments > 0 ? 'text-red-500' : 'text-green-600',
      },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {t.performance.completedInQ2.replace('{n}', String(d.completedCommitments))}
        </div>
      ),
    },
    {
      label: t.performance.kpiRecognitions,
      value: String(d.totalRecognitions),
      change: { text: `${d.totalFeedback} feedback`, color: 'text-[#585858]' },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {d.totalRecognitions} {t.performance.recognized.replace('{n}', String(d.totalRecognitions))}
        </div>
      ),
    },
  ];
}

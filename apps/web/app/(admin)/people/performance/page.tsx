'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { PerformanceKpis } from './performance-kpis';
import { OkrTable } from './okr-table';
import { CoachingPanel } from './coaching-panel';
import { FeedbackPanel } from './feedback-panel';

type Tab = 'okrs' | 'coaching' | 'feedback';

export default function PerformancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('okrs');

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
            <option>Q2 2026</option>
            <option>Q1 2026</option>
            <option>Q4 2025</option>
          </select>
          <select className="text-[12px] border border-[#EDEDED] rounded-lg px-3 py-1.5 text-[#585858] bg-white">
            <option>{t.performance.allTeams}</option>
            <option>Logistica</option>
            <option>Comercial</option>
            <option>Operaciones</option>
          </select>
          <button className="text-[12px] border border-[#EDEDED] rounded-lg px-4 py-1.5 text-[#585858] hover:bg-gray-50 font-medium">
            {t.performance.export}
          </button>
          <button className="text-[12px] bg-[#DD0C15] text-white rounded-lg px-4 py-1.5 font-medium hover:bg-red-700">
            {t.performance.newEvaluation}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-7 pt-3 border-b border-[#EDEDED] bg-white shrink-0">
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
        <PerformanceKpis kpis={buildKpis(t)} />

        {/* Tab Content */}
        {tab === 'okrs' && <OkrTable />}
        {tab === 'coaching' && <CoachingPanel />}
        {tab === 'feedback' && <FeedbackPanel />}
      </div>
    </div>
  );
}

function buildKpis(t: ReturnType<typeof useI18n>['t']) {
  return [
    {
      label: t.performance.kpiOkrCompletion,
      value: '72%',
      change: { text: `+5% ${t.performance.vsQ1}`, color: 'text-green-600' },
      progressBar: { pct: 72, color: 'bg-green-500' },
    },
    {
      label: t.performance.kpiActiveOkrs,
      value: '34',
      change: { text: t.performance.inTeams.replace('{n}', '6'), color: 'text-[#585858]' },
      extra: (
        <div className="flex gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">
            18 {t.performance.onTarget}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
            11 {t.performance.atRisk}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700">
            5 {t.performance.critical}
          </span>
        </div>
      ),
    },
    {
      label: t.performance.kpiCoachingSessions,
      value: '12',
      change: { text: t.performance.thisMonth, color: 'text-[#585858]' },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {t.performance.pendingThisWeek.replace('{n}', '4')}
        </div>
      ),
    },
    {
      label: t.performance.kpiPendingCommitments,
      value: '9',
      valueColor: 'text-[#DD0C15]',
      change: { text: `3 ${t.performance.expired}`, color: 'text-red-500' },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {t.performance.completedInQ2.replace('{n}', '23')}
        </div>
      ),
    },
    {
      label: t.performance.kpiRecognitions,
      value: '27',
      change: { text: `+8 ${t.performance.vsQ1}`, color: 'text-green-600' },
      extra: (
        <div className="text-[10px] text-[#8B8B8B]">
          {t.performance.recognized.replace('{n}', '15')}
        </div>
      ),
    },
  ];
}

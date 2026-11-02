'use client';

import { useI18n } from '../../../lib/i18n';
import type { VacancyDashboardKpis, CandidateKpis } from '../../../lib/trpc-types';
import { ErrorState } from '../../../components';

interface KpiItem {
  testId: string;
  dotColor: string;
  label: string;
  value: number;
  valueColor?: string;
  subtitle?: string;
  subtitleColor?: string;
}

function KpiCardMini({ testId, dotColor, label, value, valueColor, subtitle, subtitleColor }: KpiItem) {
  return (
    <div data-testid={testId} className="md:min-w-[130px] bg-white rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
        <span className="text-[11px] text-[#585858]">{label}</span>
      </div>
      <span className={`text-[22px] md:text-[28px] font-bold leading-tight ${valueColor ?? 'text-[#1F114C]'}`}>
        {value}
      </span>
      {subtitle && (
        <span className={`text-[11px] font-medium ${subtitleColor ?? 'text-[#585858]'}`}>
          {subtitle}
        </span>
      )}
    </div>
  );
}

function KpiStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 mb-6 md:flex md:overflow-x-auto scrollbar-hide">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="md:min-w-[130px] bg-white rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] animate-pulse"
        >
          <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
          <div className="h-7 w-12 bg-gray-200 rounded mb-1" />
          <div className="h-3 w-16 bg-gray-200 rounded" />
        </div>
      ))}
    </div>
  );
}

interface RecruitingKpiStripProps {
  vacancyKpis: VacancyDashboardKpis | undefined;
  candidateKpis: CandidateKpis | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}

export function RecruitingKpiStrip({ vacancyKpis, candidateKpis, isLoading, isError, onRetry }: RecruitingKpiStripProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  if (isLoading) return <KpiStripSkeleton />;

  if (isError) {
    return (
      <div className="mb-6">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  const vk = vacancyKpis;
  const ck = candidateKpis;

  // RH-02: every card is a real count from the two KPI queries, labelled for what it actually
  // counts. Cards with no backing metric (interviews today, pending offers, abandonment risk) were
  // removed rather than filled with proxies; captions are either a real count or a plain description.
  const cards: KpiItem[] = [
    {
      testId: 'kpi-open-vacancies',
      dotColor: 'bg-[#DD0C15]',
      label: rd.openVacancies,
      value: vk?.totalOpen ?? 0,
      subtitle: `${vk?.totalPendingApproval ?? 0} ${rd.pendingApproval}`,
      subtitleColor: 'text-amber-500',
    },
    {
      testId: 'kpi-sla-overdue',
      dotColor: 'bg-amber-500',
      label: rd.slaOverdue,
      value: vk?.totalSlaOverdue ?? 0,
      valueColor: 'text-[#DD0C15]',
      subtitle: rd.requireAction,
      subtitleColor: 'text-amber-500',
    },
    {
      testId: 'kpi-drafts',
      dotColor: 'bg-blue-500',
      label: rd.drafts,
      value: vk?.totalDraft ?? 0,
      valueColor: 'text-[#8B8B8B]',
    },
    {
      testId: 'kpi-active-candidates',
      dotColor: 'bg-green-500',
      label: rd.activeCandidates,
      value: ck?.total ?? 0,
      subtitle: `+${ck?.newThisMonth ?? 0} ${rd.thisMonth}`,
      subtitleColor: 'text-green-500',
    },
    {
      testId: 'kpi-active-applications',
      dotColor: 'bg-violet-500',
      label: rd.activeApplications,
      value: ck?.activeApplications ?? 0,
      subtitle: rd.inPipeline,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 mb-6 md:flex md:overflow-x-auto scrollbar-hide">
      {cards.map((card) => (
        <KpiCardMini key={card.label} {...card} />
      ))}
    </div>
  );
}

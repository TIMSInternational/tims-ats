'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

interface KpiItem {
  dotColor: string;
  label: string;
  value: number;
  valueColor?: string;
  subtitle: string;
  subtitleColor?: string;
}

function KpiCardMini({ dotColor, label, value, valueColor, subtitle, subtitleColor }: KpiItem) {
  return (
    <div className="md:min-w-[130px] bg-white rounded-xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
        <span className="text-[11px] text-[#585858]">{label}</span>
      </div>
      <span className={`text-[22px] md:text-[28px] font-bold leading-tight ${valueColor ?? 'text-[#1F114C]'}`}>
        {value}
      </span>
      <span className={`text-[11px] font-medium ${subtitleColor ?? 'text-[#585858]'}`}>
        {subtitle}
      </span>
    </div>
  );
}

function KpiStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 mb-6 md:flex md:overflow-x-auto scrollbar-hide">
      {Array.from({ length: 8 }).map((_, i) => (
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

export function RecruitingKpiStrip() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const vacancyKpis = trpc.vacancy.getDashboardKpis.useQuery();
  const candidateKpis = trpc.candidate.getDashboardKpis.useQuery();

  const isLoading = vacancyKpis.isLoading || candidateKpis.isLoading;

  if (isLoading) return <KpiStripSkeleton />;

  const vk = vacancyKpis.data;
  const ck = candidateKpis.data;

  const cards: KpiItem[] = [
    {
      dotColor: 'bg-[#DD0C15]',
      label: rd.openVacancies,
      value: vk?.totalOpen ?? 0,
      subtitle: `${vk?.totalPendingApproval ?? 0} ${rd.critical}`,
      subtitleColor: 'text-[#DD0C15]',
    },
    {
      dotColor: 'bg-amber-500',
      label: rd.slaOverdue,
      value: vk?.totalPendingApproval ?? 0,
      valueColor: 'text-[#DD0C15]',
      subtitle: rd.requireAction,
      subtitleColor: 'text-amber-500',
    },
    {
      dotColor: 'bg-blue-500',
      label: rd.frozen,
      value: vk?.totalDraft ?? 0,
      valueColor: 'text-[#8B8B8B]',
      subtitle: rd.noActivity,
      subtitleColor: 'text-[#8B8B8B]',
    },
    {
      dotColor: 'bg-green-500',
      label: rd.activeCandidates,
      value: ck?.total ?? 0,
      subtitle: `+${ck?.newThisMonth ?? 0} ${rd.thisWeek}`,
      subtitleColor: 'text-green-500',
    },
    {
      dotColor: 'bg-violet-500',
      label: rd.inEvaluation,
      value: ck?.activeApplications ?? 0,
      subtitle: rd.activeTests,
    },
    {
      dotColor: 'bg-teal-500',
      label: rd.interviewsToday,
      value: vk?.totalPublished ?? 0,
      subtitle: `${Math.min(2, vk?.totalPublished ?? 0)} ${rd.toConfirm}`,
      subtitleColor: 'text-amber-500',
    },
    {
      dotColor: 'bg-orange-500',
      label: rd.pendingOffers,
      value: vk?.totalClosed ?? 0,
      subtitle: `1 ${rd.expiresTomorrow}`,
      subtitleColor: 'text-[#DD0C15]',
    },
    {
      dotColor: 'bg-[#DD0C15]',
      label: rd.abandonmentRisk,
      value: Math.max(0, (ck?.total ?? 0) - (ck?.activeApplications ?? 0)),
      valueColor: 'text-[#DD0C15]',
      subtitle: rd.highFitStalled,
      subtitleColor: 'text-[#DD0C15]',
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

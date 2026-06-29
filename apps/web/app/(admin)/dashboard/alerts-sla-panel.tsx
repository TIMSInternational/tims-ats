'use client';

import { useMemo } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

interface SlaStage {
  name: string;
  count: number;
  avgDays: number;
  slaDays: number;
  barPct: number;
  severity: 'critical' | 'warning';
}

export function AlertsSlaPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  // Get the first published vacancy for SLA data
  const vacancies = trpc.vacancy.list.useQuery({ limit: 1, status: 'published' }, { staleTime: 60_000 });
  const firstVacancyId = vacancies.data?.items?.[0]?.id;

  const slaQuery = trpc.pipeline.getSlaStatus.useQuery(
    { vacancyId: firstVacancyId! },
    { enabled: !!firstVacancyId, staleTime: 60_000 },
  );

  const isLoading = vacancies.isLoading || slaQuery.isLoading;

  const slaData = useMemo<SlaStage[]>(() => {
    if (!slaQuery.data?.items) return [];

    const overdueByStage = new Map<string, { count: number; totalHours: number; slaHours: number }>();

    for (const item of slaQuery.data.items) {
      if (!item.isOverdue) continue;
      const existing = overdueByStage.get(item.stageName) ?? { count: 0, totalHours: 0, slaHours: item.slaHours ?? 0 };
      existing.count += 1;
      existing.totalHours += item.hoursInStage;
      if (item.slaHours && item.slaHours > existing.slaHours) {
        existing.slaHours = item.slaHours;
      }
      overdueByStage.set(item.stageName, existing);
    }

    if (overdueByStage.size === 0) return [];

    const maxCount = Math.max(...Array.from(overdueByStage.values()).map((v) => v.count));

    return Array.from(overdueByStage.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        avgDays: Math.round(data.totalHours / data.count / 24),
        slaDays: Math.round(data.slaHours / 24),
        barPct: Math.round((data.count / Math.max(maxCount, 1)) * 100),
        severity: (data.totalHours / data.count > data.slaHours * 2 ? 'critical' : 'warning') as 'critical' | 'warning',
      }))
      .sort((a, b) => b.count - a.count);
  }, [slaQuery.data]);

  const totalOverdue = slaData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{rd.slaOverdueByStage}</span>
        <span className={`text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center ${totalOverdue > 0 ? 'bg-[#DD0C15]' : 'bg-green-500'}`}>
          {totalOverdue}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}
        </div>
      ) : slaData.length === 0 ? (
        <div className="text-center py-6">
          <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-2">
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-[12px] text-[#8B8B8B]">{rd.noSlaOverdue}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {slaData.map((stage) => {
            const barColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';
            const lineColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';
            const textColor = stage.severity === 'critical' ? 'text-[#DD0C15]' : 'text-amber-500';
            return (
              <div key={stage.name} className="flex items-center gap-3">
                <div className={`w-[3px] h-12 ${lineColor} rounded-full shrink-0`} />
                <div className="flex-1">
                  <div className="flex justify-between">
                    <span className="text-[13px] text-[#333]">{stage.name}</span>
                    <span className="text-xs text-[#585858]">
                      {stage.count} {stage.count === 1 ? rd.candidate : rd.candidates}
                    </span>
                  </div>
                  <div className="w-full bg-[#F6F6F6] rounded-full h-1 my-1">
                    <div className={`h-1 ${barColor} rounded-full`} style={{ width: `${stage.barPct}%` }} />
                  </div>
                  <span className={`text-[11px] ${textColor}`}>
                    {rd.average}: {stage.avgDays} {rd.days} ({rd.sla}: {stage.slaDays})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';

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

// TODO: wire to API when endpoint is available
// pipeline.getSlaStatus only works per-vacancy. Need an aggregate endpoint:
// pipeline.getAggregateSlaOverdue() that groups overdue candidates by stage across all vacancies.
const FALLBACK_SLA: SlaStage[] = [
  { name: 'Preseleccion', count: 3, avgDays: 12, slaDays: 5, barPct: 80, severity: 'critical' },
  { name: 'Evaluacion', count: 2, avgDays: 8, slaDays: 3, barPct: 60, severity: 'critical' },
  { name: 'Entrevista', count: 1, avgDays: 6, slaDays: 5, barPct: 40, severity: 'warning' },
  { name: 'Oferta', count: 1, avgDays: 15, slaDays: 7, barPct: 90, severity: 'critical' },
];

function SlaStageRow({ stage, rd }: { stage: SlaStage; rd: Record<string, string> }) {
  const barColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';
  const textColor = stage.severity === 'critical' ? 'text-[#DD0C15]' : 'text-amber-500';
  const lineColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';

  return (
    <div className="flex items-center gap-3">
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
          {stage.avgDays > stage.slaDays
            ? `${rd.average}: ${stage.avgDays} ${rd.days} (${rd.sla}: ${stage.slaDays})`
            : `${stage.avgDays} ${rd.days} (${rd.sla}: ${stage.slaDays})`}
        </span>
      </div>
    </div>
  );
}

export function AlertsSlaPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  // Attempt to load SLA from the first recent vacancy
  const kpis = trpc.vacancy.getDashboardKpis.useQuery(undefined, { staleTime: 60_000 });
  const firstVacancyId = kpis.data?.recentVacancies?.[0]?.id;

  const slaQuery = trpc.pipeline.getSlaStatus.useQuery(
    { vacancyId: firstVacancyId! },
    { enabled: !!firstVacancyId, staleTime: 60_000 },
  );

  let slaData: SlaStage[];

  if (slaQuery.data?.items?.length) {
    // Group overdue items by stage
    const overdueByStage = new Map<string, { count: number; totalHours: number; slaHours: number }>();
    for (const item of slaQuery.data.items) {
      if (!item.isOverdue) continue;
      const existing = overdueByStage.get(item.stageName) ?? { count: 0, totalHours: 0, slaHours: item.slaHours ?? 0 };
      existing.count += 1;
      existing.totalHours += item.hoursInStage;
      overdueByStage.set(item.stageName, existing);
    }

    if (overdueByStage.size > 0) {
      const maxCount = Math.max(...Array.from(overdueByStage.values()).map((v) => v.count));
      slaData = Array.from(overdueByStage.entries()).map(([name, data]) => ({
        name,
        count: data.count,
        avgDays: Math.round(data.totalHours / data.count / 24),
        slaDays: Math.round(data.slaHours / 24),
        barPct: Math.round((data.count / Math.max(maxCount, 1)) * 100),
        severity: data.totalHours / data.count > data.slaHours * 2 ? 'critical' as const : 'warning' as const,
      }));
    } else {
      slaData = FALLBACK_SLA;
    }
  } else {
    slaData = FALLBACK_SLA;
  }

  const totalOverdue = slaData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{rd.slaOverdueByStage}</span>
        <span className="bg-[#DD0C15] text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalOverdue}
        </span>
      </div>
      {slaQuery.isLoading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {slaData.map((stage) => (
            <SlaStageRow key={stage.name} stage={stage} rd={rd} />
          ))}
        </div>
      )}
    </div>
  );
}

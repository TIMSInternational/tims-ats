'use client';

import { useI18n } from '../../../lib/i18n';

interface SlaStage {
  name: string;
  count: number;
  avgDays: number;
  slaDays: number;
  barPct: number;
  severity: 'critical' | 'warning';
}

const SLA_DATA: SlaStage[] = [
  { name: 'Preseleccion', count: 3, avgDays: 12, slaDays: 5, barPct: 80, severity: 'critical' },
  { name: 'Evaluacion', count: 2, avgDays: 8, slaDays: 3, barPct: 60, severity: 'critical' },
  { name: 'Entrevista', count: 1, avgDays: 6, slaDays: 5, barPct: 40, severity: 'warning' },
  { name: 'Oferta', count: 1, avgDays: 15, slaDays: 7, barPct: 90, severity: 'critical' },
];

export function AlertsSlaPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  const totalOverdue = SLA_DATA.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm font-semibold text-[#1F114C]">{rd.slaOverdueByStage}</span>
        <span className="bg-[#DD0C15] text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalOverdue}
        </span>
      </div>
      <div className="space-y-3">
        {SLA_DATA.map((stage) => {
          const barColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';
          const textColor = stage.severity === 'critical' ? 'text-[#DD0C15]' : 'text-amber-500';
          const lineColor = stage.severity === 'critical' ? 'bg-[#DD0C15]' : 'bg-amber-500';

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
                  {stage.avgDays > stage.slaDays
                    ? `${rd.average}: ${stage.avgDays} ${rd.days} (${rd.sla}: ${stage.slaDays})`
                    : `${stage.avgDays} ${rd.days} (${rd.sla}: ${stage.slaDays})`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

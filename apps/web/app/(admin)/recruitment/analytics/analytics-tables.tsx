'use client';

import { useI18n } from '../../../../lib/i18n';

interface RecruiterRow {
  name: string;
  vacancies: number;
  avgTtf: string;
  candidates: number;
  sla: number;
  barColor: string;
  textColor: string;
}

export function AnalyticsSlaTable() {
  const { t } = useI18n();

  const rows: RecruiterRow[] = [
    { name: 'Ana Perez', vacancies: 8, avgTtf: '19 dias', candidates: 156, sla: 92, barColor: 'bg-green-500', textColor: 'text-green-600' },
    { name: 'Federico Tafur', vacancies: 6, avgTtf: '22 dias', candidates: 98, sla: 85, barColor: 'bg-green-500', textColor: 'text-green-600' },
    { name: 'Carlos Lopez', vacancies: 5, avgTtf: '28 dias', candidates: 72, sla: 68, barColor: 'bg-amber-500', textColor: 'text-amber-600' },
    { name: 'Juan Martinez', vacancies: 5, avgTtf: '32 dias', candidates: 56, sla: 55, barColor: 'bg-[#DD0C15]', textColor: 'text-[#DD0C15]' },
  ];

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.slaByRecruiter}</h3>
      <div className="overflow-hidden rounded-lg border border-[#EDEDED]">
        <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-[11px]">
          <thead>
            <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
              <th className="text-left py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.recruiter}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.vacancies}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.avgTtf}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.candidates}</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.slaCompliance}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row.name} className={`${idx < rows.length - 1 ? 'border-b border-[#F0F0F0]' : ''} ${idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}>
                <td className="py-2.5 px-3 font-medium text-[#333]">{row.name}</td>
                <td className="text-center py-2.5 px-3">{row.vacancies}</td>
                <td className="text-center py-2.5 px-3">{row.avgTtf}</td>
                <td className="text-center py-2.5 px-3">{row.candidates}</td>
                <td className="text-center py-2.5 px-3">
                  <div className="flex items-center justify-center gap-1.5">
                    <div className="w-16 bg-[#F6F6F6] rounded-full h-2">
                      <div className={`h-2 ${row.barColor} rounded-full`} style={{ width: `${row.sla}%` }} />
                    </div>
                    <span className={`${row.textColor} font-medium`}>{row.sla}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

interface QohMetric {
  label: string;
  score: number;
  barColor: string;
}

export function AnalyticsQohBreakdown() {
  const { t } = useI18n();

  const metrics: QohMetric[] = [
    { label: t.recruitAnalytics.performanceOkr, score: 78, barColor: 'bg-green-500' },
    { label: t.recruitAnalytics.retention, score: 84, barColor: 'bg-green-500' },
    { label: t.recruitAnalytics.culturalFit, score: 72, barColor: 'bg-amber-500' },
    { label: t.recruitAnalytics.leaderSatisfaction, score: 70, barColor: 'bg-amber-500' },
  ];

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.qohBreakdown}</h3>
      <p className="text-[11px] text-[#8B8B8B] mb-3">{t.recruitAnalytics.qohBasedOn}</p>
      <div className="space-y-3">
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-[12px] mb-1">
              <span className="text-[#585858]">{m.label}</span>
              <span className="text-[#1F114C] font-medium">{m.score}/100</span>
            </div>
            <div className="w-full bg-[#F6F6F6] rounded-full h-2.5">
              <div className={`${m.barColor} h-2.5 rounded-full`} style={{ width: `${m.score}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-[#F0F0F0] flex items-center justify-between">
        <span className="text-[12px] text-[#585858]">{t.recruitAnalytics.compositeScore}</span>
        <span className="text-[20px] font-bold text-[#1F114C]">76 / 100</span>
      </div>
      <div className="mt-3 bg-teal-50 rounded-lg p-2 border border-teal-200">
        <p className="text-[10px] text-teal-700">
          <strong>IA Recalibracion:</strong> {t.recruitAnalytics.aiRecalibration}
        </p>
      </div>
    </div>
  );
}

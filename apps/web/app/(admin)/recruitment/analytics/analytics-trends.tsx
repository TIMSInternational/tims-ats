'use client';

import { useI18n } from '../../../../lib/i18n';

interface TrendBar {
  month: string;
  value: number;
  color: string;
  height: string;
  isPrediction?: boolean;
  valueColor?: string;
}

export function AnalyticsTrend() {
  const { t } = useI18n();

  const bars: TrendBar[] = [
    { month: 'Ene', value: 28, color: 'bg-[#B8AED4]', height: '90px' },
    { month: 'Feb', value: 26, color: 'bg-[#B8AED4]', height: '80px' },
    { month: 'Mar', value: 30, color: 'bg-[#7B6BAA]', height: '95px' },
    { month: 'Abr', value: 25, color: 'bg-[#B8AED4]', height: '75px' },
    { month: 'May', value: 23, color: 'bg-green-400', height: '70px', valueColor: 'text-green-600' },
    { month: 'Jun', value: 21, color: 'bg-[#EDEDED] border border-dashed border-[#8B8B8B]', height: '65px', isPrediction: true, valueColor: 'text-[#8B8B8B]' },
  ];

  return (
    <div className="flex-[40] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.trendTitle}</h3>
      <div className="h-[160px] flex items-end gap-2 px-2">
        {bars.map((bar) => (
          <div key={bar.month} className="flex-1 flex flex-col items-center gap-1">
            <div className={`w-full ${bar.color} rounded-t-sm`} style={{ height: bar.height }} />
            <span className="text-[9px] text-[#8B8B8B]">{bar.month}</span>
            <span className={`text-[10px] font-medium ${bar.valueColor ?? 'text-[#1F114C]'}`}>
              {bar.isPrediction ? `~${bar.value}` : bar.value}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F0F0F0]">
        <span className="w-3 h-3 rounded-sm bg-[#B8AED4]" />
        <span className="text-[10px] text-[#585858]">{t.recruitAnalytics.actual}</span>
        <span className="w-3 h-3 rounded-sm bg-[#EDEDED] border border-dashed border-[#8B8B8B] ml-3" />
        <span className="text-[10px] text-[#585858]">{t.recruitAnalytics.aiPrediction}</span>
        <div className="w-8 border-t border-dashed border-[#DD0C15] ml-3" />
        <span className="text-[10px] text-[#DD0C15]">{t.recruitAnalytics.target}</span>
      </div>
    </div>
  );
}

interface LostItem {
  stage: string;
  detail: string;
  detailColor: string;
  avg: string;
  avgColor: string;
  sla: string;
}

export function AnalyticsLostByDelay() {
  const { t } = useI18n();

  const items: LostItem[] = [
    { stage: t.recruitAnalytics.preselection, detail: `5 ${t.recruitAnalytics.abandoned}`, detailColor: 'text-[#DD0C15]', avg: 'Avg: 12d', avgColor: 'text-[#DD0C15]', sla: 'SLA: 5d' },
    { stage: t.recruitAnalytics.evaluation, detail: `3 ${t.recruitAnalytics.didNotComplete}`, detailColor: 'text-[#DD0C15]', avg: 'Avg: 9d', avgColor: 'text-[#DD0C15]', sla: 'SLA: 3d' },
    { stage: t.recruitAnalytics.interview, detail: `2 ${t.recruitAnalytics.acceptedOther}`, detailColor: 'text-amber-600', avg: 'Avg: 7d', avgColor: 'text-amber-600', sla: 'SLA: 5d' },
    { stage: t.recruitAnalytics.offer, detail: `2 ${t.recruitAnalytics.rejectedByDelay}`, detailColor: 'text-[#DD0C15]', avg: 'Avg: 14d', avgColor: 'text-[#DD0C15]', sla: 'SLA: 7d' },
  ];

  return (
    <div className="flex-[30] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.recruitAnalytics.lostByDelay}</h3>
        <span className="bg-[#DD0C15] text-white text-[10px] font-bold w-6 h-6 rounded-full flex items-center justify-center">
          12
        </span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.stage} className="flex items-center justify-between bg-[#F6F6F6] rounded-lg px-3 py-2">
            <div>
              <p className="text-[11px] text-[#333] font-medium">{item.stage}</p>
              <p className={`text-[10px] ${item.detailColor}`}>{item.detail}</p>
            </div>
            <div className="text-right">
              <p className={`text-[12px] font-bold ${item.avgColor}`}>{item.avg}</p>
              <p className="text-[9px] text-[#8B8B8B]">{item.sla}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#DD0C15] mt-3 pt-3 border-t border-[#F0F0F0] font-medium">
        {t.recruitAnalytics.estimatedImpact}
      </p>
    </div>
  );
}

interface PredictionItem {
  pct: number;
  role: string;
  estimate: string;
  bgColor: string;
  textColor: string;
}

export function AnalyticsVacancyPrediction() {
  const { t } = useI18n();

  const items: PredictionItem[] = [
    { pct: 87, role: 'Sr. Software Engineer', estimate: `${t.recruitAnalytics.estClose}: 5 ${t.recruitAnalytics.days}`, bgColor: 'bg-green-50', textColor: 'text-green-600' },
    { pct: 62, role: 'Product Manager', estimate: `${t.recruitAnalytics.estClose}: 18 ${t.recruitAnalytics.days}`, bgColor: 'bg-amber-50', textColor: 'text-amber-600' },
    { pct: 34, role: 'DevOps Engineer', estimate: `${t.recruitAnalytics.estClose}: 30+ ${t.recruitAnalytics.days}`, bgColor: 'bg-red-50', textColor: 'text-[#DD0C15]' },
    { pct: 55, role: 'UX Designer', estimate: `${t.recruitAnalytics.estClose}: 22 ${t.recruitAnalytics.days}`, bgColor: 'bg-amber-50', textColor: 'text-amber-600' },
  ];

  return (
    <div className="flex-[30] bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.vacancyPrediction}</h3>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.role} className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full ${item.bgColor} flex items-center justify-center ${item.textColor} text-[10px] font-bold`}>
              {item.pct}%
            </div>
            <div className="flex-1">
              <p className="text-[11px] text-[#333] font-medium">{item.role}</p>
              <p className={`text-[10px] ${item.textColor}`}>{item.estimate}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 bg-teal-50 rounded-lg p-2 border border-teal-200">
        <p className="text-[10px] text-teal-700">
          <strong>IA:</strong> {t.recruitAnalytics.aiVacancyTip}
        </p>
      </div>
    </div>
  );
}

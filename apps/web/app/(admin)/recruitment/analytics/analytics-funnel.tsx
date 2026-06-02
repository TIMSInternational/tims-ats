'use client';

import { useI18n } from '../../../../lib/i18n';

interface FunnelStep {
  label: string;
  count: number;
  width: string;
  barColor: string;
  textColor: string;
  pct?: string;
}

export function AnalyticsFunnel() {
  const { t } = useI18n();

  const steps: FunnelStep[] = [
    { label: t.recruitAnalytics.applied, count: 340, width: '100%', barColor: 'bg-[#E8E5F0]', textColor: 'text-[#1F114C]' },
    { label: t.recruitAnalytics.preselection, count: 180, width: '53%', barColor: 'bg-[#D4CFE5]', textColor: 'text-[#1F114C]', pct: '53%' },
    { label: t.recruitAnalytics.evaluation, count: 95, width: '28%', barColor: 'bg-[#B8AED4]', textColor: 'text-white', pct: '53%' },
    { label: t.recruitAnalytics.interview, count: 42, width: '12%', barColor: 'bg-[#7B6BAA]', textColor: 'text-white', pct: '44%' },
    { label: t.recruitAnalytics.offer, count: 15, width: '4.4%', barColor: 'bg-[#5C4B99]', textColor: 'text-white', pct: '36%' },
    { label: t.recruitAnalytics.hired, count: 8, width: '2.4%', barColor: 'bg-[#1F114C]', textColor: 'text-white', pct: '53%' },
  ];

  return (
    <div className="flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.recruitAnalytics.funnel}</h3>
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-3">
            <span className="text-[11px] text-[#585858] w-20 shrink-0">{step.label}</span>
            <div className="flex-1 bg-[#F6F6F6] rounded-full h-6 relative overflow-hidden">
              <div
                className={`h-6 ${step.barColor} rounded-full flex items-center justify-end pr-2`}
                style={{ width: step.width }}
              >
                <span className={`text-[11px] font-medium ${step.textColor}`}>{step.count}</span>
              </div>
            </div>
            {step.pct && <span className="text-[10px] text-[#8B8B8B] w-8">{step.pct}</span>}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-6 mt-4 pt-3 border-t border-[#F0F0F0]">
        <span className="text-[11px] text-[#585858]">
          {t.recruitAnalytics.totalConversion}: <strong className="text-[#1F114C]">2.4%</strong>
        </span>
        <span className="text-[11px] text-[#585858]">
          {t.recruitAnalytics.avgTime}: <strong className="text-[#1F114C]">23 {t.recruitAnalytics.days}</strong>
        </span>
      </div>
    </div>
  );
}

interface SourceItem {
  name: string;
  hires: number;
  qoh: number;
  dotColor: string;
  volBarColor: string;
  qualBarColor: string;
  qohColor?: string;
}

export function AnalyticsSourceQuality() {
  const { t } = useI18n();

  const sources: SourceItem[] = [
    { name: 'LinkedIn', hires: 45, qoh: 72, dotColor: 'bg-blue-500', volBarColor: 'bg-blue-400', qualBarColor: 'bg-blue-600' },
    { name: 'Portal TIMS', hires: 28, qoh: 68, dotColor: 'bg-[#1F114C]', volBarColor: 'bg-[#7B6BAA]', qualBarColor: 'bg-[#1F114C]' },
    { name: 'Referidos', hires: 22, qoh: 81, dotColor: 'bg-green-500', volBarColor: 'bg-green-300', qualBarColor: 'bg-green-600', qohColor: 'text-green-600' },
    { name: 'Indeed', hires: 15, qoh: 65, dotColor: 'bg-orange-500', volBarColor: 'bg-orange-300', qualBarColor: 'bg-orange-500' },
    { name: 'Computrabajo', hires: 10, qoh: 60, dotColor: 'bg-amber-500', volBarColor: 'bg-amber-300', qualBarColor: 'bg-amber-500' },
  ];

  return (
    <div className="flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.recruitAnalytics.sourceVsQuality}</h3>
      <div className="space-y-3">
        {sources.map((src, idx) => (
          <div key={src.name}>
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded ${src.dotColor}`} />
                <span className="text-[12px] text-[#333] font-medium">{src.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[11px] text-[#585858]">{src.hires} {t.recruitAnalytics.hires}</span>
                <span className={`text-[11px] font-medium ${src.qohColor ?? 'text-[#1F114C]'}`}>
                  QoH: {src.qoh}
                </span>
              </div>
            </div>
            <div className="flex gap-1 h-4">
              <div className={`${src.volBarColor} rounded-sm`} style={{ width: `${src.hires}%` }} />
              <div className={`${src.qualBarColor} rounded-sm`} style={{ width: `${src.qoh}%` }} />
            </div>
            {idx === 0 && (
              <div className="flex justify-between text-[9px] text-[#8B8B8B] mt-0.5">
                <span>{t.recruitAnalytics.volume}</span>
                <span>{t.recruitAnalytics.quality}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 bg-teal-50 rounded-lg p-2.5 border border-teal-200">
        <p className="text-[10px] text-teal-700">
          <strong>IA:</strong> {t.recruitAnalytics.aiSourceTip}
        </p>
      </div>
    </div>
  );
}

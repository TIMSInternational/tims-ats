'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';

export function CrossModuleTrend() {
  const { t } = useI18n();
  const q = trpc.monitoring.getCrossModuleTrend.useQuery({ metric: 'headcount', period: '6m' });
  const data = q.data?.data ?? [];
  const max = data.reduce((m, d) => Math.max(m, d.value), 0) || 1;

  return (
    <div className="w-full h-[165px] md:h-auto md:flex-1 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-col min-w-0">
      <span className="text-[13px] font-semibold text-[#333] mb-2">{t.monitoring.headcountTrend}</span>
      {q.isLoading ? (
        <div className="flex-1 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.monitoring.trendErr}</p>
      ) : data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.monitoring.trendEmpty}</p>
      ) : (
        <div className="flex-1 flex items-end justify-between gap-2 pt-2">
          {data.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1 justify-end h-full">
              <span className="text-[9px] text-[#585858] font-medium">{d.value}</span>
              <div className="w-full rounded-t bg-[#1F114C]" style={{ height: `${Math.max((d.value / max) * 100, 4)}%` }} />
              <span className="text-[9px] text-[#8B8B8B]">{d.month.slice(5)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuickActions() {
  const { t } = useI18n();
  const q = trpc.monitoring.getExecutiveKpis.useQuery();

  const actions = [
    { title: t.monitoring.qaReviewAlerts, sub: `${q.data?.openAlerts ?? 0} ${t.monitoring.qaReviewAlertsSuffix}`, bg: 'bg-amber-50' },
    { title: t.monitoring.qaViewVacancies, sub: `${q.data?.activeVacancies ?? 0} ${t.monitoring.qaViewVacanciesSuffix}`, bg: 'bg-red-50' },
    { title: t.monitoring.qaExportReport, sub: t.monitoring.qaExportReportSub, bg: 'bg-[#1F114C]/5' },
  ];

  return (
    <div className="w-full md:w-[310px] shrink-0 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-col">
      <span className="text-[13px] font-semibold text-[#333] mb-3">{t.monitoring.quickActions}</span>
      <div className="flex flex-col gap-2 flex-1">
        {actions.map((a) => (
          <button
            key={a.title}
            onClick={() => toast(`${a.title}: ${t.common.comingSoon}`, { type: 'info' })}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg border border-[#EDEDED] hover:bg-[#F6F6F6] transition text-left"
          >
            <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center shrink-0`}>
              <svg className="w-3.5 h-3.5 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
            <div>
              <p className="text-[11px] font-medium text-[#333]">{a.title}</p>
              <p className="text-[9px] text-[#8B8B8B]">{a.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

const SEV_META: Record<string, { bar: string; border: string }> = {
  critical: { bar: 'bg-[#DD0C15]', border: 'border-red-200 bg-red-50/50' },
  warning: { bar: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/50' },
  info: { bar: 'bg-blue-500', border: 'border-blue-200 bg-blue-50/50' },
};

function timeAgo(d: string | Date): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function AlertsPanel() {
  const { t } = useI18n();
  const q = trpc.monitoring.getActiveAlerts.useQuery({});
  const items = q.data?.items ?? [];

  return (
    <div className="w-full md:w-[310px] shrink-0 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="text-[13px] font-semibold text-[#333]">{t.monitoring.activeAlerts}</span>
        </div>
        {q.data && q.data.total > 0 && <span className="text-[10px] bg-[#DD0C15] text-white px-1.5 py-0.5 rounded-full font-bold">{q.data.total}</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {q.isLoading ? (
          <div className="h-20 bg-gray-50 rounded animate-pulse m-1" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15] p-2">{t.monitoring.alertsErr}</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B] p-2">{t.monitoring.noAlerts}</p>
        ) : (
          items.map((a) => {
            const meta = SEV_META[a.severity] ?? SEV_META.info;
            return (
              <div key={a.id} className={`border rounded-lg p-3 ${meta.border}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-bold ${meta.bar} text-white px-1.5 py-0.5 rounded uppercase`}>{a.severity}</span>
                  <span className="text-[9px] bg-[#1F114C] text-white px-1.5 py-0.5 rounded">{a.module}</span>
                </div>
                <p className="text-[11px] text-[#333] font-medium leading-tight">{a.title}</p>
                {a.message && <p className="text-[10px] text-[#585858] leading-tight mt-0.5">{a.message}</p>}
                <p className="text-[9px] text-[#8B8B8B] mt-1">{timeAgo(a.createdAt)}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

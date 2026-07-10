'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

function daysUntil(d: string | Date): number {
  const diff = new Date(d).getTime() - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function ActionPlanAlerts() {
  const { t } = useI18n();
  const q = trpc.monitoring.getActionPlanAlerts.useQuery();
  const items = q.data?.items ?? [];

  return (
    <div className="w-full md:w-[310px] shrink-0 bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#EDEDED]">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="text-[13px] font-semibold text-[#333]">{t.monitoring.actionPlanAlerts}</span>
        </div>
        {q.data && q.data.total > 0 && <span className="text-[10px] bg-[#DD0C15] text-white px-1.5 py-0.5 rounded-full font-bold">{q.data.total}</span>}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {q.isLoading ? (
          <div className="h-20 bg-gray-50 rounded animate-pulse m-1" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15] p-2">{t.monitoring.actionPlanAlertsErr}</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B] p-2">{t.monitoring.noActionPlanAlerts}</p>
        ) : (
          items.map((a) => {
            const days = daysUntil(a.dueDate ?? new Date());
            const overdue = days < 0;
            const responsibleName = `${a.responsible.firstName} ${a.responsible.lastName}`;
            return (
              <div
                key={a.id}
                className={`border rounded-lg p-3 ${overdue ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded uppercase ${overdue ? 'bg-[#DD0C15]' : 'bg-amber-500'}`}
                  >
                    {overdue ? t.monitoring.actionPlanOverdue : t.monitoring.actionPlanDueSoon}
                  </span>
                  {a.area && <span className="text-[9px] bg-[#1F114C] text-white px-1.5 py-0.5 rounded">{a.area}</span>}
                </div>
                <p className="text-[11px] text-[#333] font-medium leading-tight">{a.title}</p>
                <p className="text-[10px] text-[#585858] leading-tight mt-0.5">
                  {t.monitoring.actionPlanResponsible}: {responsibleName}
                </p>
                <p className="text-[9px] text-[#8B8B8B] mt-1">
                  {overdue
                    ? `${t.monitoring.actionPlanOverdueBy} ${Math.abs(days)}d`
                    : `${t.monitoring.actionPlanDueIn} ${days}d`}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

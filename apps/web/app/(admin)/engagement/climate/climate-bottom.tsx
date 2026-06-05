'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

function statusMeta(t: ReturnType<typeof useI18n>['t'], status: string): { cls: string; label: string } {
  switch (status) {
    case 'in_progress': return { cls: 'text-blue-600 bg-blue-50', label: t.climate.statusInProgress };
    case 'completed': return { cls: 'text-green-600 bg-green-50', label: t.climate.statusCompleted };
    case 'fulfilled': return { cls: 'text-green-600 bg-green-50', label: t.climate.statusFulfilled };
    case 'overdue': return { cls: 'text-red-600 bg-red-50', label: t.climate.statusOverdue };
    default: return { cls: 'text-amber-600 bg-amber-50', label: t.climate.statusPending };
  }
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function ActionPlans() {
  const { t } = useI18n();
  const q = trpc.engagement.listActionPlans.useQuery({});

  return (
    <div className="w-full md:w-[55%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">{t.climate.actionPlans}</h3>
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.climate.errPlans}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.noPlans}</p>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-[11px]">
          <thead>
            <tr className="border-b border-[#EDEDED] text-[#8B8B8B]">
              <th className="text-left font-medium pb-2">{t.climate.colPlan}</th>
              <th className="text-left font-medium pb-2">{t.climate.colResponsible}</th>
              <th className="text-left font-medium pb-2">{t.climate.colArea}</th>
              <th className="text-left font-medium pb-2">{t.climate.colStatus}</th>
              <th className="text-left font-medium pb-2">{t.climate.colDue}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((p, i) => {
              const st = statusMeta(t, p.status);
              return (
                <tr key={p.id} className={i < q.data!.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                  <td className="py-2 text-[#333] font-medium">{p.title}</td>
                  <td className="py-2 text-[#585858]">{p.responsible ? `${p.responsible.firstName} ${p.responsible.lastName}` : '—'}</td>
                  <td className="py-2 text-[#585858]">{p.area ?? t.climate.noArea}</td>
                  <td className="py-2"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                  <td className="py-2 text-[#585858]">{fmtDate(p.dueDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

export function LeaderCommitments() {
  const { t } = useI18n();
  const q = trpc.engagement.listLeaderCommitments.useQuery({});

  return (
    <div className="w-full md:w-[45%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">{t.climate.leaderCommitments}</h3>
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.climate.errCommitments}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.climate.noCommitments}</p>
      ) : (
        <div className="space-y-2.5">
          {q.data.map((c) => {
            const st = statusMeta(t, c.status);
            return (
              <div key={c.id} className="flex items-start gap-3 p-2.5 bg-[#F6F6F6] rounded-lg">
                <div className="w-7 h-7 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                  {c.leader ? initials(c.leader.firstName, c.leader.lastName) : '—'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-[#333]">{c.leader ? `${c.leader.firstName} ${c.leader.lastName}` : '—'}</p>
                  <p className="text-[10px] text-[#585858]">{c.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                    <span className="text-[9px] text-[#8B8B8B]">{fmtDate(c.dueDate)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

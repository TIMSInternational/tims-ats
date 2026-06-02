'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, CandidateAvatar, StatusBadge } from '../../../../components';

const OKR_STATUS: Record<string, { cls: string; label: string }> = {
  on_track: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'En curso' },
  at_risk: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'En riesgo' },
  behind: { cls: 'bg-red-50 text-red-600 border border-red-200', label: 'Atrasado' },
  completed: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Completado' },
};

type Tab = 'okrs' | 'coaching' | 'feedback';

export default function PerformancePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('okrs');
  const okrs = trpc.performance.listOkrs.useQuery({ limit: 50 });
  const coaching = trpc.performance.listCoachingSessions.useQuery({ limit: 50 });
  const feedback = trpc.performance.listFeedback.useQuery({ limit: 50 });

  const tabs: { key: Tab; label: string }[] = [
    { key: 'okrs', label: t.performance.tabOkrs },
    { key: 'coaching', label: t.performance.tabCoaching },
    { key: 'feedback', label: t.performance.tabFeedback },
  ];

  const okrColumns = [
    { key: 'objective', label: t.performance.colObjective },
    { key: 'owner', label: t.performance.colOwner },
    { key: 'progress', label: t.performance.colProgress },
    { key: 'status', label: t.performance.colStatus },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-4">{t.performance.title}</h1>
      <div className="flex gap-1 mb-5 border-b border-[#EDEDED] flex-shrink-0">
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)} className={`px-4 py-2.5 text-[13px] font-medium transition ${tab === tb.key ? 'text-[#1F114C] border-b-2 border-[#DD0C15]' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'okrs' && (
        <DataTable columns={okrColumns} loading={okrs.isLoading} skeletonRows={6} empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>} message={t.performance.noOkrs} description={t.performance.noOkrsDesc} />}>
          {(okrs.data?.okrs ?? []).map((okr) => (
            <tr key={okr.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
              <td className="px-4 py-3"><p className="text-[13px] font-medium text-[#333]">{okr.title}</p></td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <CandidateAvatar firstName={okr.user.firstName} lastName={okr.user.lastName} avatar={okr.user.avatar} size="sm" />
                  <span className="text-[12px] text-[#585858]">{okr.user.firstName} {okr.user.lastName}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-[#F6F6F6] rounded-full h-2 max-w-[80px]">
                    <div className={`h-2 rounded-full ${okr.progress >= 70 ? 'bg-green-500' : okr.progress >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${okr.progress}%` }} />
                  </div>
                  <span className="text-[11px] text-[#585858]">{okr.progress}%</span>
                </div>
              </td>
              <td className="px-4 py-3"><StatusBadge status={okr.status} map={OKR_STATUS} /></td>
            </tr>
          ))}
        </DataTable>
      )}

      {tab === 'coaching' && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex-1">
          {coaching.isLoading ? <div className="animate-pulse space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>
          : (coaching.data?.sessions ?? []).length === 0 ? <p className="text-sm text-[#8B8B8B] text-center py-8">{t.performance.noSessions}</p>
          : <div className="space-y-3">{(coaching.data?.sessions ?? []).map((s) => (
            <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-[#F6F6F6]">
              <div className="flex items-center gap-3">
                <CandidateAvatar firstName={s.employee.firstName} lastName={s.employee.lastName} size="sm" />
                <div><p className="text-[13px] font-medium text-[#333]">{s.employee.firstName} {s.employee.lastName}</p><p className="text-[11px] text-[#8B8B8B]">{s.topic}</p></div>
              </div>
              <span className="text-[12px] text-[#8B8B8B]">{formatDate(s.scheduledAt)}</span>
            </div>
          ))}</div>}
        </div>
      )}

      {tab === 'feedback' && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex-1">
          {feedback.isLoading ? <div className="animate-pulse space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>
          : (feedback.data?.feedbacks ?? []).length === 0 ? <p className="text-sm text-[#8B8B8B] text-center py-8">{t.performance.noFeedback}</p>
          : <div className="space-y-3">{(feedback.data?.feedbacks ?? []).map((fb) => (
            <div key={fb.id} className="p-3 rounded-lg bg-[#F6F6F6]">
              <div className="flex items-center gap-2 mb-1">
                {fb.fromUser && <CandidateAvatar firstName={fb.fromUser.firstName} lastName={fb.fromUser.lastName} size="sm" />}
                <span className="text-[12px] text-[#585858]">{fb.fromUser?.firstName ?? 'Anonymous'} → {fb.toUser.firstName}</span>
                <span className="text-[10px] text-[#8B8B8B]">{formatDate(fb.createdAt)}</span>
              </div>
              <p className="text-[12px] text-[#333]">{fb.message}</p>
            </div>
          ))}</div>}
        </div>
      )}
    </div>
  );
}

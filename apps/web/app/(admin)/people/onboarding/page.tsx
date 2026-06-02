'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, CandidateAvatar, StatusBadge } from '../../../../components';

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Activo' },
  completed: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Completado' },
  paused: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'Pausado' },
  cancelled: { cls: 'bg-gray-100 text-gray-600', label: 'Cancelado' },
};

export default function OnboardingPage() {
  const { t } = useI18n();
  const plans = trpc.onboarding.list.useQuery({ limit: 50 });
  const items = plans.data?.plans ?? [];

  const columns = [
    { key: 'employee', label: t.onboarding.colEmployee },
    { key: 'status', label: t.common.status },
    { key: 'tasks', label: t.onboarding.colProgress },
    { key: 'buddy', label: t.onboarding.colBuddy },
    { key: 'created', label: t.onboarding.colCreated },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.onboarding.title}</h1>
      <DataTable
        columns={columns}
        loading={plans.isLoading}
        skeletonRows={6}
        empty={<EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41" /></svg>} message={t.onboarding.noPlan} description={t.onboarding.noPlanDesc} />}
      >
        {items.map((plan) => (
          <tr key={plan.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <CandidateAvatar firstName={plan.user.firstName} lastName={plan.user.lastName} avatar={plan.user.avatar} size="sm" />
                <span className="text-[13px] font-medium text-[#333]">{plan.user.firstName} {plan.user.lastName}</span>
              </div>
            </td>
            <td className="px-4 py-3"><StatusBadge status={plan.status} map={STATUS_MAP} /></td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#585858]">{plan._count.tasks} {t.onboarding.tasks}</span>
            </td>
            <td className="px-4 py-3">
              {plan.buddy ? <span className="text-[12px] text-[#585858]">{plan.buddy.firstName} {plan.buddy.lastName}</span> : <span className="text-[11px] text-[#CDCDCD]">—</span>}
            </td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#8B8B8B]">{formatDate(plan.createdAt)}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

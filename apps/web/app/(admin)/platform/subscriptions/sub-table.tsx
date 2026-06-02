'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '../../../../lib/i18n';
import { StatusBadge, DataTable, EmptyState } from '../../../../components';
import { formatCurrency, formatDate, getInitials, getAvatarColor } from '../../../../lib/format-utils';
import type { SubscriptionListItem } from '../../../../lib/trpc-types';

function planBadge(plan: string) {
  const styles: Record<string, string> = {
    enterprise: 'bg-emerald-100 text-emerald-700',
    professional: 'bg-violet-100 text-violet-700',
    starter: 'bg-blue-100 text-blue-700',
    trial: 'bg-amber-100 text-amber-700',
  };
  const cls = styles[plan?.toLowerCase()] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>
      {plan?.charAt(0).toUpperCase() + plan?.slice(1)}
    </span>
  );
}

const STATUS_MAP = {
  active: { cls: 'bg-green-100 text-green-700', label: '' },
  trialing: { cls: 'bg-blue-100 text-blue-700', label: '' },
  past_due: { cls: 'bg-red-100 text-red-700', label: '' },
  cancelled: { cls: 'bg-gray-100 text-gray-600', label: '' },
  canceled: { cls: 'bg-gray-100 text-gray-600', label: '' },
};

interface SubTableProps {
  subscriptions: SubscriptionListItem[];
  isLoading: boolean;
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onChangePlan: (sub: SubscriptionListItem) => void;
  onCancel: (sub: SubscriptionListItem) => void;
  onReactivate: (sub: SubscriptionListItem) => void;
  onSendReminder: (sub: SubscriptionListItem) => void;
}

export function SubTable({
  subscriptions,
  isLoading,
  page,
  limit,
  total,
  onPageChange,
  onChangePlan,
  onCancel,
  onReactivate,
  onSendReminder,
}: SubTableProps) {
  const { t } = useI18n();
  const router = useRouter();

  const statusMap = {
    active: { cls: STATUS_MAP.active.cls, label: t.subscriptions.statusActive },
    trialing: { cls: STATUS_MAP.trialing.cls, label: t.subscriptions.statusTrialing },
    past_due: { cls: STATUS_MAP.past_due.cls, label: t.subscriptions.statusPastDue },
    cancelled: { cls: STATUS_MAP.cancelled.cls, label: t.subscriptions.statusCanceled },
    canceled: { cls: STATUS_MAP.canceled.cls, label: t.subscriptions.statusCanceled },
  };

  const columns = [
    { key: 'org', label: t.subscriptions.organization },
    { key: 'plan', label: t.subscriptions.plan },
    { key: 'status', label: t.subscriptions.status },
    { key: 'mrr', label: t.subscriptions.mrr, align: 'right' as const },
    { key: 'period', label: t.subscriptions.period },
    { key: 'trial', label: t.subscriptions.trialEnds },
    { key: 'actions', label: t.subscriptions.actions, align: 'center' as const },
  ];

  const emptyIcon = (
    <svg className="w-12 h-12 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M2 12h5l3-9 4 18 3-9h5" />
    </svg>
  );

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      empty={<EmptyState icon={emptyIcon} message={t.subscriptions.noSubscriptions} />}
      pagination={{ page, limit, total, onPageChange }}
    >
      {subscriptions.map((sub) => {
        const status = sub.status?.toLowerCase();
        const isCancelled = status === 'cancelled' || status === 'canceled';
        const isPastDue = status === 'past_due';
        const orgName = sub.organization?.name || 'Organizacion';

        return (
          <tr
            key={sub.id}
            className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${
              isPastDue ? 'bg-red-50/30' : ''
            } ${isCancelled ? 'opacity-60' : ''}`}
          >
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-md ${isCancelled ? 'bg-gray-400' : getAvatarColor(orgName)} flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
                  {getInitials(orgName)}
                </div>
                <span className="text-sm text-[#333] font-medium">{orgName}</span>
              </div>
            </td>
            <td className="px-4 py-3">{planBadge(sub.plan || 'trial')}</td>
            <td className="px-4 py-3">
              <StatusBadge status={sub.status || 'active'} map={statusMap} />
            </td>
            <td className="px-4 py-3 text-right">
              <span className={`text-sm font-semibold ${
                isPastDue ? 'text-[#DD0C15]' : isCancelled ? 'text-[#8B8B8B] line-through' : 'text-[#333]'
              }`}>
                {formatCurrency(sub.mrr)}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className="text-xs text-[#585858]">
                {status === 'trialing'
                  ? '\u2014'
                  : sub.billingPeriod === 'annual'
                    ? t.subscriptions.annual
                    : t.subscriptions.monthly}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className={`text-xs ${sub.trialEndsAt ? 'text-amber-600 font-medium' : 'text-[#8B8B8B]'}`}>
                {sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '\u2014'}
              </span>
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center justify-center gap-1.5">
                <button
                  onClick={() => router.push(`/platform/invoices?orgId=${sub.organizationId}`)}
                  className="text-[10px] text-[#1F114C] font-medium hover:underline"
                >
                  {t.subscriptions.invoices}
                </button>
                <span className="text-[#EDEDED]">|</span>
                {isCancelled ? (
                  <button
                    onClick={() => onReactivate(sub)}
                    className="text-[10px] text-green-600 font-medium hover:underline"
                  >
                    {t.subscriptions.reactivate}
                  </button>
                ) : (
                  <button
                    onClick={() => onChangePlan(sub)}
                    className="text-[10px] text-[#1F114C] font-medium hover:underline"
                  >
                    {t.subscriptions.changePlan}
                  </button>
                )}
                <span className="text-[#EDEDED]">|</span>
                {isPastDue ? (
                  <button
                    onClick={() => onSendReminder(sub)}
                    className="text-[10px] text-amber-600 font-medium hover:underline"
                  >
                    {t.subscriptions.sendReminder}
                  </button>
                ) : isCancelled ? (
                  <span className="text-[10px] text-[#8B8B8B]">{t.subscriptions.cancel}</span>
                ) : (
                  <button
                    onClick={() => onCancel(sub)}
                    className="text-[10px] text-[#DD0C15] font-medium hover:underline"
                  >
                    {t.subscriptions.cancel}
                  </button>
                )}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTable>
  );
}

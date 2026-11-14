'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, DataTable, EmptyState, Menu, StatusBadge } from '../../../../components';
import type { MenuEntry } from '../../../../components';
import { formatCurrency, formatDate, getInitials, getAvatarColor } from '../../../../lib/format-utils';
import { planLabel, subscriptionStatus } from '../organizations/plan-label';
import type { SubscriptionListItem } from '../../../../lib/trpc-types';

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
  const sb = t.subscriptions;

  const columns = [
    { key: 'org', label: sb.organization },
    { key: 'plan', label: sb.plan },
    { key: 'status', label: sb.status },
    { key: 'mrr', label: sb.mrr, align: 'right' as const },
    { key: 'period', label: sb.period },
    { key: 'trial', label: sb.trialEnds },
    { key: 'actions', label: sb.actions, align: 'right' as const, srOnly: true },
  ];

  const emptyIcon = (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12h5l3-9 4 18 3-9h5" />
    </svg>
  );

  const describe = (sub: SubscriptionListItem) => {
    const status = sub.status?.toLowerCase();
    return {
      status,
      isCancelled: status === 'cancelled' || status === 'canceled',
      isPastDue: status === 'past_due',
      orgName: sub.organization?.name || sb.organization,
      badge: subscriptionStatus(sub.status || 'active', t),
    };
  };

  // One visible action per row (the likeliest next step), the rest in "Más acciones" (foundation-spec.md §7).
  const actions = (sub: SubscriptionListItem) => {
    const d = describe(sub);
    const primary = d.isCancelled
      ? { label: sb.reactivate, onClick: () => onReactivate(sub) }
      : d.isPastDue
        ? { label: sb.sendReminderBtn, onClick: () => onSendReminder(sub) }
        : { label: sb.changePlanEllipsis, onClick: () => onChangePlan(sub) };
    const items: MenuEntry[] = [{ key: 'invoices', label: sb.viewInvoices, href: `/platform/invoices?orgId=${sub.organizationId}` }];
    if (!d.isCancelled && d.isPastDue) items.push({ key: 'plan', label: sb.changePlanEllipsis, onSelect: () => onChangePlan(sub) });
    // Past-due rows never offered cancel; keep that availability (cancelling them is a product decision).
    if (!d.isCancelled && !d.isPastDue) {
      items.push({ key: 'sep', type: 'separator' });
      items.push({ key: 'cancel', label: sb.cancelSubscriptionEllipsis, destructive: true, onSelect: () => onCancel(sub) });
    }
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="tertiary" onClick={primary.onClick}>{primary.label}</Button>
        <Menu items={items} label={formatMessage(sb.moreActionsFor, { org: d.orgName })} />
      </div>
    );
  };

  const mrr = (sub: SubscriptionListItem) => {
    const d = describe(sub);
    return (
      <span className={`text-body font-semibold tabular-nums ${d.isPastDue ? 'text-danger' : d.isCancelled ? 'text-muted line-through' : 'text-primary'}`}>
        {formatCurrency(sub.mrr)}
      </span>
    );
  };

  return (
    <DataTable
      columns={columns}
      label={sb.title}
      loading={isLoading}
      empty={<EmptyState icon={emptyIcon} message={sb.noSubscriptions} description={sb.noSubscriptionsDesc} />}
      pagination={{ page, limit, total, onPageChange }}
      mobileList={subscriptions.map((sub) => {
        const d = describe(sub);
        return (
          <div key={sub.id} className="space-y-1.5 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body font-medium text-primary">{d.orgName}</span>
              {mrr(sub)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge tone="brand" icon="none">{planLabel(sub.plan || 'trial', t)}</StatusBadge>
              <StatusBadge tone={d.badge.tone}>{d.badge.label}</StatusBadge>
              {sub.trialEndsAt && <span className="text-callout text-warning">{formatMessage(sb.trialEndsOn, { date: formatDate(sub.trialEndsAt) })}</span>}
            </div>
            {actions(sub)}
          </div>
        );
      })}
    >
      {subscriptions.map((sub) => {
        const d = describe(sub);
        return (
          <tr key={sub.id} className={`border-b border-border transition-colors hover:bg-surface-hover ${d.isPastDue ? 'bg-danger-bg/40' : ''}`}>
            <td className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`flex size-7 shrink-0 items-center justify-center rounded-md text-caption font-semibold text-white ${d.isCancelled ? 'bg-secondary' : getAvatarColor(d.orgName)}`} aria-hidden="true">
                  {getInitials(d.orgName)}
                </div>
                <span className="text-body font-medium text-primary">{d.orgName}</span>
              </div>
            </td>
            <td className="px-4 py-3"><StatusBadge tone="brand" icon="none">{planLabel(sub.plan || 'trial', t)}</StatusBadge></td>
            <td className="px-4 py-3"><StatusBadge tone={d.badge.tone}>{d.badge.label}</StatusBadge></td>
            <td className="px-4 py-3 text-right">{mrr(sub)}</td>
            <td className="px-4 py-3">
              <span className="text-callout text-secondary">
                {d.status === 'trialing' ? '\u2014' : sub.billingPeriod === 'annual' ? sb.annual : sb.monthly}
              </span>
            </td>
            <td className="px-4 py-3">
              <span className={`text-callout ${sub.trialEndsAt ? 'font-medium text-warning' : 'text-muted'}`}>
                {sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '\u2014'}
              </span>
            </td>
            <td className="px-4 py-3">{actions(sub)}</td>
          </tr>
        );
      })}
    </DataTable>
  );
}

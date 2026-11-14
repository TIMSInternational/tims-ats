'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import {
  getInitials,
  getAvatarColor,
  formatCurrency,
  formatRelativeTimeLocale,
} from '../../../../lib/format-utils';
import { CHOICE_INPUT_CLASSES, EmptyState, Skeleton, SortableHeader, StatusBadge } from '../../../../components';
import type { StatusTone } from '../../../../components';
import { planLabel } from './plan-label';

function SkeletonRow() {
  return (
    <tr className="border-b border-border" aria-hidden="true">
      <td className="px-3 py-3.5"><Skeleton className="size-4" /></td>
      <td className="px-4 py-3.5"><div className="flex items-center gap-3"><Skeleton className="size-8 rounded-lg" /><Skeleton className="h-4 w-32" /></div></td>
      <td className="px-4 py-3.5"><Skeleton className="h-5 w-16 rounded-full" /></td>
      <td className="px-4 py-3.5"><Skeleton className="ml-auto h-3 w-14" /></td>
      <td className="px-4 py-3.5"><Skeleton className="h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-3.5"><Skeleton className="mx-auto h-3 w-6" /></td>
      <td className="px-4 py-3.5"><Skeleton className="mx-auto h-4 w-8" /></td>
      <td className="px-4 py-3.5"><Skeleton className="h-3 w-20" /></td>
      <td className="px-4 py-3.5"><Skeleton className="mx-auto h-5 w-6" /></td>
    </tr>
  );
}
import { OrgActionsDropdown } from './org-actions-dropdown';

const PLAN_MRR: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };

type SortField = 'name' | 'plan' | 'createdAt' | 'users' | null;
type SortDir = 'asc' | 'desc';

interface OrgTableProps {
  organizations: OrganizationListItem[];
  isLoading: boolean;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  onEdit: (org: OrganizationListItem) => void;
  hasFilters: boolean;
  onClearFilters: () => void;
  onCreate: () => void;
}

type HealthLevel = 'critical' | 'at-risk' | 'healthy';

function computeHealth(org: OrganizationListItem): HealthLevel {
  if (!org.isActive) return 'critical';

  const pendingInvoices = (org as Record<string, unknown>).invoices as Array<{ id: string; dueDate: string | null }> | undefined;
  if (pendingInvoices && pendingInvoices.length > 0) {
    const now = Date.now();
    const hasOverdue = pendingInvoices.some((inv) => inv.dueDate && new Date(inv.dueDate).getTime() < now);
    if (hasOverdue) return 'critical';
  }

  if (pendingInvoices && pendingInvoices.length > 0) return 'at-risk';

  const users = (org as Record<string, unknown>).users as Array<{ lastLoginAt: string | null }> | undefined;
  const lastLogin = users?.[0]?.lastLoginAt;
  if (lastLogin) {
    const daysSince = (Date.now() - new Date(lastLogin).getTime()) / 86400000;
    if (daysSince >= 14) return 'at-risk';
  } else {
    const orgAge = (Date.now() - new Date(org.createdAt).getTime()) / 86400000;
    if (orgAge > 7) return 'at-risk';
  }

  const sub = org.subscription;
  if (sub?.trialEndsAt) {
    const daysUntilExpiry = (new Date(sub.trialEndsAt).getTime() - Date.now()) / 86400000;
    if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) return 'at-risk';
  }

  return 'healthy';
}

const HEALTH_TONE: Record<HealthLevel, StatusTone> = { critical: 'danger', 'at-risk': 'warning', healthy: 'success' };

const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';

export function OrgTable({
  organizations, isLoading, selectedIds, onSelectIds,
  sortBy, sortDir, onSort, onEdit, hasFilters, onClearFilters, onCreate,
}: OrgTableProps) {
  const { t, locale } = useI18n();
  const o = t.organizations;
  const healthLabel: Record<HealthLevel, string> = { critical: o.critical, 'at-risk': o.atRisk, healthy: o.healthy };
  const dir = (field: SortField) => (sortBy === field ? sortDir : null);
  const router = useRouter();

  const allSelected = organizations.length > 0 && organizations.every((o) => selectedIds.includes(o.id));
  const someSelected = organizations.some((o) => selectedIds.includes(o.id)) && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      onSelectIds([]);
    } else {
      onSelectIds(organizations.map((o) => o.id));
    }
  };

  const toggleOne = (id: string) => {
    if (selectedIds.includes(id)) {
      onSelectIds(selectedIds.filter((x) => x !== id));
    } else {
      onSelectIds([...selectedIds, id]);
    }
  };

  if (!isLoading && organizations.length === 0) {
    return hasFilters ? (
      <EmptyState
        title={o.noOrgsMatch}
        description={o.noOrgsMatchDesc}
        secondaryAction={{ label: t.common.clearFilters, onClick: onClearFilters }}
      />
    ) : (
      <EmptyState title={o.noOrgs} description={o.noOrgsDesc} action={{ label: o.createOrg, onClick: onCreate }} />
    );
  }

  return (
    <>
      {/* Phones: a stacked list (foundation-spec.md §7); the table from md. */}
      <ul className="divide-y divide-border md:hidden" aria-busy={isLoading || undefined}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 w-40" />
              </li>
            ))
          : organizations.map((org) => {
              const plan = org.plan || org.subscription?.plan || 'trial';
              const health = computeHealth(org);
              return (
                <li key={org.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-caption font-semibold text-white ${getAvatarColor(org.name)}`} aria-hidden="true">
                    {getInitials(org.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={`/platform/organizations/${org.id}`} className="block truncate text-body font-medium text-primary hover:text-brand">
                      {org.name}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="brand" icon="none">{planLabel(plan, t)}</StatusBadge>
                      <StatusBadge tone={HEALTH_TONE[health]}>{healthLabel[health]}</StatusBadge>
                    </div>
                  </div>
                  <OrgActionsDropdown org={org} onEdit={onEdit} />
                </li>
              );
            })}
      </ul>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[720px]" aria-busy={isLoading || undefined}>
      <caption className="sr-only">{o.title}</caption>
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-border">
          <th scope="col" className="w-10 px-3 py-2.5">
            <input
              type="checkbox"
              aria-label={o.selectAll}
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className={CHOICE_INPUT_CLASSES}
            />
          </th>
          <SortableHeader label={t.common.name} direction={dir('name')} onSort={() => onSort('name')} />
          <SortableHeader label={o.plan} direction={dir('plan')} onSort={() => onSort('plan')} />
          <th scope="col" className={`${TH} text-right`}>{o.mrr}</th>
          <th scope="col" className={`${TH} text-left`}>{o.health}</th>
          <SortableHeader label={t.users.title} direction={dir('users')} onSort={() => onSort('users')} align="center" />
          <th scope="col" className={`${TH} text-left`}>{o.invoices}</th>
          <SortableHeader label={o.lastActive} direction={dir('createdAt')} onSort={() => onSort('createdAt')} />
          <th scope="col" className={`${TH} w-12 text-center`}><span className="sr-only">{t.common.actions}</span></th>
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
          <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
        ) : (
          organizations.map((org) => {
            const isSuspended = !org.isActive;
            const plan = org.plan || org.subscription?.plan || 'trial';
            const mrr = PLAN_MRR[plan] || 0;
            const health = computeHealth(org);
            const users = (org as Record<string, unknown>).users as Array<{ lastLoginAt: string | null }> | undefined;
            const lastLogin = users?.[0]?.lastLoginAt ?? null;
            const pendingInvoices = (org as Record<string, unknown>).invoices as Array<{ id: string }> | undefined;
            const pendingCount = pendingInvoices?.length ?? 0;
            const invoiceTotal = (org._count as Record<string, number>)?.invoices ?? 0;
            const isSelected = selectedIds.includes(org.id);

            return (
              <tr
                key={org.id}
                onClick={() => router.push(`/platform/organizations/${org.id}`)}
                className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-hover ${
                  isSelected ? 'bg-brand-tint' : isSuspended ? 'bg-danger-bg/40' : ''
                }`}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={formatMessage(o.selectOrg, { name: org.name })}
                    checked={isSelected}
                    onChange={() => toggleOne(org.id)}
                    className={CHOICE_INPUT_CLASSES}
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-caption font-semibold text-white ${getAvatarColor(org.name)}`} aria-hidden="true">
                      {getInitials(org.name)}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/platform/organizations/${org.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-body font-medium text-primary hover:text-brand hover:underline"
                      >
                        {org.name}
                      </Link>
                      <p className="font-mono text-caption text-muted">{org.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3"><StatusBadge tone="brand" icon="none">{planLabel(plan, t)}</StatusBadge></td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-body font-semibold tabular-nums ${mrr > 0 ? 'text-primary' : 'text-muted'}`}>
                    {formatCurrency(mrr, 'USD', 0)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge tone={HEALTH_TONE[health]}>{healthLabel[health]}</StatusBadge>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-body font-medium tabular-nums text-primary">{org._count?.users ?? 0}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-body font-medium tabular-nums text-primary">{invoiceTotal}</span>
                    {pendingCount > 0 && (
                      <StatusBadge tone="warning" icon="none">
                        {formatMessage(o.pendingInvoicesCount, { count: pendingCount })}
                      </StatusBadge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {lastLogin ? (
                    <span className="text-callout text-secondary">{formatRelativeTimeLocale(lastLogin, locale)}</span>
                  ) : (
                    <span className="text-callout text-muted">{o.never}</span>
                  )}
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-center">
                    <OrgActionsDropdown org={org} onEdit={onEdit} />
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table></div>
    </>
  );
}

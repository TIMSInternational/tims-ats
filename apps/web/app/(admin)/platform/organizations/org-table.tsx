'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '../../../../lib/i18n';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { getInitials, getAvatarColor, formatRelativeTime } from '../../../../lib/format-utils';

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

function SkeletonRow() {
  return (
    <tr className="border-b border-[#F6F6F6] animate-pulse">
      <td className="px-3 py-3.5"><div className="w-4 h-4 bg-gray-200 rounded" /></td>
      <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gray-200" /><div className="h-4 w-32 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-3.5"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-14 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-6 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5 text-center"><div className="h-4 w-6 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5 text-center"><div className="h-4 w-8 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-6 bg-gray-100 rounded mx-auto" /></td>
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

function HealthDot({ level, t }: { level: HealthLevel; t: Record<string, string> }) {
  const config = {
    critical: { color: 'bg-[#DD0C15]', label: t.critical },
    'at-risk': { color: 'bg-amber-400', label: t.atRisk },
    healthy: { color: 'bg-green-400', label: t.healthy },
  };
  const c = config[level];
  return (
    <div className="flex items-center gap-1.5" title={c.label}>
      <div className={`w-2 h-2 rounded-full ${c.color}`} />
    </div>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[#CDCDCD] ml-0.5">&#8597;</span>;
  return <span className="text-[#1F114C] ml-0.5">{dir === 'asc' ? '\u2191' : '\u2193'}</span>;
}

function SortableHeader({
  label, field, sortBy, sortDir, onSort, className,
}: {
  label: string;
  field: SortField;
  sortBy: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  className?: string;
}) {
  return (
    <th
      onClick={() => onSort(field)}
      className={`text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3 cursor-pointer select-none hover:text-[#585858] transition ${className || 'text-left'}`}
    >
      {label}
      <SortArrow active={sortBy === field} dir={sortDir} />
    </th>
  );
}

export function OrgTable({
  organizations, isLoading, selectedIds, onSelectIds,
  sortBy, sortDir, onSort, onEdit,
}: OrgTableProps) {
  const { t } = useI18n();
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

  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
      <thead className="sticky top-0 bg-white z-10">
        <tr className="border-b border-[#EDEDED]">
          <th className="px-3 py-3 w-10">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected; }}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-[#CDCDCD] text-[#1F114C] focus:ring-[#1F114C] cursor-pointer"
            />
          </th>
          <SortableHeader label={t.common.name} field="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-left px-5" />
          <SortableHeader label="Plan" field="plan" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <th className="text-right text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">MRR</th>
          <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">{t.organizations.health}</th>
          <SortableHeader label={t.users.title} field="users" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-center" />
          <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">{t.organizations.invoices}</th>
          <SortableHeader label={t.organizations.lastActive} field="createdAt" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3 w-12">{t.common.actions}</th>
        </tr>
      </thead>
      <tbody>
        {isLoading ? (
          <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
        ) : organizations.length === 0 ? (
          <tr>
            <td colSpan={9} className="px-5 py-16 text-center">
              <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" />
              </svg>
              <p className="text-sm text-[#8B8B8B]">{t.organizations.noOrgs}</p>
              <p className="text-xs text-[#8B8B8B] mt-1">{t.organizations.noOrgsDesc}</p>
            </td>
          </tr>
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
                className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition cursor-pointer ${
                  isSuspended ? 'bg-red-50/30' : ''
                } ${isSelected ? 'bg-[#1F114C]/5' : ''}`}
              >
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(org.id)}
                    className="w-4 h-4 rounded border-[#CDCDCD] text-[#1F114C] focus:ring-[#1F114C] cursor-pointer"
                  />
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${getAvatarColor(org.name)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                      {getInitials(org.name)}
                    </div>
                    <div>
                      <span className="text-sm text-[#333] font-medium">{org.name}</span>
                      <p className="text-[10px] text-[#8B8B8B] font-mono">{org.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">{planBadge(plan)}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-sm font-semibold ${mrr > 0 ? 'text-[#333]' : 'text-[#8B8B8B]'}`}>
                    ${mrr.toLocaleString()}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-center">
                    <HealthDot level={health} t={t.organizations} />
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm text-[#333] font-medium">{org._count?.users ?? 0}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className="text-sm text-[#333] font-medium">{invoiceTotal}</span>
                    {pendingCount > 0 && (
                      <span className="text-[9px] font-bold bg-[#DD0C15] text-white rounded-full px-1.5 py-0.5 leading-none">
                        {pendingCount}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {lastLogin ? (
                    <span className="text-xs text-[#585858]">{formatRelativeTime(lastLogin)}</span>
                  ) : (
                    <span className="text-xs text-[#CDCDCD]">{t.organizations.never}</span>
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
  );
}

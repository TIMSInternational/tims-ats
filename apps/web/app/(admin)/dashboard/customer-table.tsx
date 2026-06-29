'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import {
  formatCurrency,
  timeAgo,
  PLAN_BG_CLASSES,
  PLAN_LABELS,
  HEALTH_CONFIG,
  Skeleton,
} from './dashboard-utils';

type SortKey = 'orgName' | 'plan' | 'mrr' | 'userCount' | 'lastActiveAt';
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'orgName', label: 'Organization', className: 'w-[28%]' },
  { key: 'plan', label: 'Plan', className: 'w-[14%]' },
  { key: 'mrr', label: 'MRR', className: 'w-[14%]' },
  { key: 'userCount', label: 'Users', className: 'w-[10%]' },
  { key: 'lastActiveAt', label: 'Last Active', className: 'w-[16%]' },
];

export function CustomerTable() {
  const { t } = useI18n();
  const router = useRouter();
  const { data, isLoading } = trpc.platform.getRevenueByCustomer.useQuery();
  const { data: healthData } = trpc.platform.getCustomerHealth.useQuery();
  const [sortKey, setSortKey] = useState<SortKey>('mrr');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const healthMap = useMemo(() => {
    const map = new Map<string, string>();
    healthData?.forEach((h) => map.set(h.orgId, h.health));
    return map;
  }, [healthData]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'orgName':
          cmp = a.orgName.localeCompare(b.orgName);
          break;
        case 'plan': {
          const order: Record<string, number> = { enterprise: 0, professional: 1, starter: 2, trial: 3 };
          cmp = (order[a.plan] ?? 4) - (order[b.plan] ?? 4);
          break;
        }
        case 'mrr':
          cmp = a.mrr - b.mrr;
          break;
        case 'userCount':
          cmp = a.userCount - b.userCount;
          break;
        case 'lastActiveAt': {
          const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          cmp = aTime - bTime;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  }

  return (
    <div className="rounded-xl border border-border bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="text-sm font-semibold text-primary">Customers</h3>
        <p className="text-xs text-muted">{t.dashboard.clickRowToView}</p>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-surface/50">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-5 py-2.5 text-xs font-medium text-muted uppercase tracking-wide cursor-pointer hover:text-primary select-none ${col.className}`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}{sortIndicator(col.key)}
                  </th>
                ))}
                <th className="px-5 py-2.5 text-xs font-medium text-muted uppercase tracking-wide w-[10%]">
                  Health
                </th>
                <th className="px-5 py-2.5 text-xs font-medium text-muted uppercase tracking-wide w-[8%]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((org) => {
                const health = healthMap.get(org.orgId) ?? 'healthy';
                const hCfg = HEALTH_CONFIG[health];
                const planClass = PLAN_BG_CLASSES[org.plan] ?? 'bg-gray-100 text-gray-700';

                return (
                  <tr
                    key={org.orgId}
                    onClick={() => router.push(`/platform/organizations/${org.orgId}`)}
                    className="border-b border-border last:border-b-0 hover:bg-surface/50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-brand/10 flex items-center justify-center text-xs font-bold text-brand shrink-0">
                          {org.orgName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-primary truncate">{org.orgName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded ${planClass}`}>
                        {PLAN_LABELS[org.plan] ?? org.plan}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm font-medium text-primary">
                      {formatCurrency(org.mrr)}
                    </td>
                    <td className="px-5 py-3 text-sm text-secondary">{org.userCount}</td>
                    <td className="px-5 py-3 text-xs text-muted">{timeAgo(org.lastActiveAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${hCfg.dot}`} />
                        <span className="text-xs text-secondary capitalize">{hCfg.label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-medium text-brand hover:underline">View</span>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted">
                    No customers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

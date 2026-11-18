'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useDashboardRevenueByCustomer, useDashboardCustomerHealth } from '../../../lib/platform-api/dashboard';
import { useI18n } from '../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../lib/format-utils';
import {
  formatCurrency,
  PLAN_BG_CLASSES,
  PLAN_CHIP_FALLBACK,
  PLAN_LABELS,
  HEALTH_CONFIG,
  Skeleton,
} from './dashboard-utils';
import { ErrorState } from '../../../components';
import { SortableHeader } from '../../../components/sortable-header';
import { StatusBadge } from '../../../components/status-badge';

type SortKey = 'orgName' | 'plan' | 'mrr' | 'userCount' | 'lastActiveAt';
type SortDir = 'asc' | 'desc';

export function CustomerTable() {
  const { t, locale } = useI18n();
  const d = t.dashboard;
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useDashboardRevenueByCustomer();
  const { data: healthData, isError: healthError, refetch: refetchHealth } = useDashboardCustomerHealth();
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

  const columns: { key: SortKey; label: string; align: 'left' | 'right'; className: string }[] = [
    { key: 'orgName', label: d.orgName, align: 'left', className: 'w-[30%]' },
    { key: 'plan', label: d.plan, align: 'left', className: 'w-[14%]' },
    { key: 'mrr', label: d.mrr, align: 'right', className: 'w-[14%]' },
    { key: 'userCount', label: d.colUsers, align: 'right', className: 'w-[12%]' },
    { key: 'lastActiveAt', label: d.colLastActive, align: 'left', className: 'w-[16%]' },
  ];
  const orgHref = (orgId: string) => `/platform/organizations/${orgId}`;
  const lastActive = (date: Date | string | null) => formatRelativeTimeLocale(date, locale, d.never);
  const healthOf = (orgId: string) => HEALTH_CONFIG[healthMap.get(orgId) ?? 'healthy'] ?? HEALTH_CONFIG.healthy;

  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {d.customersTitle}
        </h2>
        <p className="text-callout text-secondary">{d.customersHint}</p>
      </div>

      {isLoading ? (
        <div className="space-y-3 p-5" aria-busy="true">
          <span className="sr-only">{t.common.loadingContent}</span>
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError || healthError ? (
        <ErrorState
          size="compact"
          onRetry={() => {
            refetch();
            refetchHealth();
          }}
        />
      ) : sorted.length === 0 ? (
        <p className="px-5 py-10 text-center text-body text-secondary">{d.noCustomers}</p>
      ) : (
        <>
          {/* Phones: a stacked list, one link per organisation. */}
          <ul className="divide-y divide-border md:hidden">
            {sorted.map((org) => {
              const hCfg = healthOf(org.orgId);
              return (
                <li key={org.orgId}>
                  <Link href={orgHref(org.orgId)} className="block px-5 py-3 transition-colors hover:bg-surface-hover">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-body font-medium text-primary">{org.orgName}</span>
                      <span className="shrink-0 text-body font-medium tabular-nums text-primary">
                        {formatCurrency(org.mrr, locale)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-2 py-0.5 text-caption font-medium ${PLAN_BG_CLASSES[org.plan] ?? PLAN_CHIP_FALLBACK}`}
                      >
                        {PLAN_LABELS[org.plan] ?? org.plan}
                      </span>
                      <StatusBadge tone={hCfg.tone}>{d[hCfg.labelKey]}</StatusBadge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <caption className="sr-only">{d.customersTitle}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-hover">
                  {columns.map((col) => (
                    <SortableHeader
                      key={col.key}
                      label={col.label}
                      align={col.align}
                      direction={sortKey === col.key ? sortDir : null}
                      onSort={() => handleSort(col.key)}
                      className={`px-5 ${col.className}`}
                    />
                  ))}
                  <th scope="col" className="w-[14%] px-5 py-2.5 text-callout font-semibold text-secondary">
                    {d.healthScore}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((org) => {
                  const hCfg = healthOf(org.orgId);
                  return (
                    <tr
                      key={org.orgId}
                      className="border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-callout font-bold text-brand"
                            aria-hidden="true"
                          >
                            {org.orgName.charAt(0).toUpperCase()}
                          </div>
                          <Link
                            href={orgHref(org.orgId)}
                            className="truncate text-body font-medium text-primary hover:text-brand hover:underline"
                          >
                            {org.orgName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-caption font-medium ${PLAN_BG_CLASSES[org.plan] ?? PLAN_CHIP_FALLBACK}`}
                        >
                          {PLAN_LABELS[org.plan] ?? org.plan}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-body font-medium tabular-nums text-primary">
                        {formatCurrency(org.mrr, locale)}
                      </td>
                      <td className="px-5 py-3 text-right text-body tabular-nums text-secondary">{org.userCount}</td>
                      <td className="px-5 py-3 text-callout text-secondary">{lastActive(org.lastActiveAt)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge tone={hCfg.tone}>{d[hCfg.labelKey]}</StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

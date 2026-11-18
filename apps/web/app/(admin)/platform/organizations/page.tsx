'use client';

import { useState } from 'react';
import { csvRow } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { CreateOrgModal } from './create-org-modal';
import { EditOrgModal } from './edit-org-modal';
import { OrgTable } from './org-table';
import { OrgBulkBar } from './org-bulk-bar';
import {
  Button,
  ErrorState,
  KpiCard,
  KpiCardSkeleton,
  PageHeader,
  Pagination,
  inputClasses,
  selectClasses,
} from '../../../../components';
import { PLAN_KEYS, planLabel } from './plan-label';

const PLAN_MRR: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };

type SortField = 'name' | 'plan' | 'createdAt' | 'users' | null;
type SortDir = 'asc' | 'desc';

export default function OrganizationsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editOrg, setEditOrg] = useState<OrganizationListItem | null>(null);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const limit = 15;

  const kpis = trpc.platform.getOrganizationKpis.useQuery();
  const orgs = trpc.platform.listOrganizations.useQuery({
    search: search || undefined,
    plan: planFilter || undefined,
    status: statusFilter || undefined,
    page, limit,
    sortBy: sortBy ?? undefined,
    sortDir: sortBy ? sortDir : undefined,
  });

  const utils = trpc.useUtils();
  const organizations = orgs.data?.organizations ?? [];
  const total = orgs.data?.total ?? 0;

  const clearFilters = () => { setSearch(''); setPlanFilter(''); setStatusFilter(''); setPage(0); };

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'name' || field === 'plan' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const handleExport = () => {
    // Every cell through csvRow (packages/shared/src/csv.ts) — the same helper the server-side platform
    // exports use. This builder previously wrapped `org.name` in quotes WITHOUT escaping embedded ones, so
    // an organization named `Acme "The" Corp` broke the row outright, and no field had formula-injection
    // defence (CWE-1236). Client-side construction is why this one was missed when the server exports were
    // audited. Tracked as GHSA-w6h5-g5gv-7g95.
    const header = csvRow(['Nombre', 'Slug', 'Plan', 'Estado', 'Usuarios', 'Facturas', 'Creada', 'MRR']);
    const rows = organizations.map((org) => {
      const plan = org.plan || org.subscription?.plan || 'trial';
      return csvRow([
        org.name, org.slug, plan,
        org.isActive ? 'active' : 'suspended',
        org._count?.users ?? 0,
        (org._count as Record<string, number>)?.invoices ?? 0,
        new Date(org.createdAt).toISOString().slice(0, 10),
        PLAN_MRR[plan] || 0,
      ]);
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `organizaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(formatMessage(t.organizations.rowsExported, { count: rows.length }), { type: 'success' });
  };

  const o = t.organizations;
  const hasFilters = Boolean(search || planFilter || statusFilter);
  const icon = (d: string) => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        title={o.title}
        actions={
          <Button onClick={() => setShowCreateModal(true)} icon={icon('M12 5v14M5 12h14')}>
            {o.newOrg}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-6">
        {/* KPIs */}
        <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:mb-6 md:grid-cols-4 md:gap-4">
          {kpis.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : kpis.isError ? (
            <div className="col-span-2 rounded-xl bg-white shadow-card md:col-span-4">
              <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} size="compact" />
            </div>
          ) : kpis.data ? (
            <>
              <KpiCard label={o.kpiTotal} value={kpis.data.total} icon={icon('M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4')} />
              <KpiCard
                label={o.kpiActive}
                value={kpis.data.active}
                subtitle={formatMessage(o.kpiActiveShare, {
                  pct: kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0,
                })}
                icon={icon('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}
              />
              <KpiCard
                label={o.kpiSuspended}
                value={kpis.data.suspended}
                tone="danger"
                highlight={kpis.data.suspended > 0}
                subtitle={kpis.data.suspended > 0 ? t.common.requiresAttention : t.common.noIssues}
                icon={icon('M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636')}
              />
              <KpiCard
                label={o.kpiTrialing}
                value={kpis.data.trialing}
                subtitle={formatMessage(o.expiringThisWeek, { count: kpis.data.expiringThisWeek })}
                icon={icon('M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z')}
              />
            </>
          ) : null}
        </div>

        {/* Filters */}
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-card md:gap-3 md:p-4">
          <div className="relative w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1">
            <input
              type="search"
              aria-label={o.searchOrgLabel}
              placeholder={o.searchOrg}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className={inputClasses('md', 'pl-9')}
            />
            <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          </div>
          <select
            aria-label={o.filterPlan}
            value={planFilter}
            onChange={(e) => { setPlanFilter(e.target.value); setPage(0); }}
            className={selectClasses('md', 'w-full sm:w-auto')}
          >
            <option value="">{o.allPlans}</option>
            {PLAN_KEYS.map((p) => <option key={p} value={p}>{planLabel(p, t)}</option>)}
          </select>
          <select
            aria-label={o.filterStatus}
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className={selectClasses('md', 'w-full sm:w-auto')}
          >
            <option value="">{o.allStatuses}</option>
            <option value="active">{o.statusActive}</option>
            <option value="suspended">{o.statusSuspended}</option>
          </select>
          {hasFilters && (
            <Button variant="tertiary" onClick={clearFilters}>{t.common.clearFilters}</Button>
          )}
          <div className="hidden flex-1 sm:block" />
          <Button variant="secondary" onClick={handleExport} icon={icon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}>
            {o.exportCsv}
          </Button>
        </div>

        {/* Bulk bar */}
        {selectedIds.length > 0 && (
          <OrgBulkBar
            selectedIds={selectedIds}
            organizations={organizations}
            onDeselectAll={() => setSelectedIds([])}
          />
        )}

        {/* Table */}
        <div className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card lg:min-h-0">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {orgs.isError ? (
              <ErrorState onRetry={() => orgs.refetch()} error={orgs.error} />
            ) : (
              <OrgTable
                organizations={organizations}
                isLoading={orgs.isLoading}
                selectedIds={selectedIds}
                onSelectIds={setSelectedIds}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={handleSort}
                onEdit={setEditOrg}
                hasFilters={hasFilters}
                onClearFilters={clearFilters}
                onCreate={() => setShowCreateModal(true)}
              />
            )}
          </div>
          <Pagination page={page} limit={limit} total={total} onPageChange={setPage} className="shrink-0" />
        </div>
      </div>

      {showCreateModal && <CreateOrgModal onClose={() => setShowCreateModal(false)} onSuccess={() => { setShowCreateModal(false); utils.platform.listOrganizations.invalidate(); utils.platform.getOrganizationKpis.invalidate(); }} />}
      {editOrg && <EditOrgModal org={editOrg} onClose={() => setEditOrg(null)} onSuccess={() => setEditOrg(null)} />}
    </div>
  );
}

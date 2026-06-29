'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { CreateOrgModal } from './create-org-modal';
import { EditOrgModal } from './edit-org-modal';
import { OrgTable } from './org-table';
import { OrgBulkBar } from './org-bulk-bar';
import { Skeleton } from '../../../../components';

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
    const header = 'Nombre,Slug,Plan,Estado,Usuarios,Facturas,Creada,MRR';
    const rows = organizations.map((org) => {
      const plan = org.plan || org.subscription?.plan || 'trial';
      return [
        `"${org.name}"`, org.slug, plan,
        org.isActive ? 'active' : 'suspended',
        org._count?.users ?? 0,
        (org._count as Record<string, number>)?.invoices ?? 0,
        new Date(org.createdAt).toISOString().slice(0, 10),
        PLAN_MRR[plan] || 0,
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `organizaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast(t.organizations.csvExported, { type: 'success' });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 flex-shrink-0">
        {kpis.isLoading ? Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
            <Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-12 mb-2" /><Skeleton className="h-3 w-20" />
          </div>
        )) : kpis.data ? <>
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiTotal}</span>
              <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center"><svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg></div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-[#333]">{kpis.data.total}</div>
            <div className="text-xs text-[#8B8B8B] mt-1">{kpis.data.active} {t.organizations.kpiActive.toLowerCase()}</div>
          </div>
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiActive}</span>
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg></div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-[#333]">{kpis.data.active}</div>
            <div className="text-xs text-[#8B8B8B] mt-1">{kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0}% del total</div>
          </div>
          <div className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${kpis.data.suspended > 0 ? 'border border-red-200' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiSuspended}</span>
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"><svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg></div>
            </div>
            <div className={`text-xl md:text-2xl font-bold ${kpis.data.suspended > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{kpis.data.suspended}</div>
            <div className={`text-xs mt-1 ${kpis.data.suspended > 0 ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>{kpis.data.suspended > 0 ? t.common.requiresAttention : t.common.noIssues}</div>
          </div>
          <div className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${kpis.data.expiringThisWeek > 0 ? 'border border-amber-200' : ''}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiTrialing}</span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg></div>
            </div>
            <div className="text-xl md:text-2xl font-bold text-[#333]">{kpis.data.trialing}</div>
            <div className={`text-xs mt-1 font-medium ${kpis.data.expiringThisWeek > 0 ? 'text-amber-600' : 'text-[#8B8B8B]'}`}>{kpis.data.expiringThisWeek} vencen esta semana</div>
          </div>
        </> : null}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 mb-4 flex items-center gap-3 flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <input type="text" placeholder={t.organizations.searchOrg} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="w-full h-9 pl-9 pr-4 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]" />
          <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </div>
        <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(0); }} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]">
          <option value="">{t.organizations.filterAll} Plans</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]">
          <option value="">{t.organizations.filterAll}</option>
          <option value="active">{t.organizations.statusActive}</option>
          <option value="suspended">{t.organizations.statusSuspended}</option>
        </select>
        {(search || planFilter || statusFilter) && (
          <button onClick={clearFilters} className="h-9 px-3 rounded-lg text-sm text-[#8B8B8B] hover:text-[#585858] transition font-medium">{t.common.close} filtros</button>
        )}
        <div className="flex-1" />
        <button onClick={handleExport} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          CSV
        </button>
        <button onClick={() => setShowCreateModal(true)} className="h-9 px-4 rounded-lg bg-[#1F114C] text-sm text-white font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {t.organizations.newOrg}
        </button>
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
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          <OrgTable
            organizations={organizations}
            isLoading={orgs.isLoading}
            selectedIds={selectedIds}
            onSelectIds={setSelectedIds}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
            onEdit={setEditOrg}
          />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#EDEDED] flex-shrink-0">
          <span className="text-xs text-[#8B8B8B]">{t.common.showing} {organizations.length > 0 ? page * limit + 1 : 0}-{page * limit + organizations.length} {t.common.of} {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg></button>
            {Array.from({ length: Math.min(Math.ceil(total / limit), 5) }).map((_, i) => (
              <button key={i} onClick={() => setPage(i)} className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{i + 1}</button>
            ))}
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>
          </div>
        </div>
      </div>

      {showCreateModal && <CreateOrgModal onClose={() => setShowCreateModal(false)} onSuccess={() => { setShowCreateModal(false); utils.platform.listOrganizations.invalidate(); utils.platform.getOrganizationKpis.invalidate(); }} />}
      {editOrg && <EditOrgModal org={editOrg} onClose={() => setEditOrg(null)} onSuccess={() => setEditOrg(null)} />}
    </div>
  );
}

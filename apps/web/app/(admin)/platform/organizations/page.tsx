'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { CreateOrgModal } from './create-org-modal';
import { EditOrgModal } from './edit-org-modal';

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

const avatarColors = [
  'bg-[#1F114C]', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-600',
  'bg-indigo-500', 'bg-orange-500', 'bg-pink-500',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

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

function statusDot(status: string, isActive?: boolean, labels?: { active: string; suspended: string }) {
  const l = labels || { active: 'Activa', suspended: 'Suspendida' };
  const isSuspended = !isActive || status?.toLowerCase() === 'suspended';
  const dotColor = isSuspended ? 'bg-[#DD0C15]' : 'bg-green-400';
  const textColor = isSuspended ? 'text-[#DD0C15] font-medium' : 'text-[#585858]';
  const label = isSuspended ? l.suspended : l.active;
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className={`text-xs ${textColor}`}>{label}</span>
    </div>
  );
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function trialDateColor(trialEndsAt: string | Date | null | undefined): string {
  if (!trialEndsAt) return 'text-[#8B8B8B]';
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 3) return 'text-[#DD0C15] font-medium';
  if (daysLeft <= 7) return 'text-amber-600 font-medium';
  return 'text-amber-600 font-medium';
}

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

function SkeletonRow() {
  return (
    <tr className="border-b border-[#F6F6F6] animate-pulse">
      <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-gray-200" /><div className="h-4 w-32 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-3.5"><div className="h-3 w-24 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-14 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5 text-center"><div className="h-4 w-6 bg-gray-100 rounded mx-auto" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3.5"><div className="h-5 w-20 bg-gray-100 rounded mx-auto" /></td>
    </tr>
  );
}

export default function OrganizationsPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editOrg, setEditOrg] = useState<OrganizationListItem | null>(null);
  const [page, setPage] = useState(0);
  const limit = 10;

  const kpis = trpc.platform.getOrganizationKpis.useQuery();

  const orgs = trpc.platform.listOrganizations.useQuery({
    search: search || undefined,
    plan: planFilter || undefined,
    status: statusFilter || undefined,
    page,
    limit,
  });

  const utils = trpc.useUtils();
  const organizations = orgs.data?.organizations ?? [];
  const total = orgs.data?.total ?? 0;

  const clearFilters = () => {
    setSearch('');
    setPlanFilter('');
    setStatusFilter('');
    setPage(0);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-7 w-12 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : kpis.data ? (
          <>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiTotal}</span>
                <div className="w-8 h-8 rounded-lg bg-[#1F114C]/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.total}</div>
              <div className="text-xs text-green-500 mt-1 font-medium">+3 este mes</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiActive}</span>
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.active}</div>
              <div className="text-xs text-[#8B8B8B] mt-1">{kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0}% del total</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiSuspended}</span>
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#DD0C15]">{kpis.data.suspended}</div>
              <div className="text-xs text-[#8B8B8B] mt-1">Pago pendiente</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.organizations.kpiTrialing}</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.trialing}</div>
              <div className="text-xs text-amber-500 mt-1 font-medium">{kpis.data.expiringThisWeek} vencen esta semana</div>
            </div>
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 mb-4 flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <input type="text" placeholder={t.organizations.searchOrg} value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="w-full h-9 pl-9 pr-4 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]" />
          <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </div>
        <select value={planFilter} onChange={(e) => { setPlanFilter(e.target.value); setPage(0); }} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]">
          <option value="">Todos los Planes</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]">
          <option value="">{t.organizations.filterAll}</option>
          <option value="active">{t.organizations.statusActive}</option>
          <option value="suspended">{t.organizations.statusSuspended}</option>
          <option value="cancelled">Cancelada</option>
        </select>
        <button onClick={clearFilters} className="h-9 px-3 rounded-lg text-sm text-[#8B8B8B] hover:text-[#585858] transition font-medium">Limpiar filtros</button>
        <div className="flex-1" />
        <button className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition">Exportar</button>
        <button onClick={() => setShowCreateModal(true)} className="h-9 px-4 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-[#c40b13] transition flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          {t.organizations.newOrg}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
        <table className="w-full">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-[#EDEDED]">
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-5 py-3.5">Organizacion</th>
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Slug</th>
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Plan</th>
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Estado</th>
              <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Usuarios</th>
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Creada</th>
              <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Trial Vence</th>
              <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3.5">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orgs.isLoading ? (
              <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center">
                  <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                  <p className="text-sm text-[#8B8B8B]">No se encontraron organizaciones</p>
                  <p className="text-xs text-[#8B8B8B] mt-1">Intente ajustar los filtros o crear una nueva organizacion</p>
                </td>
              </tr>
            ) : (
              organizations.map((org) => {
                const isSuspended = !org.isActive;
                const plan = org.plan || org.subscription?.plan || 'trial';
                const trialEndsAt = org.subscription?.trialEndsAt;
                return (
                  <tr key={org.id} className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${isSuspended ? 'bg-red-50/30' : ''}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg ${getAvatarColor(org.name)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>{getInitials(org.name)}</div>
                        <span className="text-sm text-[#333] font-medium">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5"><span className="text-xs text-[#8B8B8B] font-mono">{org.slug}</span></td>
                    <td className="px-4 py-3.5">{planBadge(plan)}</td>
                    <td className="px-4 py-3.5">{statusDot(org.subscription?.status ?? '', org.isActive, { active: t.organizations.statusActive, suspended: t.organizations.statusSuspended })}</td>
                    <td className="px-4 py-3.5 text-center"><span className="text-sm text-[#333] font-medium">{org._count?.users ?? 0}</span></td>
                    <td className="px-4 py-3.5"><span className="text-xs text-[#8B8B8B]">{formatDate(org.createdAt)}</span></td>
                    <td className="px-4 py-3.5"><span className={`text-xs ${trialEndsAt ? trialDateColor(trialEndsAt) : 'text-[#8B8B8B]'}`}>{trialEndsAt ? formatDate(trialEndsAt) : '\u2014'}</span></td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <a href={`/platform/organizations/${org.id}`} className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition" title="Ver">
                          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        </a>
                        <button onClick={() => setEditOrg(org)} className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition" title="Editar">
                          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button>
                        <button className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition" title="Impersonar">
                          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#EDEDED] flex-shrink-0">
          <span className="text-xs text-[#8B8B8B]">{t.common.showing} {organizations.length > 0 ? page * limit + 1 : 0}-{page * limit + organizations.length} {t.common.of} {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
            </button>
            {Array.from({ length: Math.min(Math.ceil(total / limit), 5) }).map((_, i) => (
              <button key={i} onClick={() => setPage(i)} className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{i + 1}</button>
            ))}
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateOrgModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            utils.platform.listOrganizations.invalidate();
            utils.platform.getOrganizationKpis.invalidate();
          }}
        />
      )}

      {editOrg && (
        <EditOrgModal
          org={editOrg}
          onClose={() => setEditOrg(null)}
          onSuccess={() => setEditOrg(null)}
        />
      )}
    </div>
  );
}

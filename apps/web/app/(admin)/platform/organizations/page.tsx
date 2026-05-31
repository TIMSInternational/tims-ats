'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';

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
      {plan}
    </span>
  );
}

function statusDot(status: string) {
  const isActive = status?.toLowerCase() === 'active' || status?.toLowerCase() === 'activa';
  const isSuspended = status?.toLowerCase() === 'suspended' || status?.toLowerCase() === 'suspendida';
  const dotColor = isSuspended ? 'bg-[#DD0C15]' : isActive ? 'bg-green-400' : 'bg-gray-400';
  const textColor = isSuspended ? 'text-[#DD0C15] font-medium' : 'text-[#585858]';
  const label = isSuspended ? 'Suspendida' : isActive ? 'Activa' : status;
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
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 10;

  // Form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPlan, setFormPlan] = useState('trial');
  const [formEmail, setFormEmail] = useState('');

  const orgs = trpc.platform.listOrganizations.useQuery({
    search: search || undefined,
    plan: planFilter || undefined,
    status: statusFilter || undefined,
    limit,
  });

  const utils = trpc.useUtils();

  const createOrg = trpc.platform.createOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      setShowModal(false);
      setFormName('');
      setFormSlug('');
      setFormPlan('trial');
      setFormEmail('');
    },
  });

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
    },
  });

  const organizations = orgs.data?.organizations ?? [];
  const total = orgs.data?.total ?? 0;

  const clearFilters = () => {
    setSearch('');
    setPlanFilter('');
    setStatusFilter('');
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createOrg.mutate({
      name: formName,
      slug: formSlug,
      plan: formPlan as 'trial' | 'starter' | 'professional' | 'enterprise',
      adminEmail: formEmail,
    });
  };

  return (
    <main className="flex-1 overflow-y-auto p-6">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 mb-4 flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Buscar organizacion..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
          />
          <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]"
        >
          <option value="">Todos los Planes</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:border-[#1F114C]"
        >
          <option value="">Todos los Estados</option>
          <option value="active">Activa</option>
          <option value="suspended">Suspendida</option>
          <option value="cancelled">Cancelada</option>
        </select>
        <button onClick={clearFilters} className="h-9 px-3 rounded-lg text-sm text-[#8B8B8B] hover:text-[#585858] transition font-medium">
          Limpiar filtros
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowModal(true)}
          className="h-9 px-4 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-[#c40b13] transition flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          Crear Organizacion
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <table className="w-full">
          <thead>
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
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : organizations.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center">
                  <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                  <p className="text-sm text-[#8B8B8B]">No se encontraron organizaciones</p>
                  <p className="text-xs text-[#8B8B8B] mt-1">Intente ajustar los filtros o crear una nueva organizacion</p>
                </td>
              </tr>
            ) : (
              organizations.map((org: any) => {
                const isSuspended = org.status?.toLowerCase() === 'suspended' || org.status?.toLowerCase() === 'suspendida';
                return (
                  <tr
                    key={org.id}
                    className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${isSuspended ? 'bg-red-50/30' : ''}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg ${getAvatarColor(org.name)} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0`}>
                          {getInitials(org.name)}
                        </div>
                        <span className="text-sm text-[#333] font-medium">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-[#8B8B8B] font-mono">{org.slug}</span>
                    </td>
                    <td className="px-4 py-3.5">{planBadge(org.plan || org.subscription?.plan || 'Trial')}</td>
                    <td className="px-4 py-3.5">{statusDot(org.status || 'active')}</td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-sm text-[#333] font-medium">{org.users?.length ?? org.userCount ?? 0}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-[#8B8B8B]">{formatDate(org.createdAt)}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs ${org.trialEndsAt ? 'text-amber-600 font-medium' : 'text-[#8B8B8B]'}`}>
                        {org.trialEndsAt ? formatDate(org.trialEndsAt) : '\u2014'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-center gap-1">
                        <a
                          href={`/platform/organizations/${org.id}`}
                          className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition"
                          title="Ver"
                        >
                          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                        </a>
                        <button
                          onClick={() => {
                            if (!isSuspended && confirm(`Suspender ${org.name}?`)) {
                              suspendOrg.mutate({ id: org.id, suspend: true });
                            }
                          }}
                          disabled={isSuspended || suspendOrg.isPending}
                          className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition disabled:opacity-40"
                          title={isSuspended ? 'Ya suspendida' : 'Suspender'}
                        >
                          <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#EDEDED]">
          <span className="text-xs text-[#8B8B8B]">
            Mostrando {organizations.length > 0 ? 1 : 0}-{organizations.length} de {total} organizaciones
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
            </button>
            <button className="w-8 h-8 rounded-lg bg-[#1F114C] text-white text-xs font-medium">
              {page + 1}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={organizations.length < limit}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Create Organization Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[#333]">Crear Organizacion</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center transition">
                <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#585858] mb-1.5">Nombre de la Organizacion</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                  }}
                  placeholder="Ej: Constructora Bolivar"
                  className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#585858] mb-1.5">Slug</label>
                <input
                  type="text"
                  required
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value)}
                  placeholder="constructora-bolivar"
                  className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm font-mono focus:outline-none focus:border-[#1F114C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#585858] mb-1.5">Plan</label>
                <select
                  value={formPlan}
                  onChange={(e) => setFormPlan(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:border-[#1F114C]"
                >
                  <option value="trial">Trial</option>
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#585858] mb-1.5">Email del Administrador</label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="admin@empresa.com"
                  className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
                />
              </div>
              {createOrg.error && (
                <div className="p-2.5 rounded-lg bg-red-50 text-xs text-[#DD0C15] font-medium">
                  Error: {createOrg.error.message}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createOrg.isPending}
                  className="flex-1 h-9 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-[#c40b13] transition disabled:opacity-60"
                >
                  {createOrg.isPending ? 'Creando...' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

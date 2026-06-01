'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import type { InvitationListItem, OrganizationListItem } from '../../../../lib/trpc-types';

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function statusBadge(status: string) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'bg-gray-100 text-gray-600', label: 'Pendiente' },
    sent: { cls: 'bg-blue-100 text-blue-700', label: 'Enviada' },
    accepted: { cls: 'bg-green-100 text-green-700', label: 'Aceptada' },
    expired: { cls: 'bg-amber-100 text-amber-700', label: 'Expirada' },
    revoked: { cls: 'bg-red-100 text-red-700', label: 'Revocada' },
  };
  const m = map[status] || { cls: 'bg-gray-100 text-gray-600', label: status };
  return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}

function typeBadge(type: string) {
  if (type === 'org_admin') return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">Org Admin</span>;
  return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Usuario</span>;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

const TYPE_TABS = [
  { value: '', label: 'Todas' },
  { value: 'org_admin', label: 'Org Admins' },
  { value: 'user', label: 'Usuarios' },
];

export default function InvitationsPage() {
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showOrgInvite, setShowOrgInvite] = useState(false);
  const [showUserInvite, setShowUserInvite] = useState(false);
  const limit = 15;

  const kpis = trpc.platform.getInvitationKpis.useQuery();
  const invitations = trpc.platform.listInvitations.useQuery({
    page,
    limit,
    type: typeFilter || undefined,
    search: search || undefined,
  });
  const utils = trpc.useUtils();

  const resend = trpc.platform.resendInvitation.useMutation({
    onSuccess: () => { utils.platform.listInvitations.invalidate(); toast('Invitacion reenviada', { type: 'success' }); },
    onError: (err) => { toast(err.message || 'Error al reenviar invitacion', { type: 'error' }); },
  });
  const revoke = trpc.platform.revokeInvitation.useMutation({
    onSuccess: () => {
      utils.platform.listInvitations.invalidate();
      utils.platform.getInvitationKpis.invalidate();
      toast('Invitacion revocada', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al revocar invitacion', { type: 'error' }); },
  });

  const rows = invitations.data?.invitations ?? [];
  const total = invitations.data?.total ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-7 w-16 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : kpis.data ? (
          <>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Total Enviadas</span>
                <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.total}</div>
              <div className="text-xs text-[#8B8B8B] mt-1">invitaciones</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Pendientes</span>
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-amber-600">{kpis.data.pending}</div>
              <div className="text-xs text-amber-500 mt-1 font-medium">esperando respuesta</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Aceptadas</span>
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                </div>
              </div>
              <div className="text-2xl font-bold text-green-600">{kpis.data.accepted}</div>
              <div className="text-xs text-green-500 mt-1 font-medium">
                {kpis.data.total > 0 ? `${Math.round((kpis.data.accepted / kpis.data.total) * 100)}% tasa de aceptacion` : 'sin invitaciones'}
              </div>
            </div>
            <div className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${kpis.data.expired > 0 ? 'border border-red-200' : ''}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Expiradas</span>
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                </div>
              </div>
              <div className={`text-2xl font-bold ${kpis.data.expired > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{kpis.data.expired}</div>
              <div className={`text-xs mt-1 font-medium ${kpis.data.expired > 0 ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>
                {kpis.data.expired > 0 ? 'Considerar reenviar' : 'Sin expiradas'}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Filter bar + actions */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => { setTypeFilter(tab.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                typeFilter === tab.value
                  ? 'bg-[#1F114C] text-white'
                  : 'bg-white border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar por email..."
              className="h-8 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-xs text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 w-52"
            />
          </div>
          <button
            onClick={() => setShowOrgInvite(true)}
            className="h-8 px-4 rounded-lg bg-[#1F114C] text-white text-xs font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>
            Invitar Organizacion
          </button>
          <button
            onClick={() => setShowUserInvite(true)}
            className="h-8 px-4 rounded-lg border border-[#1F114C] text-[#1F114C] text-xs font-medium hover:bg-[#1F114C]/5 transition flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            Invitar Usuario
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-[#EDEDED]">
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-5 py-3">Email</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Tipo</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Organizacion</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Estado</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Enviada</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Expira</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invitations.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[#F6F6F6] animate-pulse">
                    <td className="px-5 py-3"><div className="h-4 w-40 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-full mx-auto" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-28 bg-gray-200 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-full mx-auto" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
                    <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-100 rounded mx-auto" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                    <p className="text-sm text-[#8B8B8B]">No hay invitaciones</p>
                    <p className="text-xs text-[#8B8B8B] mt-1">Invita organizaciones o usuarios para comenzar</p>
                  </td>
                </tr>
              ) : (
                rows.map((inv) => {
                  const isRevoked = inv.status === 'revoked';
                  const isAccepted = inv.status === 'accepted';
                  const isExpired = inv.status === 'expired' || (!isAccepted && !isRevoked && new Date(inv.expiresAt) < new Date());
                  const canAct = !isAccepted && !isRevoked;

                  return (
                    <tr
                      key={inv.id}
                      className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${isRevoked ? 'opacity-50' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <span className="text-sm text-[#333] font-medium">{inv.email}</span>
                        {inv.roleSlug && (
                          <p className="text-[10px] text-[#8B8B8B]">{inv.roleSlug.replace(/_/g, ' ')}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{typeBadge(inv.type)}</td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-[#585858]">
                          {inv.organization?.name || inv.organizationName || '\u2014'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isExpired && inv.status !== 'expired' ? statusBadge('expired') : statusBadge(inv.status)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#585858]">{formatDate(inv.sentAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${isExpired ? 'text-[#DD0C15] font-medium' : 'text-[#585858]'}`}>
                          {formatDate(inv.expiresAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {canAct ? (
                            <>
                              <button
                                onClick={() => resend.mutate({ id: inv.id })}
                                disabled={resend.isPending}
                                className="text-[10px] text-blue-600 font-medium hover:underline disabled:opacity-50"
                              >
                                Reenviar
                              </button>
                              <span className="text-[#EDEDED]">|</span>
                              <button
                                onClick={() => {
                                  if (confirm('Revocar invitacion?')) revoke.mutate({ id: inv.id });
                                }}
                                disabled={revoke.isPending}
                                className="text-[10px] text-[#DD0C15] font-medium hover:underline disabled:opacity-50"
                              >
                                Revocar
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-[#8B8B8B]">
                              {isAccepted ? 'Completada' : 'Revocada'}
                            </span>
                          )}
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
          <span className="text-xs text-[#8B8B8B]">
            Mostrando {rows.length > 0 ? page * limit + 1 : 0}-{page * limit + rows.length} de {total} invitaciones
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
            </button>
            {Array.from({ length: Math.min(Math.ceil(total / limit), 5) }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Invite Org Modal */}
      {showOrgInvite && (
        <InviteOrgModal
          onClose={() => setShowOrgInvite(false)}
          onSuccess={() => {
            setShowOrgInvite(false);
            utils.platform.listInvitations.invalidate();
            utils.platform.getInvitationKpis.invalidate();
          }}
        />
      )}

      {/* Invite User Modal */}
      {showUserInvite && (
        <InviteUserModal
          onClose={() => setShowUserInvite(false)}
          onSuccess={() => {
            setShowUserInvite(false);
            utils.platform.listInvitations.invalidate();
            utils.platform.getInvitationKpis.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ============ INVITE ORG MODAL ============

function InviteOrgModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [plan, setPlan] = useState<'trial' | 'starter' | 'professional' | 'enterprise'>('trial');

  const create = trpc.platform.createOrgInvitation.useMutation({
    onSuccess: () => { toast('Invitacion de organizacion enviada', { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message || 'Error al crear invitacion', { type: 'error' }); },
  });

  const handleNameChange = (value: string) => {
    setOrgName(value);
    if (!orgSlug || orgSlug === slugify(orgName)) {
      setOrgSlug(slugify(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !orgName || !orgSlug) return;
    create.mutate({ email, organizationName: orgName, organizationSlug: orgSlug, organizationPlan: plan });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[#333]">Invitar Organizacion</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Email del Admin *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@empresa.com"
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Nombre de la Organizacion *</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Mi Empresa S.A.S."
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Slug *</label>
            <input
              type="text"
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="mi-empresa"
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm font-mono text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
              required
              pattern="^[a-z0-9-]+$"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as typeof plan)}
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            >
              <option value="trial">Trial (14 dias)</option>
              <option value="starter">Starter ($499/mes)</option>
              <option value="professional">Professional ($999/mes)</option>
              <option value="enterprise">Enterprise ($2,499/mes)</option>
            </select>
          </div>
          {create.error && (
            <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">
              {create.error.message}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!email || !orgName || !orgSlug || create.isPending}
              className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
            >
              {create.isPending ? 'Enviando...' : 'Crear & Enviar Invitacion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============ INVITE USER MODAL ============

function InviteUserModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [roleSlug, setRoleSlug] = useState('');

  const orgs = trpc.platform.listOrganizations.useQuery({ search: orgSearch || undefined, limit: 10, page: 0 });
  const create = trpc.platform.createUserInvitation.useMutation({
    onSuccess: () => { toast('Invitacion de usuario enviada', { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message || 'Error al crear invitacion', { type: 'error' }); },
  });

  const ROLES = [
    { slug: 'super_admin', label: 'Super Administrador' },
    { slug: 'hr_admin', label: 'Admin RRHH' },
    { slug: 'recruiter', label: 'Reclutador' },
    { slug: 'hiring_manager', label: 'Hiring Manager' },
    { slug: 'viewer', label: 'Solo Lectura' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !orgId) return;
    create.mutate({ email, organizationId: orgId, roleSlug: roleSlug || undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[#333]">Invitar Usuario</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Email del Usuario *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@empresa.com"
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Organizacion *</label>
            <input
              type="text"
              value={orgSearch}
              onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); }}
              placeholder="Buscar organizacion..."
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            />
            {orgSearch && !orgId && orgs.data && (
              <div className="mt-1 bg-white border border-[#EDEDED] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {orgs.data.organizations.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => { setOrgId(org.id); setOrgSearch(org.name); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#F6F6F6] transition"
                  >
                    {org.name} <span className="text-[#8B8B8B] text-xs">({org.slug})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Rol</label>
            <select
              value={roleSlug}
              onChange={(e) => setRoleSlug(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            >
              <option value="">Seleccionar rol...</option>
              {ROLES.map((r) => (
                <option key={r.slug} value={r.slug}>{r.label}</option>
              ))}
            </select>
          </div>
          {create.error && (
            <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">
              {create.error.message}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!email || !orgId || create.isPending}
              className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50"
            >
              {create.isPending ? 'Enviando...' : 'Enviar Invitacion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

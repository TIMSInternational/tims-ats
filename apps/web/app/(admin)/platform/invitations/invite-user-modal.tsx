'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';

export function InviteUserModal({ onClose, onSuccess, preselectedOrgId, preselectedOrgName }: { onClose: () => void; onSuccess: () => void; preselectedOrgId?: string; preselectedOrgName?: string }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState(preselectedOrgId || '');
  const [orgSearch, setOrgSearch] = useState(preselectedOrgName || '');
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
          <h2 className="text-lg font-semibold text-[#333]">{t.invitations.inviteUserTitle}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.userEmail} *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.organization} *</label>
            <input type="text" value={orgSearch} onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); }} placeholder={t.organizations.searchOrg} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
            {orgSearch && !orgId && orgs.data && (
              <div className="mt-1 bg-white border border-[#EDEDED] rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {orgs.data.organizations.map((org) => (
                  <button key={org.id} type="button" onClick={() => { setOrgId(org.id); setOrgSearch(org.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F6F6F6] transition">
                    {org.name} <span className="text-[#8B8B8B] text-xs">({org.slug})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.role}</label>
            <select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="">{t.invitations.selectRole}</option>
              {ROLES.map((r) => (
                <option key={r.slug} value={r.slug}>{r.label}</option>
              ))}
            </select>
          </div>
          {create.error && (
            <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">{create.error.message}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.invitations.cancel}</button>
            <button type="submit" disabled={!email || !orgId || create.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">{create.isPending ? t.invitations.sending : t.invitations.sendInvitation}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

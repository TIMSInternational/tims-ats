'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { OrganizationListItem } from '../../../../lib/trpc-types';

export function EditOrgModal({ org, onClose, onSuccess }: { org: OrganizationListItem; onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [editName, setEditName] = useState(org.name);
  const [editPlan, setEditPlan] = useState(org.plan || org.subscription?.plan || 'trial');
  const utils = trpc.useUtils();

  const updateOrg = trpc.platform.updateOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      toast('Organizacion actualizada', { type: 'success' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || 'Error al actualizar organizacion', { type: 'error' }); },
  });

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      toast('Estado de organizacion actualizado', { type: 'success' });
      onClose();
    },
    onError: (err) => { toast(err.message || 'Error al cambiar estado de organizacion', { type: 'error' }); },
  });

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    updateOrg.mutate({
      id: org.id,
      name: editName,
      plan: editPlan,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#333]">{t.organizations.edit} {t.organizations.title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center transition">
            <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleEdit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1.5">Nombre</label>
            <input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1.5">Plan</label>
            <select
              value={editPlan}
              onChange={(e) => setEditPlan(e.target.value as typeof editPlan)}
              className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:border-[#1F114C]"
            >
              <option value="trial">Trial</option>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1.5">Estado</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!org.isActive) {
                    suspendOrg.mutate({ id: org.id, suspend: false });
                  }
                }}
                className={`flex-1 h-9 rounded-lg text-sm font-medium transition ${org.isActive ? 'bg-green-50 text-green-700 border border-green-200' : 'border border-[#EDEDED] text-[#585858] hover:bg-green-50'}`}
              >
                {t.organizations.statusActive}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (org.isActive && confirm(`Suspender ${org.name}?`)) {
                    suspendOrg.mutate({ id: org.id, suspend: true });
                  }
                }}
                className={`flex-1 h-9 rounded-lg text-sm font-medium transition ${!org.isActive ? 'bg-red-50 text-[#DD0C15] border border-red-200' : 'border border-[#EDEDED] text-[#585858] hover:bg-red-50'}`}
              >
                {t.organizations.statusSuspended}
              </button>
            </div>
          </div>
          {updateOrg.error && (
            <div className="p-2.5 rounded-lg bg-red-50 text-xs text-[#DD0C15] font-medium">
              Error: {updateOrg.error.message}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={updateOrg.isPending}
              className="flex-1 h-9 rounded-lg bg-[#1F114C] text-sm text-white font-medium hover:bg-[#1F114C]/90 transition disabled:opacity-60"
            >
              {updateOrg.isPending ? t.common.saving : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

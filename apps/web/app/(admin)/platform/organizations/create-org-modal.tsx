'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';

export function CreateOrgModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPlan, setFormPlan] = useState('trial');
  const [formEmail, setFormEmail] = useState('');

  const createOrg = trpc.platform.createOrganization.useMutation({
    onSuccess: () => {
      toast(t.organizations.created, { type: 'success' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || 'Error al crear organizacion', { type: 'error' }); },
  });

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-[#333]">{t.organizations.newOrg}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center transition">
            <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1.5">{t.organizations.orgNameLabel}</label>
            <input
              type="text"
              required
              value={formName}
              onChange={(e) => {
                setFormName(e.target.value);
                setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
              }}
              placeholder={t.organizations.orgNamePlaceholder}
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
            <label className="block text-xs font-medium text-[#585858] mb-1.5">{t.organizations.adminEmailLabel}</label>
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
              onClick={onClose}
              className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={createOrg.isPending}
              className="flex-1 h-9 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-[#c40b13] transition disabled:opacity-60"
            >
              {createOrg.isPending ? t.common.loading : t.common.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

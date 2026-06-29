'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Skeleton } from '../../../../components';

export function BillingProfileDrawer({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const { t } = useI18n();
  const profile = trpc.platform.getBillingProfile.useQuery({ organizationId });
  const upsert = trpc.platform.upsertBillingProfile.useMutation({
    onSuccess: () => { toast(t.invoices.billingProfileUpdated, { type: 'success' }); onClose(); },
    onError: (err) => { toast(err.message || 'Error al actualizar perfil de facturacion', { type: 'error' }); },
  });
  const [form, setForm] = useState({ companyName: '', taxId: '', address: '', city: '', state: '', country: '', zipCode: '', billingEmail: '', billingPhone: '' });
  const [initialized, setInitialized] = useState(false);
  if (profile.data && !initialized) { setForm({ companyName: profile.data.companyName || '', taxId: profile.data.taxId || '', address: profile.data.address || '', city: profile.data.city || '', state: profile.data.state || '', country: profile.data.country || '', zipCode: profile.data.zipCode || '', billingEmail: profile.data.billingEmail || '', billingPhone: profile.data.billingPhone || '' }); setInitialized(true); }
  if (!profile.data && profile.isFetched && !initialized) setInitialized(true);

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); upsert.mutate({ organizationId, ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v || undefined])) } as Parameters<typeof upsert.mutate>[0]); };
  const fields: Array<{ key: keyof typeof form; label: string; type?: string; span?: number }> = [
    { key: 'companyName', label: t.invoices.companyName, span: 2 }, { key: 'taxId', label: t.invoices.taxId }, { key: 'billingEmail', label: t.invoices.billingEmail, type: 'email' }, { key: 'billingPhone', label: t.invoices.phone }, { key: 'address', label: t.invoices.address, span: 2 }, { key: 'city', label: t.invoices.city }, { key: 'state', label: t.invoices.state }, { key: 'country', label: t.invoices.country }, { key: 'zipCode', label: t.invoices.zipCode },
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end"><div className="absolute inset-0 bg-black/40" onClick={onClose} /><div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-xl">
      <div className="flex items-center justify-between p-5 border-b border-[#EDEDED] sticky top-0 bg-white z-10"><h2 className="text-base font-semibold text-[#333]">{t.invoices.billingProfile}</h2><button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition"><svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button></div>
      {profile.isLoading ? <div className="p-5 space-y-4">{Array.from({ length: 6 }).map((_, i) => <div key={i}><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-9 w-full" /></div>)}</div> : (
        <form onSubmit={handleSubmit} className="p-5"><div className="grid grid-cols-2 gap-3">{fields.map((f) => (<div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}><label className="text-xs font-medium text-[#585858] mb-1 block">{f.label}</label><input type={f.type || 'text'} value={form[f.key]} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>))}</div>
        <div className="flex justify-end gap-2 mt-6"><button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.invoices.cancel}</button><button type="submit" disabled={upsert.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">{upsert.isPending ? t.invoices.saving : t.invoices.save}</button></div></form>
      )}
    </div></div>
  );
}

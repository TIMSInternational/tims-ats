'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { BUTTON_GROUP_CLASSES, Button, Drawer, ErrorState, FIELD_LABEL_CLASSES, Skeleton, inputClasses } from '../../../../components';

export function BillingProfileDrawer({ organizationId, onClose }: { organizationId: string; onClose: () => void }) {
  const { t } = useI18n();
  const profile = trpc.platform.getBillingProfile.useQuery({ organizationId });
  const upsert = trpc.platform.upsertBillingProfile.useMutation({
    onSuccess: () => { toast(t.invoices.billingProfileUpdated, { type: 'success' }); onClose(); },
    onError: (err) => { toast(err.message || t.invoices.billingProfileError, { type: 'error' }); },
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
    <Drawer
      title={t.invoices.billingProfile}
      onClose={onClose}
      footer={
        profile.isLoading || profile.isError ? undefined : (
          <div className={`${BUTTON_GROUP_CLASSES} w-full`}>
            <Button variant="secondary" onClick={onClose}>{t.invoices.cancel}</Button>
            <Button type="submit" form="billing-profile-form" loading={upsert.isPending} loadingLabel={t.invoices.saving}>
              {t.invoices.save}
            </Button>
          </div>
        )
      }
    >
      {profile.isLoading ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} aria-hidden="true"><Skeleton className="mb-1 h-3 w-20" /><Skeleton className="h-9 w-full" /></div>)}
        </div>
      ) : profile.isError ? (
        <ErrorState onRetry={() => profile.refetch()} error={profile.error} />
      ) : (
        <form id="billing-profile-form" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.span === 2 ? 'sm:col-span-2' : ''}>
                <label htmlFor={`billing-${f.key}`} className={FIELD_LABEL_CLASSES}>{f.label}</label>
                <input
                  id={`billing-${f.key}`}
                  type={f.type || 'text'}
                  value={form[f.key]}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className={inputClasses('md')}
                />
              </div>
            ))}
          </div>
        </form>
      )}
    </Drawer>
  );
}

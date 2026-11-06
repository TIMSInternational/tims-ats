'use client';

import { useState } from 'react';
import { useOrganizationInvitationCreate } from '../../../../lib/platform-api/organization-invitation-create';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { sanitizeSlugInput, slugify } from '../../../../lib/slugify';
import { trpc } from '../../../../lib/trpc';
import { findSimilarOrganizations } from '../../../../lib/similar-organizations';
import { EMPTY_ORG_LOCALE_FORM, orgLocaleFormToProfile } from '../../../../lib/org-locale-form';
import { OrgLocaleFields } from '../organizations/org-locale-fields';

export function InviteOrgModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [plan, setPlan] = useState<'trial' | 'starter' | 'professional' | 'enterprise'>('trial');
  const [confirmNew, setConfirmNew] = useState(false);
  const [localeForm, setLocaleForm] = useState(EMPTY_ORG_LOCALE_FORM);
  const localeProfile = orgLocaleFormToProfile(localeForm);
  // This creates a NEW organization. A name that resembles an existing one is most likely a person who
  // belongs in that organization ("Invitar usuario"), so it needs an explicit confirmation (D-15).
  const existingOrgs = trpc.platform.listOrganizationsMinimal.useQuery();
  const similar = findSimilarOrganizations(orgName, existingOrgs.data ?? []);
  const needsConfirm = similar.length > 0 && !confirmNew;

  const create = useOrganizationInvitationCreate({
    onSuccess: (delivery) => {
      toast(delivery === 'accepted' ? t.invitations.orgInviteSent : t.invitations.orgInviteDeliveryUnconfirmed,
        { type: delivery === 'accepted' ? 'success' : 'warning' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || t.invitations.creationFailed, { type: 'error' }); },
  });

  const handleNameChange = (value: string) => {
    setOrgName(value);
    if (!orgSlug || orgSlug === slugify(orgName)) {
      setOrgSlug(slugify(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !orgName || !orgSlug || !localeProfile || needsConfirm) return;
    create.mutate({ email, organizationName: orgName, organizationSlug: orgSlug, organizationPlan: plan, localeProfile });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-[#333]">{t.invitations.inviteOrgTitle}</h2>
          <button aria-label={t.common.close} onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-org-email" className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.adminEmail} *</label>
            <input id="invite-org-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com" className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required />
          </div>
          <div>
            <label htmlFor="invite-org-name" className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.orgName} *</label>
            <input id="invite-org-name" type="text" minLength={2} maxLength={100} value={orgName} onChange={(e) => { handleNameChange(e.target.value); setConfirmNew(false); }} placeholder={t.invitations.orgNamePlaceholder} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required />
          </div>
          <div>
            <label htmlFor="invite-org-slug" className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.slug} *</label>
            <input id="invite-org-slug" type="text" minLength={2} maxLength={63} value={orgSlug} onChange={(e) => setOrgSlug(sanitizeSlugInput(e.target.value))} placeholder="mi-empresa" className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm font-mono text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required pattern="^[a-z0-9-]+$" />
          </div>
          <div>
            <label htmlFor="invite-org-plan" className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.plan}</label>
            <select id="invite-org-plan" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="trial">{t.invitations.trialPlan}</option>
              <option value="starter">{t.invitations.starterPlan}</option>
              <option value="professional">{t.invitations.professionalPlan}</option>
              <option value="enterprise">{t.invitations.enterprisePlan}</option>
            </select>
          </div>
          <OrgLocaleFields idPrefix="invite-org" value={localeForm} onChange={setLocaleForm} />
          {similar.length > 0 && (
            <div role="alert" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg space-y-2">
              <p>{t.invitations.similarOrgWarning.replace('{names}', similar.map((o) => o.name).join(', '))}</p>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={confirmNew} onChange={(e) => setConfirmNew(e.target.checked)} />
                {t.invitations.similarOrgConfirm}
              </label>
            </div>
          )}
          {create.error && (
            <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">{create.error.message}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.invitations.cancel}</button>
            <button type="submit" disabled={!email || !orgName || !orgSlug || !localeProfile || needsConfirm || create.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">{create.isPending ? t.invitations.sending : t.invitations.createAndSend}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

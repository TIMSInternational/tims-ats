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
import {
  BUTTON_GROUP_CLASSES,
  Button,
  DialogCancelButton,
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  inputClasses,
  selectClasses,
} from '../../../../components';

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

  const inv = t.invitations;
  const blocked = !localeProfile;
  const field = inputClasses('md');

  return (
    <Modal title={inv.inviteOrgTitle} onClose={onClose} dirty={Boolean(email || orgName)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="invite-org-email" className={FIELD_LABEL_CLASSES}>{inv.adminEmail} *</label>
          <input id="invite-org-email" type="email" autoFocus maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@empresa.com" className={field} required />
        </div>
        <div>
          <label htmlFor="invite-org-name" className={FIELD_LABEL_CLASSES}>{inv.orgName} *</label>
          <input id="invite-org-name" type="text" minLength={2} maxLength={100} value={orgName} onChange={(e) => { handleNameChange(e.target.value); setConfirmNew(false); }} placeholder={inv.orgNamePlaceholder} className={field} required />
        </div>
        <div>
          <label htmlFor="invite-org-slug" className={FIELD_LABEL_CLASSES}>{inv.slug} *</label>
          <input id="invite-org-slug" type="text" minLength={2} maxLength={63} value={orgSlug} onChange={(e) => setOrgSlug(sanitizeSlugInput(e.target.value))} placeholder="mi-empresa" className={inputClasses('md', 'font-mono')} required pattern="^[a-z0-9-]+$" />
        </div>
        <div>
          <label htmlFor="invite-org-plan" className={FIELD_LABEL_CLASSES}>{inv.plan}</label>
          <select id="invite-org-plan" value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)} className={selectClasses('md')}>
            <option value="trial">{inv.trialPlan}</option>
            <option value="starter">{inv.starterPlan}</option>
            <option value="professional">{inv.professionalPlan}</option>
            <option value="enterprise">{inv.enterprisePlan}</option>
          </select>
        </div>
        <OrgLocaleFields idPrefix="invite-org" value={localeForm} onChange={setLocaleForm} />
        {similar.length > 0 && (
          <div role="alert" className="space-y-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-callout text-warning">
            <p>{inv.similarOrgWarning.replace('{names}', similar.map((o) => o.name).join(', '))}</p>
            <label className={`${CHOICE_ROW_CLASSES} font-medium`}>
              <input type="checkbox" className={CHOICE_INPUT_CLASSES} checked={confirmNew} onChange={(e) => setConfirmNew(e.target.checked)} />
              {inv.similarOrgConfirm}
            </label>
          </div>
        )}
        {create.error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">{create.error.message}</p>
        )}
        <div className="space-y-2 border-t border-border pt-4">
          {blocked && (
            <p id="invite-org-blocked-hint" className="text-callout text-secondary sm:text-right">{t.organizations.chooseCountryFirst}</p>
          )}
          <div className={BUTTON_GROUP_CLASSES}>
            <DialogCancelButton onCancel={onClose}>{inv.cancel}</DialogCancelButton>
            <Button
              type="submit"
              disabled={!email || !orgName || !orgSlug || blocked || needsConfirm}
              loading={create.isPending}
              loadingLabel={inv.sending}
              aria-describedby={blocked ? 'invite-org-blocked-hint' : undefined}
            >
              {inv.createAndSend}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

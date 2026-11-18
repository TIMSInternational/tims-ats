'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { sanitizeSlugInput, slugify } from '../../../../lib/slugify';
import { EMPTY_ORG_LOCALE_FORM, orgLocaleFormToProfile } from '../../../../lib/org-locale-form';
import { OrgLocaleFields } from './org-locale-fields';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  DialogCancelButton,
  FIELD_HELP_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  inputClasses,
  selectClasses,
} from '../../../../components';
import { PLAN_KEYS, planLabel } from './plan-label';

export function CreateOrgModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPlan, setFormPlan] = useState('trial');
  const [formEmail, setFormEmail] = useState('');
  const [localeForm, setLocaleForm] = useState(EMPTY_ORG_LOCALE_FORM);
  const localeProfile = orgLocaleFormToProfile(localeForm);

  const createOrg = trpc.platform.createOrganization.useMutation({
    onSuccess: () => {
      toast(t.organizations.created, { type: 'success' });
      onSuccess();
    },
    onError: (err) => {
      toast(err.message || t.organizations.createError, { type: 'error' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!localeProfile) return;
    createOrg.mutate({
      name: formName,
      slug: formSlug,
      plan: formPlan as 'trial' | 'starter' | 'professional' | 'enterprise',
      adminEmail: formEmail,
      localeProfile,
    });
  };

  const o = t.organizations;
  const label = FIELD_LABEL_CLASSES;
  const field = inputClasses('md');
  const blockedHintId = 'create-org-blocked-hint';

  return (
    <Modal title={o.newOrg} onClose={onClose} dirty={Boolean(formName || formEmail)}>
      <form onSubmit={handleCreate} className="space-y-4">
        <div>
          <label htmlFor="create-org-name" className={label}>{o.orgNameLabel}</label>
          <input
            id="create-org-name"
            type="text"
            required
            autoFocus
            value={formName}
            onChange={(e) => {
              setFormName(e.target.value);
              setFormSlug(slugify(e.target.value));
            }}
            placeholder={o.orgNamePlaceholder}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="create-org-slug" className={label}>{o.slugLabel}</label>
          <input
            id="create-org-slug"
            type="text"
            required
            value={formSlug}
            onChange={(e) => setFormSlug(sanitizeSlugInput(e.target.value))}
            placeholder="constructora-bolivar"
            aria-describedby="create-org-slug-hint"
            className={inputClasses('md', 'font-mono')}
          />
          <p id="create-org-slug-hint" className={FIELD_HELP_CLASSES}>{o.slugHint}</p>
        </div>
        <div>
          <label htmlFor="create-org-plan" className={label}>{o.plan}</label>
          <select
            id="create-org-plan"
            value={formPlan}
            onChange={(e) => setFormPlan(e.target.value)}
            className={selectClasses('md')}
          >
            {PLAN_KEYS.map((p) => <option key={p} value={p}>{planLabel(p, t)}</option>)}
          </select>
        </div>
        <div>
          {/* Persisted only as billing_email — this modal invites nobody. The admin invite lives in
              "Invitar organización" (/platform/invitations). Payload key stays `adminEmail`. */}
          <label htmlFor="create-org-billing-email" className={label}>
            {o.billingEmailLabel}
          </label>
          <input
            id="create-org-billing-email"
            type="email"
            required
            maxLength={254}
            value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)}
            placeholder="facturacion@empresa.com"
            aria-describedby="create-org-billing-email-hint"
            className={field}
          />
          <p id="create-org-billing-email-hint" className={FIELD_HELP_CLASSES}>
            {o.billingEmailHint}
          </p>
        </div>
        <OrgLocaleFields idPrefix="create-org" value={localeForm} onChange={setLocaleForm} />
        {createOrg.error && (
          <p role="alert" className="rounded-lg bg-danger-bg p-2.5 text-callout font-medium text-danger">
            {createOrg.error.message}
          </p>
        )}
        <div className="space-y-2 border-t border-border pt-4">
          {!localeProfile && (
            <p id={blockedHintId} className="text-callout text-secondary sm:text-right">{o.chooseCountryFirst}</p>
          )}
          <div className={BUTTON_GROUP_CLASSES}>
            <DialogCancelButton onCancel={onClose} />
            <Button
              type="submit"
              disabled={!localeProfile}
              loading={createOrg.isPending}
              aria-describedby={!localeProfile ? blockedHintId : undefined}
            >
              {t.common.create}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

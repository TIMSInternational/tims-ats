'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatCurrency } from '../../../../lib/format-utils';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  DialogCancelButton,
  ConfirmDialog,
  FIELD_HELP_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  StatusBadge,
  inputClasses,
  selectClasses,
} from '../../../../components';
import { PLAN_KEYS, planLabel } from './plan-label';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { orgLocalePatch, type OrgLocaleForm } from '../../../../lib/org-locale-form';
import { OrgLocaleFields } from './org-locale-fields';

const PLAN_MRR: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };
const PLAN_ORDER: Record<string, number> = { trial: 0, starter: 1, professional: 2, enterprise: 3 };

/**
 * `localeInitial` (the organization detail page passes it) adds the country / time zone / currency / locale
 * fields. Only the values the owner changes are sent, and the server MERGES them into settings, so every
 * other key (candidateContactEmail, ...) is kept. The list page passes none and edits name and plan only.
 */
export function EditOrgModal({
  org,
  localeInitial,
  onClose,
  onSuccess,
}: {
  // Only the fields this modal reads, so both the list item and the getOrganization detail fit without a cast.
  org: Pick<OrganizationListItem, 'id' | 'name' | 'plan' | 'isActive'> & {
    subscription?: { plan: OrganizationListItem['plan'] } | null;
  };
  localeInitial?: OrgLocaleForm;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useI18n();
  const [editName, setEditName] = useState(org.name);
  const [localeForm, setLocaleForm] = useState<OrgLocaleForm | null>(localeInitial ?? null);
  const settingsPatch = localeInitial && localeForm ? orgLocalePatch(localeInitial, localeForm) : {};
  const [showSuspendConfirm, setShowSuspendConfirm] = useState(false);
  const currentPlan = org.plan || org.subscription?.plan || 'trial';
  const [editPlan, setEditPlan] = useState(currentPlan);
  const utils = trpc.useUtils();

  const updateOrg = trpc.platform.updateOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      utils.platform.getOrganization.invalidate({ id: org.id });
      toast(t.organizations.updated, { type: 'success' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || t.organizations.updateError, { type: 'error' }); },
  });

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      toast(t.organizations.statusUpdated, { type: 'success' });
      onClose();
    },
    onError: (err) => { toast(err.message || t.organizations.statusChangeError, { type: 'error' }); },
  });

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (settingsPatch === null) return;
    updateOrg.mutate({
      id: org.id,
      name: editName,
      plan: editPlan,
      ...(Object.keys(settingsPatch).length > 0 ? { settings: settingsPatch } : {}),
    });
  };

  const o = t.organizations;
  const isUpgrade = PLAN_ORDER[editPlan] > PLAN_ORDER[currentPlan];
  const money = (plan: string) => formatCurrency(PLAN_MRR[plan] ?? 0, 'USD', 0);
  const dirty = editName !== org.name || editPlan !== currentPlan || Object.keys(settingsPatch ?? {}).length > 0;

  // One dialog at a time (modality.md): the suspend confirm replaces the edit dialog; Cancel brings it back.
  if (showSuspendConfirm) {
    return (
      <ConfirmDialog
        title={formatMessage(o.confirmSuspendTitle, { name: org.name })}
        description={o.confirmSuspendBody}
        confirmLabel={o.suspendOrg}
        destructive
        loading={suspendOrg.isPending}
        onConfirm={() => suspendOrg.mutate({ id: org.id, suspend: true })}
        onCancel={() => setShowSuspendConfirm(false)}
      />
    );
  }

  return (
    <Modal title={o.editTitle} description={org.name} onClose={onClose} dirty={dirty}>
      <form onSubmit={handleEdit} className="space-y-4">
        <div>
          <label htmlFor="edit-org-name" className={FIELD_LABEL_CLASSES}>{t.common.name}</label>
          <input
            id="edit-org-name"
            type="text"
            required
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className={inputClasses('md')}
          />
        </div>
        <div>
          <label htmlFor="edit-org-plan" className={FIELD_LABEL_CLASSES}>{o.plan}</label>
          <select
            id="edit-org-plan"
            value={editPlan}
            onChange={(e) => setEditPlan(e.target.value as typeof editPlan)}
            aria-describedby={editPlan !== currentPlan ? 'edit-org-plan-change' : undefined}
            className={selectClasses('md')}
          >
            {PLAN_KEYS.map((p) => <option key={p} value={p}>{planLabel(p, t)}</option>)}
          </select>
          {editPlan !== currentPlan && (
            <p
              id="edit-org-plan-change"
              className={`mt-2 rounded-lg px-3 py-2 text-callout font-medium ${isUpgrade ? 'bg-info-bg text-info' : 'bg-warning-bg text-warning'}`}
            >
              {formatMessage(isUpgrade ? o.planUpgrade : o.planDowngrade, {
                plan: planLabel(editPlan, t),
                from: money(currentPlan),
                to: money(editPlan),
              })}
            </p>
          )}
        </div>
        {localeForm && (
          <OrgLocaleFields
            idPrefix="edit-org"
            required={false}
            value={localeForm}
            onChange={setLocaleForm}
            hint={t.orgLocale.editHint}
          />
        )}
        {settingsPatch === null && (
          <p role="alert" className="rounded-lg bg-warning-bg p-2.5 text-callout font-medium text-warning">{t.orgLocale.invalid}</p>
        )}
        {updateOrg.error && (
          <p role="alert" className="rounded-lg bg-danger-bg p-2.5 text-callout font-medium text-danger">
            {updateOrg.error.message}
          </p>
        )}
        <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
          <DialogCancelButton onCancel={onClose} />
          <Button type="submit" disabled={settingsPatch === null} loading={updateOrg.isPending} loadingLabel={t.common.saving}>
            {t.common.save}
          </Button>
        </div>
      </form>

      {/* Status acts immediately, so it sits outside the saved fields (toggles.md, modality.md). */}
      <section aria-labelledby="edit-org-status" className="mt-6 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="edit-org-status" className="text-body font-medium text-primary">{t.common.status}</h3>
          <StatusBadge tone={org.isActive ? 'success' : 'danger'}>
            {org.isActive ? o.statusActive : o.statusSuspended}
          </StatusBadge>
        </div>
        <p id="edit-org-status-help" className={FIELD_HELP_CLASSES}>{o.statusAppliesNow}</p>
        <div className="mt-3">
          {org.isActive ? (
            <Button variant="destructive-secondary" aria-describedby="edit-org-status-help" onClick={() => setShowSuspendConfirm(true)}>
              {o.suspendOrgEllipsis}
            </Button>
          ) : (
            <Button
              variant="secondary"
              aria-describedby="edit-org-status-help"
              loading={suspendOrg.isPending}
              onClick={() => suspendOrg.mutate({ id: org.id, suspend: false })}
            >
              {o.reactivateOrg}
            </Button>
          )}
        </div>
      </section>
    </Modal>
  );
}

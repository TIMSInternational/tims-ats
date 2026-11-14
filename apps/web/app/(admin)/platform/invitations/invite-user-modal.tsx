'use client';

import { useState } from 'react';
import { useUserInvitationRoles } from '../../../../lib/platform-api/user-invitation-roles';
import { useUserInvitationCreate } from '../../../../lib/platform-api/user-invitation-create';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  ErrorState,
  FIELD_ERROR_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  inputClasses,
  selectClasses,
} from '../../../../components';
import { isInviteRoleValid } from '../../../../lib/invitations/invite-role';

export function InviteUserModal({ onClose, onSuccess, preselectedOrgId, preselectedOrgName }: { onClose: () => void; onSuccess: () => void; preselectedOrgId?: string; preselectedOrgName?: string }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState(preselectedOrgId || '');
  const [orgSearch, setOrgSearch] = useState(preselectedOrgName || '');
  const [roleSlug, setRoleSlug] = useState('');

  const orgs = trpc.platform.listOrganizations.useQuery({ search: orgSearch || undefined, limit: 10, page: 0 });
  const create = useUserInvitationCreate({
    onSuccess: (delivery) => {
      toast(delivery === 'accepted' ? t.invitations.userInvitationSent : t.invitations.userInviteDeliveryUnconfirmed,
        { type: delivery === 'accepted' ? 'success' : 'warning' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || t.invitations.creationFailed, { type: 'error' }); },
  });

  const invitationRoles = useUserInvitationRoles(orgId);

  const [roleTouched, setRoleTouched] = useState(false);
  const roleError = roleTouched && !isInviteRoleValid(roleSlug);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRoleTouched(true);
    if (!email || !orgId || !isInviteRoleValid(roleSlug)) return;
    create.mutate({ email, organizationId: orgId, roleSlug: roleSlug.trim() });
  };

  const inv = t.invitations;
  const orgResults = orgs.data?.organizations ?? [];
  const selectedOrgName = orgId ? orgSearch : '';

  return (
    <Modal title={inv.inviteUserTitle} onClose={onClose} dirty={Boolean(email)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="invite-user-org" className={FIELD_LABEL_CLASSES}>{inv.organization} *</label>
          <input
            id="invite-user-org"
            type="text"
            autoFocus={!preselectedOrgId}
            autoComplete="off"
            value={orgSearch}
            onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); setRoleSlug(''); }}
            placeholder={t.organizations.searchOrg}
            aria-describedby="invite-user-org-status"
            className={inputClasses('md')}
          />
          {orgSearch && !orgId && orgs.isError && (
            <ErrorState size="inline" onRetry={() => orgs.refetch()} error={orgs.error} className="mt-2" />
          )}
          {orgSearch && !orgId && orgs.data && orgResults.length > 0 && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-white shadow-popover">
              {orgResults.map((org) => (
                <button key={org.id} type="button" onClick={() => { setOrgId(org.id); setOrgSearch(org.name); setRoleSlug(''); }} className="w-full px-3 py-2 text-left text-body text-primary transition-colors hover:bg-surface pointer-coarse:min-h-11">
                  {org.name} <span className="text-callout text-secondary">({org.slug})</span>
                </button>
              ))}
            </div>
          )}
          <p id="invite-user-org-status" role="status" className="mt-1.5 text-callout">
            {orgId ? (
              <span className="font-medium text-success">{formatMessage(inv.orgChosen, { name: selectedOrgName })}</span>
            ) : orgSearch && orgs.data && orgResults.length === 0 ? (
              <span className="text-secondary">{t.common.noResults}</span>
            ) : null}
          </p>
        </div>
        <div>
          <label htmlFor="invite-user-email" className={FIELD_LABEL_CLASSES}>{inv.userEmail} *</label>
          <input id="invite-user-email" type="email" autoFocus={Boolean(preselectedOrgId)} maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" className={inputClasses('md')} required />
        </div>
        <div>
          <label htmlFor="invite-user-role" className={FIELD_LABEL_CLASSES}>{inv.role} *</label>
          {invitationRoles.isError && <ErrorState size="inline" className="mb-2" onRetry={() => invitationRoles.refetch()} />}
          <select
            id="invite-user-role"
            aria-invalid={roleError || undefined}
            aria-describedby={roleError ? 'invite-user-role-error' : undefined}
            value={roleSlug}
            onChange={(e) => { setRoleSlug(e.target.value); setRoleTouched(true); }}
            className={selectClasses('md')}
          >
            <option value="">{inv.selectRole}</option>
            {invitationRoles.roles.map((r) => (
              <option key={r.slug} value={r.slug}>{r.label}</option>
            ))}
          </select>
          {roleError && <p id="invite-user-role-error" role="alert" className={FIELD_ERROR_CLASSES}>{inv.roleRequired}</p>}
        </div>
        {create.error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">{create.error.message}</p>
        )}
        <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
          <Button variant="secondary" onClick={onClose}>{inv.cancel}</Button>
          <Button type="submit" disabled={!email || !orgId} loading={create.isPending} loadingLabel={inv.sending}>
            {inv.sendInvitation}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

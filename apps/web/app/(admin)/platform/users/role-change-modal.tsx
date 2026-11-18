'use client';

import { useState } from 'react';
import { Button, CHOICE_INPUT_CLASSES, Modal, StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { staffRoleOptions } from '../../../../lib/role-labels';
import type { UserListItem } from '../../../../lib/trpc-types';

interface RoleChangeModalProps {
  user: UserListItem;
  onConfirm: (roleSlug: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export function RoleChangeModal({ user, onConfirm, onClose, isPending }: RoleChangeModalProps) {
  const { t } = useI18n();
  const currentRole = user.isPlatformOwner ? 'platform_owner' : user.userRoles?.[0]?.role?.slug || 'employee';
  const [selected, setSelected] = useState(currentRole);
  const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  // Shared labels + launch scope; the current role stays listed even when the pilot hides it.
  const assignableRoles = staffRoleOptions(t.roles, { keep: currentRole });

  const u = t.users;
  return (
    <Modal
      title={formatMessage(u.changeRoleTitle, { name: fullName || user.email })}
      description={user.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {user.isPlatformOwner ? t.common.close : t.common.cancel}
          </Button>
          {!user.isPlatformOwner && (
            <Button onClick={() => onConfirm(selected)} disabled={selected === currentRole} loading={isPending} loadingLabel={t.common.saving}>
              {u.changeRoleBtn}
            </Button>
          )}
        </>
      }
    >
      {user.isPlatformOwner ? (
        <div className="rounded-lg border border-border bg-brand-tint p-4">
          <div className="mb-2 flex items-center gap-2">
            <svg className="size-4 text-brand" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            <span className="text-body font-semibold text-brand">{u.platformOwnerLabel}</span>
          </div>
          <p className="text-callout text-secondary">{u.platformOwnerDesc}</p>
        </div>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{u.role}</legend>
          {assignableRoles.map((role) => {
            const isCurrent = role.slug === currentRole;
            return (
              <label
                key={role.slug}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border p-2.5 transition-colors hover:border-field-border has-[:checked]:border-brand has-[:checked]:bg-brand-tint pointer-coarse:min-h-11"
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="role-change"
                    value={role.slug}
                    checked={role.slug === selected}
                    onChange={() => setSelected(role.slug)}
                    className={CHOICE_INPUT_CLASSES}
                  />
                  <span className="text-body font-medium text-primary">{role.label}</span>
                </span>
                {isCurrent && <StatusBadge tone="brand" icon="none">{u.currentRole}</StatusBadge>}
              </label>
            );
          })}
        </fieldset>
      )}
    </Modal>
  );
}

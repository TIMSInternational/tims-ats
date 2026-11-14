'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components/modal';
import { Button } from '../../../../components/button';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { Field } from '../../../../components/field';
import { Select } from '../../../../components/select';
import { Menu, type MenuEntry } from '../../../../components/menu';
import { memberRoleOptions } from '../../../../lib/member-admin';
import type { AssignableStaffRole } from '@tims/shared';

const ROLE_FORM_ID = 'member-role-form';

// "Cambiar rol…" / "Desactivar…" on a member row (company-admin access-3 / ideal-78). Both open a dialog
// first; the server applies the same rules again (user.assignRole / user.deactivate). `layout="menu"` is the
// phone list: the same two commands behind one "Acciones de {name}" button.
export function MemberRowActions({
  member,
  currentRole,
  actorRoles,
  canChangeRole,
  canDeactivate,
  layout = 'buttons',
}: {
  member: { id: string; name: string };
  currentRole: string | null;
  actorRoles: readonly string[];
  canChangeRole: boolean;
  canDeactivate: boolean;
  layout?: 'buttons' | 'menu';
}) {
  const { t } = useI18n();
  const m = t.teamSettings;
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<'role' | 'deactivate' | null>(null);
  const [selectedRole, setSelectedRole] = useState(currentRole ?? '');
  const options = memberRoleOptions(actorRoles, t.roles, currentRole);
  const close = () => setDialog(null);

  // Failures show inside the still-open dialog, in translated copy (never the server's text).
  const changeRole = trpc.user.assignRole.useMutation({
    onSuccess: () => {
      toast(m.roleChanged, { type: 'success' });
      close();
      void utils.user.list.invalidate();
    },
  });
  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => {
      toast(m.deactivated, { type: 'success' });
      close();
      void utils.user.list.invalidate();
    },
  });

  const openRole = () => {
    changeRole.reset?.();
    setSelectedRole(currentRole ?? '');
    setDialog('role');
  };
  const openDeactivate = () => {
    deactivate.reset?.();
    setDialog('deactivate');
  };
  const roleHint = selectedRole ? (m.roleDescriptions[selectedRole as keyof typeof m.roleDescriptions] ?? '') : '';

  const menuItems: MenuEntry[] = [
    ...(canChangeRole ? [{ key: 'role', label: m.changeRole, onSelect: openRole }] : []),
    ...(canDeactivate ? [{ key: 'deactivate', label: m.deactivate, destructive: true, onSelect: openDeactivate }] : []),
  ];

  return (
    <div className="flex justify-end gap-2">
      {layout === 'menu' ? (
        menuItems.length > 0 && <Menu items={menuItems} label={formatMessage(m.rowActions, { name: member.name })} />
      ) : (
        <>
          {canChangeRole && (
            <Button variant="secondary" size="sm" onClick={openRole}>
              {m.changeRole}
            </Button>
          )}
          {canDeactivate && (
            <Button variant="destructive-secondary" size="sm" onClick={openDeactivate}>
              {m.deactivate}
            </Button>
          )}
        </>
      )}

      {dialog === 'role' && (
        <Modal
          title={m.changeRoleTitle.replace('{name}', member.name)}
          onClose={close}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={close}>
                {m.cancel}
              </Button>
              <Button
                type="submit"
                form={ROLE_FORM_ID}
                disabled={!selectedRole || selectedRole === currentRole}
                loading={changeRole.isPending}
                loadingLabel={t.common.saving}
              >
                {m.changeRoleSubmit}
              </Button>
            </>
          }
        >
          <form
            id={ROLE_FORM_ID}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedRole && selectedRole !== currentRole)
                changeRole.mutate({ userId: member.id, roleSlug: selectedRole as AssignableStaffRole });
            }}
          >
            <Field id={`member-role-${member.id}`} label={m.roleLabel} help={m.changeRoleHint}>
              <Select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                {!currentRole && <option value="">{m.rolePlaceholder}</option>}
                {options.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            {roleHint && <p className="text-callout text-secondary">{roleHint}</p>}
            {changeRole.isError && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
                {m.memberActionError}
              </p>
            )}
          </form>
        </Modal>
      )}

      {dialog === 'deactivate' && (
        <ConfirmDialog
          title={m.deactivateTitle.replace('{name}', member.name)}
          description={m.deactivateMessage}
          confirmLabel={m.deactivateConfirm}
          confirmingLabel={m.deactivating}
          cancelLabel={m.cancel}
          destructive
          loading={deactivate.isPending}
          error={deactivate.isError ? m.memberActionError : undefined}
          onConfirm={() => deactivate.mutate({ userId: member.id })}
          onCancel={close}
        />
      )}
    </div>
  );
}

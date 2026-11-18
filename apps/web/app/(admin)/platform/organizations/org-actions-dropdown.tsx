'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { ConfirmDialog, Menu } from '../../../../components';
import type { MenuEntry } from '../../../../components';
import type { OrganizationListItem } from '../../../../lib/trpc-types';

interface OrgActionsDropdownProps {
  org: OrganizationListItem;
  onEdit: (org: OrganizationListItem) => void;
}

/** The row's "Acciones para {org}" menu (menus.md): navigation first, the state change last, after a separator. */
export function OrgActionsDropdown({ org, onEdit }: OrgActionsDropdownProps) {
  const { t } = useI18n();
  const o = t.organizations;
  const [showConfirm, setShowConfirm] = useState(false);

  const utils = trpc.useUtils();
  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: (_data, vars) => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      toast(vars.suspend ? o.suspendedToast : o.activatedToast, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || o.statusChangeError, { type: 'error' });
    },
  });

  const confirmSuspendToggle = () => {
    setShowConfirm(false);
    suspendOrg.mutate({ id: org.id, suspend: org.isActive });
  };

  const base = `/platform/organizations/${org.id}`;
  const items: MenuEntry[] = [
    { key: 'view', label: o.viewDetails, href: base },
    { key: 'edit', label: o.editEllipsis, onSelect: () => onEdit(org) },
    { key: 'invoices', label: o.viewInvoices, href: `/platform/invoices?org=${org.id}` },
    { key: 'users', label: o.viewUsers, href: `${base}?tab=users` },
    { key: 'features', label: o.features, href: `${base}?tab=features` },
    { key: 'sep', type: 'separator' },
    {
      key: 'status',
      label: org.isActive ? o.suspendEllipsis : o.activateEllipsis,
      destructive: org.isActive,
      disabled: suspendOrg.isPending,
      onSelect: () => setShowConfirm(true),
    },
  ];

  return (
    <>
      <Menu items={items} label={formatMessage(o.actionsFor, { name: org.name })} />
      {showConfirm && (
        <ConfirmDialog
          title={formatMessage(org.isActive ? o.confirmSuspendTitle : o.confirmActivateTitle, { name: org.name })}
          description={org.isActive ? o.confirmSuspendBody : o.confirmActivateBody}
          confirmLabel={org.isActive ? o.suspendOrg : o.activateOrg}
          destructive={org.isActive}
          onConfirm={confirmSuspendToggle}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

'use client';

import { useState } from 'react';
import { csvRow } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import { ConfirmDialog } from '../../../../components';
import type { OrganizationListItem } from '../../../../lib/trpc-types';

const PLAN_MRR: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };

interface OrgBulkBarProps {
  selectedIds: string[];
  organizations: OrganizationListItem[];
  onDeselectAll: () => void;
}

export function OrgBulkBar({ selectedIds, organizations, onDeselectAll }: OrgBulkBarProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [confirmAction, setConfirmAction] = useState<'suspend' | 'activate' | null>(null);

  const o = t.organizations;
  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onError: (err) => {
      toast(err.message || o.statusChangeError, { type: 'error' });
    },
  });

  const executeBulkAction = async (suspend: boolean) => {
    let done = 0;
    for (const id of selectedIds) {
      try {
        await suspendOrg.mutateAsync({ id, suspend });
        done++;
      } catch { /* error handled by onError */ }
    }
    // Success only when every call landed; a partial run says how many (feedback.md › Best practices).
    const total = selectedIds.length;
    if (done === total) {
      toast(formatMessage(suspend ? o.bulkSuspendedAll : o.bulkActivatedAll, { count: done }), { type: 'success' });
    } else {
      toast(formatMessage(suspend ? o.bulkSuspendedPartial : o.bulkActivatedPartial, { done, total }), { type: 'warning' });
    }
    utils.platform.listOrganizations.invalidate();
    utils.platform.getOrganizationKpis.invalidate();
    onDeselectAll();
  };

  const handleBulkSuspend = () => setConfirmAction('suspend');
  const handleBulkActivate = () => setConfirmAction('activate');

  const handleExportSelected = () => {
    const selected = organizations.filter((o) => selectedIds.includes(o.id));
    // Every cell through csvRow — same defect and same fix as organizations/page.tsx. NOTE the column
    // order differs from that file (MRR before Creada here, after it there); that inconsistency is
    // pre-existing and deliberately left alone, since changing it would alter a second thing under cover
    // of a security fix. Tracked as GHSA-w6h5-g5gv-7g95.
    const header = csvRow(['Nombre', 'Slug', 'Plan', 'Estado', 'Usuarios', 'Facturas', 'MRR', 'Creada']);
    const rows = selected.map((org) => {
      const plan = org.plan || org.subscription?.plan || 'trial';
      return csvRow([
        org.name, org.slug, plan,
        org.isActive ? 'active' : 'suspended',
        org._count?.users ?? 0,
        org._count?.invoices ?? 0,
        PLAN_MRR[plan] || 0,
        new Date(org.createdAt).toISOString().slice(0, 10),
      ]);
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `organizaciones-seleccionadas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(formatMessage(o.rowsExported, { count: selected.length }), { type: 'success' });
  };

  const onNavy = 'h-8 px-3 rounded-lg text-callout font-medium transition-colors disabled:opacity-50 pointer-coarse:min-h-11';
  return (
    <div
      role="region"
      aria-label={o.bulkActionsLabel}
      className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-brand px-4 py-3 md:px-5"
    >
      <span className="text-body font-medium text-white" aria-live="polite">
        {formatMessage(o.selectedCount, { count: selectedIds.length })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleBulkActivate}
          disabled={suspendOrg.isPending}
          className={`${onNavy} bg-white/10 text-white hover:bg-white/20`}
        >
          {o.activateSelected}
        </button>
        <button
          type="button"
          onClick={handleExportSelected}
          className={`${onNavy} bg-white/10 text-white hover:bg-white/20`}
        >
          {o.exportSelected}
        </button>
        <button
          type="button"
          onClick={handleBulkSuspend}
          disabled={suspendOrg.isPending}
          className={`${onNavy} bg-white text-brand-red hover:bg-danger-bg`}
        >
          {o.suspendSelectedEllipsis}
        </button>
        <button type="button" onClick={onDeselectAll} className={`${onNavy} text-white/80 hover:text-white`}>
          {o.deselectAll}
        </button>
      </div>
      {confirmAction && (
        <ConfirmDialog
          title={formatMessage(confirmAction === 'suspend' ? o.confirmBulkSuspendTitle : o.confirmBulkActivateTitle, {
            count: selectedIds.length,
          })}
          description={confirmAction === 'suspend' ? o.confirmBulkSuspendBody : o.confirmBulkActivateBody}
          confirmLabel={confirmAction === 'suspend' ? o.suspendOrgs : o.activateOrgs}
          destructive={confirmAction === 'suspend'}
          onConfirm={() => {
            setConfirmAction(null);
            executeBulkAction(confirmAction === 'suspend');
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

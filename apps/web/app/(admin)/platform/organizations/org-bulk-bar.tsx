'use client';

import { useState } from 'react';
import { csvRow } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
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

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onError: (err) => {
      toast(err.message || 'Error', { type: 'error' });
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
    toast(`${t.organizations.bulkComplete}: ${done}/${selectedIds.length}`, { type: 'success' });
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
    toast(t.organizations.csvExported, { type: 'success' });
  };

  return (
    <div className="bg-[#1F114C] rounded-xl px-5 py-3 mb-3 flex items-center justify-between flex-shrink-0">
      <span className="text-sm text-white font-medium">
        {selectedIds.length} {t.organizations.selected}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={handleBulkSuspend}
          disabled={suspendOrg.isPending}
          className="h-8 px-3 rounded-lg bg-[#DD0C15] text-xs text-white font-medium hover:bg-[#c40b13] transition disabled:opacity-50"
        >
          {t.organizations.suspendSelected}
        </button>
        <button
          onClick={handleBulkActivate}
          disabled={suspendOrg.isPending}
          className="h-8 px-3 rounded-lg bg-green-500 text-xs text-white font-medium hover:bg-green-600 transition disabled:opacity-50"
        >
          {t.organizations.activateSelected}
        </button>
        <button
          onClick={handleExportSelected}
          className="h-8 px-3 rounded-lg bg-white/10 text-xs text-white font-medium hover:bg-white/20 transition"
        >
          {t.organizations.exportSelected}
        </button>
        <button
          onClick={onDeselectAll}
          className="h-8 px-3 text-xs text-white/70 font-medium hover:text-white transition"
        >
          {t.organizations.deselectAll}
        </button>
      </div>
      {confirmAction && (
        <Modal
          title={confirmAction === 'suspend' ? t.organizations.suspendSelected : t.organizations.activateSelected}
          onClose={() => setConfirmAction(null)}
          maxWidth="max-w-sm"
        >
          <p className="text-sm text-[#585858] mb-4">
            {confirmAction === 'suspend' ? t.organizations.confirmBulkSuspend : t.organizations.confirmBulkActivate}
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmAction(null)} className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
            <button
              onClick={() => { setConfirmAction(null); executeBulkAction(confirmAction === 'suspend'); }}
              className={`flex-1 h-9 rounded-lg text-sm text-white font-medium transition ${confirmAction === 'suspend' ? 'bg-[#DD0C15] hover:bg-[#c40b13]' : 'bg-green-500 hover:bg-green-600'}`}
            >
              {confirmAction === 'suspend' ? t.organizations.suspend : t.organizations.activate}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

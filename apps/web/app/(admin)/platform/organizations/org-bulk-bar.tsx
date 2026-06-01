'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
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

  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onError: (err) => {
      toast(err.message || 'Error', { type: 'error' });
    },
  });

  const handleBulkSuspend = async () => {
    if (!confirm(t.organizations.confirmBulkSuspend)) return;
    let done = 0;
    for (const id of selectedIds) {
      try {
        await suspendOrg.mutateAsync({ id, suspend: true });
        done++;
      } catch { /* error handled by onError */ }
    }
    toast(`${t.organizations.bulkComplete}: ${done}/${selectedIds.length}`, { type: 'success' });
    utils.platform.listOrganizations.invalidate();
    utils.platform.getOrganizationKpis.invalidate();
    onDeselectAll();
  };

  const handleBulkActivate = async () => {
    if (!confirm(t.organizations.confirmBulkActivate)) return;
    let done = 0;
    for (const id of selectedIds) {
      try {
        await suspendOrg.mutateAsync({ id, suspend: false });
        done++;
      } catch { /* error handled by onError */ }
    }
    toast(`${t.organizations.bulkComplete}: ${done}/${selectedIds.length}`, { type: 'success' });
    utils.platform.listOrganizations.invalidate();
    utils.platform.getOrganizationKpis.invalidate();
    onDeselectAll();
  };

  const handleExportSelected = () => {
    const selected = organizations.filter((o) => selectedIds.includes(o.id));
    const header = 'Nombre,Slug,Plan,Estado,Usuarios,Facturas,MRR,Creada';
    const rows = selected.map((org) => {
      const plan = org.plan || org.subscription?.plan || 'trial';
      return [
        `"${org.name}"`, org.slug, plan,
        org.isActive ? 'active' : 'suspended',
        org._count?.users ?? 0,
        org._count?.invoices ?? 0,
        PLAN_MRR[plan] || 0,
        new Date(org.createdAt).toISOString().slice(0, 10),
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `organizaciones-seleccionadas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exportado', { type: 'success' });
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
    </div>
  );
}

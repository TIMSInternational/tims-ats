'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState, StatusBadge, Modal } from '../../../../components';
import { InviteOrgModal } from './invite-org-modal';
import { InviteUserModal } from './invite-user-modal';

type TypeFilter = '' | 'org_admin' | 'user';

function typeBadge(type: string, labels: { orgAdmin: string; user: string }) {
  if (type === 'org_admin') return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">{labels.orgAdmin}</span>;
  return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">{labels.user}</span>;
}

export default function InvitationsPage() {
  const { t } = useI18n();

  const TYPE_TABS: { value: TypeFilter; label: string }[] = [
    { value: '', label: t.invitations.filterAll },
    { value: 'org_admin', label: t.invitations.filterOrgAdmins },
    { value: 'user', label: t.invitations.filterUsers },
  ];
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [search, setSearch] = useState('');
  const [showOrgInvite, setShowOrgInvite] = useState(false);
  const [showUserInvite, setShowUserInvite] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; email: string } | null>(null);
  const limit = 15;

  const kpis = trpc.platform.getInvitationKpis.useQuery();
  const invitations = trpc.platform.listInvitations.useQuery({
    page, limit,
    type: typeFilter || undefined,
    search: search || undefined,
  });
  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.platform.listInvitations.invalidate();
    utils.platform.getInvitationKpis.invalidate();
  };

  const resend = trpc.platform.resendInvitation.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.invitations.invitationResent, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const revoke = trpc.platform.revokeInvitation.useMutation({
    onSuccess: () => { invalidateAll(); setRevokeTarget(null); toast(t.invitations.invitationRevoked, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const exportCsv = trpc.platform.exportInvitationsCsv.useQuery(
    { type: typeFilter || undefined },
    { enabled: false },
  );
  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invitaciones-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t.invitations.exportCsv}: ${result.data.count}`, { type: 'success' });
    }
  };

  const rows = invitations.data?.invitations ?? [];
  const total = invitations.data?.total ?? 0;

  const statusMap = {
    pending: { cls: 'bg-gray-100 text-gray-600', label: t.invitations.statusPending },
    sent: { cls: 'bg-blue-100 text-blue-700', label: t.invitations.statusSent },
    accepted: { cls: 'bg-green-100 text-green-700', label: t.invitations.statusAccepted },
    expired: { cls: 'bg-amber-100 text-amber-700', label: t.invitations.statusExpired },
    revoked: { cls: 'bg-red-100 text-red-700', label: t.invitations.statusRevoked },
  };

  const columns = [
    { key: 'email', label: t.invitations.colEmail },
    { key: 'type', label: t.invitations.colType, align: 'center' as const },
    { key: 'org', label: t.invitations.colOrganization },
    { key: 'status', label: t.invitations.colStatus, align: 'center' as const },
    { key: 'sent', label: t.invitations.colSent },
    { key: 'expires', label: t.invitations.colExpires },
    { key: 'actions', label: t.invitations.colActions, align: 'center' as const },
  ];

  const emptyIcon = (
    <svg className="w-12 h-12 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.invitations.kpiTotal}
              value={kpis.data.total}
              subtitle={t.invitations.invitations}
              icon={<svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
              iconBg="bg-violet-50"
            />
            <KpiCard
              label={t.invitations.kpiPending}
              value={kpis.data.pending}
              subtitle={t.invitations.waitingResponse}
              valueColor="text-amber-600"
              icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
              iconBg="bg-amber-50"
            />
            <KpiCard
              label={t.invitations.kpiAccepted}
              value={kpis.data.accepted}
              subtitle={kpis.data.total > 0 ? `${Math.round((kpis.data.accepted / kpis.data.total) * 100)}% ${t.invitations.acceptanceRate}` : t.invitations.noInvitationsShort}
              valueColor="text-green-600"
              icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.invitations.kpiExpired}
              value={kpis.data.expired}
              subtitle={kpis.data.expired > 0 ? t.invitations.considerResend : t.invitations.noExpired}
              valueColor={kpis.data.expired > 0 ? 'text-[#DD0C15]' : undefined}
              icon={<svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>}
              iconBg="bg-red-50"
              highlight={kpis.data.expired > 0}
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          {TYPE_TABS.map((tab) => (
            <button key={tab.value} onClick={() => { setTypeFilter(tab.value); setPage(0); }} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${typeFilter === tab.value ? 'bg-[#1F114C] text-white' : 'bg-white border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{tab.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder={t.invitations.searchEmail} className="h-8 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-xs text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 w-52" />
          </div>
          <button onClick={handleExport} className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#585858] hover:bg-[#F6F6F6] transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>{t.invitations.exportCsv}
          </button>
          <button onClick={() => setShowOrgInvite(true)} className="h-8 px-4 rounded-lg bg-[#1F114C] text-white text-xs font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>{t.invitations.inviteOrg}
          </button>
          <button onClick={() => setShowUserInvite(true)} className="h-8 px-4 rounded-lg border border-[#1F114C] text-[#1F114C] text-xs font-medium hover:bg-[#1F114C]/5 transition flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>{t.invitations.inviteUser}
          </button>
        </div>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={invitations.isLoading}
        empty={<EmptyState icon={emptyIcon} message={t.invitations.noInvitations} description={t.invitations.noInvitationsDesc} />}
        pagination={{ page, limit, total, onPageChange: setPage }}
      >
        {rows.map((inv) => {
          const isRevoked = inv.status === 'revoked';
          const isAccepted = inv.status === 'accepted';
          const isExpired = inv.status === 'expired' || (!isAccepted && !isRevoked && new Date(inv.expiresAt) < new Date());
          const canAct = !isAccepted && !isRevoked;
          const displayStatus = isExpired && inv.status !== 'expired' ? 'expired' : inv.status;

          return (
            <tr key={inv.id} className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${isRevoked ? 'opacity-50' : ''}`}>
              <td className="px-4 py-3">
                <span className="text-sm text-[#333] font-medium">{inv.email}</span>
                {inv.roleSlug && <p className="text-[10px] text-[#8B8B8B]">{inv.roleSlug.replace(/_/g, ' ')}</p>}
              </td>
              <td className="px-4 py-3 text-center">{typeBadge(inv.type, { orgAdmin: t.invitations.typeOrgAdmin, user: t.invitations.typeUser })}</td>
              <td className="px-4 py-3"><span className="text-sm text-[#585858]">{inv.organization?.name || inv.organizationName || '\u2014'}</span></td>
              <td className="px-4 py-3 text-center"><StatusBadge status={displayStatus} map={statusMap} /></td>
              <td className="px-4 py-3"><span className="text-xs text-[#585858]">{formatDate(inv.sentAt)}</span></td>
              <td className="px-4 py-3"><span className={`text-xs ${isExpired ? 'text-[#DD0C15] font-medium' : 'text-[#585858]'}`}>{formatDate(inv.expiresAt)}</span></td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-1.5">
                  {canAct ? (
                    <>
                      <button onClick={() => resend.mutate({ id: inv.id })} disabled={resend.isPending} className="text-[10px] text-blue-600 font-medium hover:underline disabled:opacity-50">{t.invitations.resend}</button>
                      <span className="text-[#EDEDED]">|</span>
                      <button onClick={() => setRevokeTarget({ id: inv.id, email: inv.email })} className="text-[10px] text-[#DD0C15] font-medium hover:underline">{t.invitations.revoke}</button>
                    </>
                  ) : (
                    <span className="text-[10px] text-[#8B8B8B]">{isAccepted ? t.invitations.completed : t.invitations.revoked}</span>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>

      {/* Revoke Confirm Modal */}
      {revokeTarget && (
        <Modal title={t.invitations.revoke} onClose={() => setRevokeTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm text-[#585858]">{t.invitations.confirmRevoke}</p>
            <p className="text-xs text-[#8B8B8B] bg-[#F6F6F6] px-3 py-2 rounded-lg">{revokeTarget.email}</p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button onClick={() => setRevokeTarget(null)} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
              <button onClick={() => revoke.mutate({ id: revokeTarget.id })} disabled={revoke.isPending} className="h-9 px-4 rounded-lg bg-[#DD0C15] text-sm text-white font-medium hover:bg-red-700 transition disabled:opacity-50">
                {revoke.isPending ? t.common.saving : t.invitations.revoke}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Invite Modals */}
      {showOrgInvite && <InviteOrgModal onClose={() => setShowOrgInvite(false)} onSuccess={() => { setShowOrgInvite(false); invalidateAll(); }} />}
      {showUserInvite && <InviteUserModal onClose={() => setShowUserInvite(false)} onSuccess={() => { setShowUserInvite(false); invalidateAll(); }} />}
    </div>
  );
}

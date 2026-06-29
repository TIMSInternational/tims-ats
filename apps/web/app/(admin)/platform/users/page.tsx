'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, Modal } from '../../../../components';
import { UserTable } from './user-table';
import { RoleChangeModal } from './role-change-modal';
import { InviteWizard } from './invite-wizard';
import type { UserListItem } from '../../../../lib/trpc-types';

export default function PlatformUsersPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'active' | 'all'>('active');
  const [page, setPage] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<{ user: UserListItem; action: 'deactivate' | 'activate' } | null>(null);
  const [editRoleTarget, setEditRoleTarget] = useState<UserListItem | null>(null);
  const [showInviteWizard, setShowInviteWizard] = useState(false);
  const limit = 15;

  const kpis = trpc.platform.getUserKpis.useQuery();
  const orgs = trpc.platform.listOrganizationsMinimal.useQuery();

  const { data, isLoading } = trpc.platform.listAllUsers.useQuery({
    page,
    limit,
    search: search || undefined,
    organizationId: orgFilter || undefined,
    roleSlug: roleFilter || undefined,
    isActive: activeFilter === 'active' ? true : undefined,
  });

  const utils = trpc.useUtils();
  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  const invalidateAll = () => {
    utils.platform.listAllUsers.invalidate();
    utils.platform.getUserKpis.invalidate();
  };

  const deactivateUser = trpc.platform.deactivateOrgUser.useMutation({
    onSuccess: () => { invalidateAll(); setConfirmTarget(null); toast(t.users.userDeactivated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const activateUser = trpc.platform.activateOrgUser.useMutation({
    onSuccess: () => { invalidateAll(); setConfirmTarget(null); toast(t.users.userActivated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const changeRole = trpc.platform.changeOrgUserRole.useMutation({
    onSuccess: () => { invalidateAll(); setEditRoleTarget(null); toast(t.common.save, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const exportCsv = trpc.platform.exportUsersCsv.useQuery(
    {
      organizationId: orgFilter || undefined,
      isActive: activeFilter === 'active' ? true : undefined,
      roleSlug: roleFilter || undefined,
    },
    { enabled: false },
  );

  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t.users.exportCsv}: ${result.data.count}`, { type: 'success' });
    }
  };

  const handleConfirm = () => {
    if (!confirmTarget) return;
    const { user, action } = confirmTarget;
    if (!user.organizationId) return;
    if (action === 'deactivate') {
      deactivateUser.mutate({ userId: user.id, organizationId: user.organizationId });
    } else {
      activateUser.mutate({ userId: user.id, organizationId: user.organizationId });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.users.kpiTotal}
              value={kpis.data.total.toLocaleString()}
              subtitle={t.users.onPlatform}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.users.activeToday}
              value={kpis.data.activeToday}
              subtitle={`${kpis.data.total > 0 ? ((kpis.data.activeToday / kpis.data.total) * 100).toFixed(1) : 0}% ${t.users.ofTotal}`}
              valueColor="text-green-600"
              icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.users.kpiPlatformOwners}
              value={kpis.data.platformOwners}
              subtitle={t.users.fullAccess}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.users.kpiInactive}
              value={kpis.data.inactive}
              subtitle={t.users.noLogin30Days}
              valueColor="text-amber-500"
              icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg>}
              iconBg="bg-amber-50"
              highlight={kpis.data.inactive > 0}
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div className="relative flex-1 max-w-[280px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            className="w-full h-9 pl-9 pr-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1F114C]"
            placeholder={t.users.searchUser}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <select
          className="h-9 px-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white text-[#585858] focus:outline-none"
          value={orgFilter}
          onChange={(e) => { setOrgFilter(e.target.value); setPage(0); }}
        >
          <option value="">{t.users.allOrgs}</option>
          {orgs.data?.map((org) => (
            <option key={org.id} value={org.id}>{org.name}</option>
          ))}
        </select>
        <select
          className="h-9 px-3 border border-[#EDEDED] rounded-lg text-[12px] bg-white text-[#585858] focus:outline-none"
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }}
        >
          <option value="">{t.users.allRoles}</option>
          <option value="super_admin">{t.users.roleSuperAdmin}</option>
          <option value="hr_admin">{t.users.roleHrAdmin}</option>
          <option value="recruiter">Recruiter</option>
          <option value="leader">Leader</option>
          <option value="employee">Employee</option>
        </select>
        <div className="flex items-center bg-white border border-[#EDEDED] rounded-lg overflow-hidden">
          <button
            className={`px-3 h-9 text-[12px] font-medium transition ${activeFilter === 'active' ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}
            onClick={() => { setActiveFilter('active'); setPage(0); }}
          >
            {t.users.filterActive}
          </button>
          <button
            className={`px-3 h-9 text-[12px] font-medium transition ${activeFilter === 'all' ? 'bg-[#1F114C] text-white' : 'text-[#585858]'}`}
            onClick={() => { setActiveFilter('all'); setPage(0); }}
          >
            {t.users.filterAll}
          </button>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-9 rounded-lg text-[12px] hover:bg-[#F6F6F6] transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {t.users.export}
        </button>
        <button
          onClick={() => setShowInviteWizard(true)}
          className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-9 rounded-lg text-[12px] font-medium hover:bg-[#c40b13] transition"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t.users.inviteUser}
        </button>
      </div>

      {/* Table */}
      <UserTable
        users={users}
        isLoading={isLoading}
        page={page}
        limit={limit}
        total={total}
        onPageChange={setPage}
        onDeactivate={(user) => setConfirmTarget({ user, action: 'deactivate' })}
        onActivate={(user) => setConfirmTarget({ user, action: 'activate' })}
        onEditRole={setEditRoleTarget}
      />

      {/* Confirm Modal */}
      {confirmTarget && (
        <Modal
          title={confirmTarget.action === 'deactivate' ? t.users.deactivate : t.users.activate}
          onClose={() => setConfirmTarget(null)}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#F6F6F6]">
              <div className="w-10 h-10 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-sm font-bold">
                {`${confirmTarget.user.firstName?.[0] || ''}${confirmTarget.user.lastName?.[0] || ''}`.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-[#333]">{confirmTarget.user.firstName} {confirmTarget.user.lastName}</p>
                <p className="text-xs text-[#8B8B8B]">{confirmTarget.user.email}</p>
              </div>
            </div>
            <p className="text-sm text-[#585858]">
              {confirmTarget.action === 'deactivate' ? t.users.confirmDeactivate : t.users.confirmActivate}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirmTarget(null)}
                className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] font-medium hover:bg-[#F6F6F6] transition"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleConfirm}
                disabled={deactivateUser.isPending || activateUser.isPending}
                className={`h-9 px-4 rounded-lg text-sm text-white font-medium transition disabled:opacity-50 ${
                  confirmTarget.action === 'deactivate' ? 'bg-[#DD0C15] hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {(deactivateUser.isPending || activateUser.isPending) ? t.common.saving : confirmTarget.action === 'deactivate' ? t.users.deactivate : t.users.activate}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Invite Wizard */}
      {showInviteWizard && (
        <InviteWizard
          onClose={() => setShowInviteWizard(false)}
          onSuccess={() => { setShowInviteWizard(false); invalidateAll(); }}
        />
      )}

      {/* Role Change Modal */}
      {editRoleTarget && (
        <RoleChangeModal
          user={editRoleTarget}
          onConfirm={(roleSlug) => {
            if (!editRoleTarget.organizationId) return;
            changeRole.mutate({ userId: editRoleTarget.id, organizationId: editRoleTarget.organizationId, roleSlug });
          }}
          onClose={() => setEditRoleTarget(null)}
          isPending={changeRole.isPending}
        />
      )}
    </div>
  );
}

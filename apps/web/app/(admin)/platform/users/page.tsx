'use client';

import { useState } from 'react';
import { ASSIGNABLE_STAFF_ROLES } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  KpiCard,
  KpiCardSkeleton,
  PageHeader,
  SegmentedControl,
  inputClasses,
  selectClasses,
} from '../../../../components';
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

  const { data, isLoading, isError, refetch } = trpc.platform.listAllUsers.useQuery({
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
    onSuccess: () => { invalidateAll(); setEditRoleTarget(null); toast(t.users.roleUpdated, { type: 'success' }); },
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
    if (result.isError) {
      toast(t.common.exportError, { type: 'error' });
      return;
    }
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `usuarios-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(formatMessage(t.users.rowsExported, { count: result.data.count }), { type: 'success' });
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

  const u = t.users;
  const icon = (d: string) => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
  );
  const targetName = confirmTarget ? `${confirmTarget.user.firstName ?? ''} ${confirmTarget.user.lastName ?? ''}`.trim() || confirmTarget.user.email : '';

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        title={u.title}
        actions={
          <>
            <Button variant="secondary" onClick={handleExport} icon={icon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}>
              {u.exportCsv}
            </Button>
            <Button onClick={() => setShowInviteWizard(true)} icon={icon('M12 4.5v15m7.5-7.5h-15')}>
              {u.inviteUser}
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-5">
      {/* KPI Row */}
      <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 rounded-xl bg-white shadow-card md:col-span-4">
            <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} size="compact" />
          </div>
        ) : kpis.data ? (
          <>
            <KpiCard
              label={u.kpiTotal}
              value={kpis.data.total.toLocaleString()}
              subtitle={u.onPlatform}
              icon={icon('M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75')}
            />
            <KpiCard
              label={u.activeToday}
              value={kpis.data.activeToday}
              subtitle={formatMessage(u.shareOfTotal, { pct: kpis.data.total > 0 ? ((kpis.data.activeToday / kpis.data.total) * 100).toFixed(1) : 0 })}
              icon={icon('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}
            />
            <KpiCard
              label={u.kpiPlatformOwners}
              value={kpis.data.platformOwners}
              subtitle={u.fullAccess}
              icon={icon('M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z')}
            />
            <KpiCard
              label={u.kpiInactive}
              value={kpis.data.inactive}
              tone="warning"
              subtitle={u.noLogin30Days}
              icon={icon('M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01')}
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 md:gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1">
          <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="search"
            aria-label={u.searchUserLabel}
            className={inputClasses('md', 'pl-9')}
            placeholder={u.searchUser}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        {orgs.isError ? (
          <ErrorState size="inline" onRetry={() => orgs.refetch()} error={orgs.error} />
        ) : (
          <select
            aria-label={u.filterOrg}
            className={selectClasses('md', 'w-full sm:w-auto')}
            value={orgFilter}
            onChange={(e) => { setOrgFilter(e.target.value); setPage(0); }}
          >
            <option value="">{u.allOrgs}</option>
            {orgs.data?.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </select>
        )}
        <select
          aria-label={u.filterRole}
          className={selectClasses('md', 'w-full sm:w-auto')}
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(0); }}
        >
          <option value="">{u.allRoles}</option>
          {ASSIGNABLE_STAFF_ROLES.map((slug) => <option key={slug} value={slug}>{t.roles[slug]}</option>)}
        </select>
        <SegmentedControl
          label={u.filterStatusLabel}
          options={[
            { value: 'active' as const, label: u.filterActive },
            { value: 'all' as const, label: u.filterAll },
          ]}
          value={activeFilter}
          onChange={(next) => { setActiveFilter(next); setPage(0); }}
        />
      </div>

      {/* Table */}
      {isError ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card">
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : (
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
      )}
      </div>

      {/* Confirm */}
      {confirmTarget && (
        <ConfirmDialog
          title={formatMessage(confirmTarget.action === 'deactivate' ? u.confirmDeactivateTitle : u.confirmActivateTitle, { name: targetName })}
          description={confirmTarget.action === 'deactivate' ? u.confirmDeactivateBody : u.confirmActivateBody}
          confirmLabel={confirmTarget.action === 'deactivate' ? u.deactivateUser : u.activateUser}
          destructive={confirmTarget.action === 'deactivate'}
          loading={deactivateUser.isPending || activateUser.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmTarget(null)}
        />
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

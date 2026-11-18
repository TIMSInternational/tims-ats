'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { useInvitationResend } from '../../../../lib/platform-api/invitation-resend';
import { formatDate } from '../../../../lib/format-utils';
import { roleLabel } from '../../../../lib/role-labels';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  KpiCard,
  KpiCardSkeleton,
  Menu,
  PageHeader,
  SegmentedControl,
  StatusBadge,
  inputClasses,
} from '../../../../components';
import { InviteOrgModal } from './invite-org-modal';
import { InviteUserModal } from './invite-user-modal';

type TypeFilter = '' | 'org_admin' | 'user';

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

  const resend = useInvitationResend({
    onSuccess: () => { invalidateAll(); toast(t.invitations.invitationResent, { type: 'success' }); },
    onError: (err) => { invalidateAll(); toast(err.message, { type: 'error' }); },
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
    if (result.isError) {
      toast(t.common.exportError, { type: 'error' });
      return;
    }
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invitaciones-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(formatMessage(t.invitations.rowsExported, { count: result.data.count }), { type: 'success' });
    }
  };

  const rows = invitations.data?.invitations ?? [];
  const total = invitations.data?.total ?? 0;

  const statusMap = {
    pending: { tone: 'neutral' as const, label: t.invitations.statusPending },
    sent: { tone: 'info' as const, label: t.invitations.statusSent },
    accepted: { tone: 'success' as const, label: t.invitations.statusAccepted },
    expired: { tone: 'warning' as const, label: t.invitations.statusExpired },
    revoked: { tone: 'neutral' as const, label: t.invitations.statusRevoked },
  };

  const columns = [
    { key: 'email', label: t.invitations.colEmail },
    { key: 'type', label: t.invitations.colType },
    { key: 'org', label: t.invitations.colOrganization },
    { key: 'status', label: t.invitations.colStatus },
    { key: 'sent', label: t.invitations.colSent },
    { key: 'expires', label: t.invitations.colExpires },
    { key: 'actions', label: t.invitations.colActions, align: 'right' as const, srOnly: true },
  ];

  const emptyIcon = (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
    </svg>
  );

  const inv = t.invitations;
  const icon = (d: string) => (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
  );
  const rowState = (row: (typeof rows)[number]) => {
    const isRevoked = row.status === 'revoked';
    const isAccepted = row.status === 'accepted';
    const isExpired = row.status === 'expired' || (!isAccepted && !isRevoked && new Date(row.expiresAt) < new Date());
    return { canAct: !isAccepted && !isRevoked, isExpired, displayStatus: isExpired && row.status !== 'expired' ? 'expired' : row.status };
  };
  const typeBadge = (type: string) =>
    type === 'org_admin' ? (
      <StatusBadge tone="brand" icon="none">{inv.typeOrgAdmin}</StatusBadge>
    ) : (
      <StatusBadge tone="info" icon="none">{inv.typeUser}</StatusBadge>
    );
  // One visible action per row, the destructive one in a menu (foundation-spec.md §7); finished rows are empty.
  const rowActions = (row: (typeof rows)[number]) => {
    if (!rowState(row).canAct) return null;
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="tertiary" onClick={() => resend.mutate({ id: row.id })} disabled={resend.isPending}>
          {inv.resend}
        </Button>
        <Menu
          label={formatMessage(inv.moreActionsFor, { email: row.email })}
          items={[{ key: 'revoke', label: inv.revokeEllipsis, destructive: true, onSelect: () => setRevokeTarget({ id: row.id, email: row.email }) }]}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden">
      <PageHeader
        title={inv.title}
        actions={
          <>
            <Button variant="secondary" onClick={handleExport} icon={icon('M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4')}>
              {inv.exportCsv}
            </Button>
            {/* Inviting a person into an EXISTING organization is the everyday task, so it is the filled primary
                button; "Invitar organización" creates a new organization and is the secondary one (D-15). */}
            <Button variant="secondary" onClick={() => setShowOrgInvite(true)} icon={icon('M12 4v16m8-8H4')}>
              {inv.inviteOrg}
            </Button>
            <Button onClick={() => setShowUserInvite(true)} icon={icon('M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z')}>
              {inv.inviteUser}
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col p-3 md:p-6">
      {/* KPIs */}
      <div className="mb-4 grid shrink-0 grid-cols-2 gap-3 md:mb-5 md:grid-cols-4 md:gap-4">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 rounded-xl bg-white shadow-card md:col-span-4">
            <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} size="compact" />
          </div>
        ) : kpis.data ? (
          <>
            <KpiCard label={inv.kpiTotal} value={kpis.data.total} subtitle={inv.invitations} icon={icon('M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z')} />
            <KpiCard label={inv.kpiPending} value={kpis.data.pending} subtitle={inv.waitingResponse} icon={icon('M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z')} />
            <KpiCard
              label={inv.kpiAccepted}
              value={kpis.data.accepted}
              subtitle={kpis.data.total > 0 ? formatMessage(inv.acceptanceRateValue, { pct: Math.round((kpis.data.accepted / kpis.data.total) * 100) }) : inv.noInvitationsShort}
              icon={icon('M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z')}
            />
            <KpiCard
              label={inv.kpiExpired}
              value={kpis.data.expired}
              tone="warning"
              subtitle={kpis.data.expired > 0 ? inv.considerResend : inv.noExpired}
              icon={icon('M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z')}
            />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2">
        <SegmentedControl
          label={inv.filterTypeLabel}
          options={TYPE_TABS}
          value={typeFilter}
          onChange={(value) => { setTypeFilter(value); setPage(0); }}
        />
        <div className="relative w-full sm:ml-auto sm:w-64">
          <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            type="search"
            aria-label={inv.searchEmailLabel}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={inv.searchEmail}
            className={inputClasses('md', 'pl-9')}
          />
        </div>
      </div>

      {/* Table */}
      {invitations.isError ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-card">
          <ErrorState onRetry={() => invitations.refetch()} error={invitations.error} />
        </div>
      ) : (
      <DataTable
        columns={columns}
        label={inv.title}
        loading={invitations.isLoading}
        empty={<EmptyState icon={emptyIcon} message={inv.noInvitations} description={inv.noInvitationsDesc} />}
        pagination={{ page, limit, total, onPageChange: setPage }}
        mobileList={rows.map((row) => {
          const st = rowState(row);
          return (
            <div key={row.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-all text-body font-medium text-primary">{row.email}</span>
                <StatusBadge status={st.displayStatus} map={statusMap} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-callout text-secondary">
                {typeBadge(row.type)}
                <span>{row.organization?.name || row.organizationName || '\u2014'}</span>
                <span className={st.isExpired ? 'font-medium text-danger' : ''}>{formatMessage(inv.expiresOn, { date: formatDate(row.expiresAt) })}</span>
              </div>
              {rowActions(row)}
            </div>
          );
        })}
      >
        {rows.map((row) => {
          const st = rowState(row);
          return (
            <tr key={row.id} className="border-b border-border transition-colors hover:bg-surface-hover">
              <td className="px-4 py-3">
                <span className="text-body font-medium text-primary">{row.email}</span>
                {row.roleSlug && <p className="text-callout text-secondary">{roleLabel(t.roles, row.roleSlug)}</p>}
              </td>
              <td className="px-4 py-3">{typeBadge(row.type)}</td>
              <td className="px-4 py-3"><span className="text-body text-secondary">{row.organization?.name || row.organizationName || '\u2014'}</span></td>
              <td className="px-4 py-3"><StatusBadge status={st.displayStatus} map={statusMap} /></td>
              <td className="px-4 py-3"><span className="text-callout text-secondary">{formatDate(row.sentAt)}</span></td>
              <td className="px-4 py-3"><span className={`text-callout ${st.isExpired ? 'font-medium text-danger' : 'text-secondary'}`}>{formatDate(row.expiresAt)}</span></td>
              <td className="px-4 py-3">{rowActions(row)}</td>
            </tr>
          );
        })}
      </DataTable>
      )}
      </div>

      {/* Revoke confirmation */}
      {revokeTarget && (
        <ConfirmDialog
          title={formatMessage(inv.confirmRevokeTitle, { email: revokeTarget.email })}
          description={inv.confirmRevokeBody}
          confirmLabel={inv.revokeInvitation}
          destructive
          loading={revoke.isPending}
          onConfirm={() => revoke.mutate({ id: revokeTarget.id })}
          onCancel={() => setRevokeTarget(null)}
        />
      )}

      {/* Invite Modals */}
      {showOrgInvite && <InviteOrgModal onClose={() => setShowOrgInvite(false)} onSuccess={() => { setShowOrgInvite(false); invalidateAll(); }} />}
      {showUserInvite && <InviteUserModal onClose={() => setShowUserInvite(false)} onSuccess={() => { setShowUserInvite(false); invalidateAll(); }} />}
    </div>
  );
}

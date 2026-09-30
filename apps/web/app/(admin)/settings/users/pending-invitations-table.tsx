'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, ErrorState, StatusBadge } from '../../../../components';
import {
  TENANT_INVITATION_STATUS_FILTERS,
  useResendTenantInvitation,
  useRevokeTenantInvitation,
  useTenantInvitationRoles,
  useTenantInvitations,
  type TenantInvitation,
  type TenantInvitationStatusFilter,
} from '../../../../lib/platform-api/tenant-invitations';
import { invitationErrorMessage } from './invitation-error-message';
import { RevokeInvitationModal } from './revoke-invitation-modal';

const ACTION_CLS = 'text-xs font-medium hover:underline disabled:opacity-50 disabled:no-underline';
const LOAD_MORE_CLS =
  'self-center h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#1F114C] hover:bg-[#F7F7F7] transition disabled:opacity-50';

export function PendingInvitationsTable() {
  const { t } = useI18n();
  const m = t.teamSettings;
  // Pending (not yet expired) invitations first; expired ones are one filter away instead of silently
  // crowding live ones out of a fixed-size list.
  const [filter, setFilter] = useState<TenantInvitationStatusFilter>('active');
  const invitations = useTenantInvitations(true, filter);
  const roles = useTenantInvitationRoles(true);
  const [revoking, setRevoking] = useState<TenantInvitation | null>(null);

  const resend = useResendTenantInvitation({
    onSuccess: () => toast(m.resent, { type: 'success' }),
    onError: (error) => toast(invitationErrorMessage(error, 'resend', m), { type: 'error' }),
  });
  const revoke = useRevokeTenantInvitation({
    onSuccess: () => {
      setRevoking(null);
      toast(m.revoked, { type: 'success' });
    },
    onError: (error) => {
      setRevoking(null);
      toast(invitationErrorMessage(error, 'revoke', m), { type: 'error' });
    },
  });

  if (invitations.isError)
    return (
      <ErrorState
        message={invitationErrorMessage(invitations.error, 'read', m)}
        onRetry={() => void invitations.refetch()}
      />
    );

  const roleNames = new Map((roles.data ?? []).map((role) => [role.slug, role.name]));
  const statusMap = {
    pending: { cls: 'bg-amber-50 text-amber-700', label: m.statusPending },
    sent: { cls: 'bg-blue-50 text-blue-700', label: m.statusSent },
    expired: { cls: 'bg-gray-100 text-gray-600', label: m.statusExpired },
  };
  const busy = resend.isPending || revoke.isPending;
  const rows = invitations.data?.pages.flatMap((page) => page.invitations) ?? [];
  const filterLabels: Record<TenantInvitationStatusFilter, string> = {
    active: m.filterActive,
    expired: m.filterExpired,
    all: m.filterAll,
  };
  // Resend revives a grant of the invitation's role, so the API refuses it (403) unless the caller could
  // grant that role. `roles.data` IS the caller's grantable list; mirror the rule so the button is not a trap.
  // A NULL role is accepted as `employee`. Until the list loads, defer to the server.
  const canResend = (inv: TenantInvitation) => !roles.data || roleNames.has(inv.roleSlug ?? 'employee');

  return (
    <div className="flex flex-col gap-3">
      <label className="self-end flex items-center gap-2 text-xs text-[#585858]">
        {m.filterLabel}
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as TenantInvitationStatusFilter)}
          className="h-8 rounded-lg border border-[#EDEDED] px-2 text-sm text-[#333]"
        >
          {TENANT_INVITATION_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {filterLabels[value]}
            </option>
          ))}
        </select>
      </label>
      <DataTable
        loading={invitations.isLoading}
        columns={[
          { key: 'email', label: m.colEmail },
          { key: 'role', label: m.colRole },
          { key: 'status', label: m.colStatus },
          { key: 'expires', label: m.colExpires },
          { key: 'actions', label: m.colActions, align: 'right' },
        ]}
        empty={<EmptyState icon={null} message={m.pendingEmpty} />}
      >
        {rows.map((inv) => (
          <tr key={inv.id} className="border-b border-[#EDEDED] last:border-0">
            <td className="px-4 py-3 text-sm text-[#333]">{inv.email}</td>
            <td className="px-4 py-3 text-sm text-[#585858]">
              {inv.roleSlug ? (roleNames.get(inv.roleSlug) ?? inv.roleSlug) : m.noRole}
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={inv.status} map={statusMap} />
            </td>
            <td className="px-4 py-3 text-sm text-[#585858]">{formatDate(inv.expiresAt)}</td>
            <td className="px-4 py-3 text-right whitespace-nowrap">
              <button
                type="button"
                disabled={busy || !canResend(inv)}
                title={canResend(inv) ? undefined : m.resendNotGrantable}
                onClick={() => resend.mutate(inv.id)}
                className={`${ACTION_CLS} text-[#1F114C] mr-4`}
              >
                {m.resend}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRevoking(inv)}
                className={`${ACTION_CLS} text-[#DD0C15]`}
              >
                {m.revoke}
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
      {invitations.hasNextPage && (
        <button
          type="button"
          onClick={() => void invitations.fetchNextPage()}
          disabled={invitations.isFetchingNextPage}
          className={LOAD_MORE_CLS}
        >
          {m.loadMore}
        </button>
      )}
      {revoking && (
        <RevokeInvitationModal
          email={revoking.email}
          isPending={revoke.isPending}
          onCancel={() => setRevoking(null)}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      )}
    </div>
  );
}
